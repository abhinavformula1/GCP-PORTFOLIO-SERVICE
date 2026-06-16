'use strict';

/**
 * Firestore client wrapper.
 *
 * Mental model (for Salesforce folks): a Firestore *collection* is like a
 * Custom Object, and a *document* is like a record. Documents are JSON-shaped
 * — fields can be primitives, maps, arrays, or timestamps — and the schema
 * is enforced by the application, not the database.
 *
 * Authentication on Cloud Run is automatic via the runtime service account.
 * Locally, run `gcloud auth application-default login` once.
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const config = require('../config');

// ── Lazy singleton — initialised on first use, not at import time ─────────────
// This means the app still boots cleanly if Firestore isn't configured yet.
let _db = null;
function getDb() {
  if (_db) return _db;

  const opts = {};
  if (config.firestore.projectId)  opts.projectId  = config.firestore.projectId;
  if (config.firestore.databaseId && config.firestore.databaseId !== '(default)') {
    opts.databaseId = config.firestore.databaseId;
  }

  _db = new Firestore(opts);
  return _db;
}

// ── User operations ───────────────────────────────────────────────────────────
const USERS_COLLECTION = 'users';

/**
 * Reads /users/{uid}. Returns null if the document doesn't exist.
 */
async function getUser(uid) {
  const snap = await getDb().collection(USERS_COLLECTION).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Creates /users/{uid} on first sight, or updates lastSeenAt and increments
 * visitCount on subsequent sights.
 *
 * Returns:
 *   {
 *     isReturning,   // false on first ever visit, true otherwise
 *     visitCount,    // post-increment count
 *     firstSeenAt,   // Firestore Timestamp | null
 *     lastSeenAt,    // Firestore Timestamp | null  (pre-update value)
 *   }
 */
async function upsertUserVisit({ uid, email, name, picture }) {
  const ref = getDb().collection(USERS_COLLECTION).doc(uid);

  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now  = FieldValue.serverTimestamp();

    if (snap.exists) {
      const existing = snap.data();
      tx.update(ref, {
        email,
        name,
        picture:    picture || null,
        lastSeenAt: now,
        visitCount: FieldValue.increment(1),
      });
      return {
        isReturning: true,
        visitCount:  (existing.visitCount || 0) + 1,
        firstSeenAt: existing.firstSeenAt || null,
        lastSeenAt:  existing.lastSeenAt  || null,
      };
    }

    tx.set(ref, {
      email,
      name,
      picture:     picture || null,
      firstSeenAt: now,
      lastSeenAt:  now,
      visitCount:  1,
    });
    return {
      isReturning: false,
      visitCount:  1,
      firstSeenAt: null,
      lastSeenAt:  null,
    };
  });
}

// ── Chat-history operations ──────────────────────────────────────────────────
//
// Each user has a single "active" chat doc at /users/{uid}/sessions/active.
// Completed inquiries flow off into /users/{uid}/inquiries/{auto} — the same
// Salesforce Recruiter_Inquiry__c id is stored as a back-reference.
//
// Messages are kept inline on the active doc (capped at MAX_MESSAGES) so a
// single Firestore read restores the whole conversation. For longer-running
// chats this would graduate to a /messages subcollection — overkill for a
// guided 7-step flow.

const ACTIVE_DOC_ID  = 'active';
const SESSIONS_COLLECTION = 'sessions';
const INQUIRIES_COLLECTION = 'inquiries';
const MAX_MESSAGES = 50;

function activeDocRef(uid) {
  return getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(SESSIONS_COLLECTION).doc(ACTIVE_DOC_ID);
}

/**
 * Returns the active chat for {uid}, or null if none.
 * Timestamps are converted to epoch-ms so the client can use them directly.
 */
async function getActiveChat(uid) {
  const snap = await activeDocRef(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    startedAt: d.startedAt && d.startedAt.toMillis ? d.startedAt.toMillis() : null,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
    step:      typeof d.step === 'number' ? d.step : 0,
    answers:   d.answers  || {},
    messages:  Array.isArray(d.messages) ? d.messages : [],
    locale:    d.locale   || 'en',
  };
}

/**
 * Upserts the active chat. Each call appends `message` to the messages array
 * (if provided) and overwrites `step`, `answers`, `locale`. The messages array
 * is capped at MAX_MESSAGES (oldest dropped first).
 */
async function upsertActiveChat(uid, { step, answers, message, locale }) {
  const ref = activeDocRef(uid);
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now  = FieldValue.serverTimestamp();

    let messages = [];
    if (snap.exists) {
      const d = snap.data() || {};
      messages = Array.isArray(d.messages) ? d.messages.slice() : [];
    }
    if (message && message.text) {
      messages.push({
        role: message.role === 'user' ? 'user' : 'bot',
        text: String(message.text).slice(0, 2000),
        ts:   Date.now(),
      });
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES);
      }
    }

    const update = {
      step:       typeof step === 'number' ? step : (snap.exists ? snap.get('step') || 0 : 0),
      answers:    answers && typeof answers === 'object' ? answers : (snap.exists ? snap.get('answers') || {} : {}),
      locale:     locale || (snap.exists ? snap.get('locale') || 'en' : 'en'),
      messages,
      updatedAt:  now,
    };
    if (!snap.exists) update.startedAt = now;

    if (snap.exists) tx.update(ref, update);
    else             tx.set(ref, update);
  });
}

async function clearActiveChat(uid) {
  await activeDocRef(uid).delete();
}

// ── Atlas (free-form Q&A) conversation persistence ───────────────────────────
//
// Parallel to the guided-flow `/users/{uid}/sessions/active` doc above, but
// for the LLM-backed Atlas chat. Storing only the latest active conversation
// per user — same trade-offs (single read restores everything, capped turn
// count keeps reads bounded). If a user wants longer-term history we'd
// graduate this to a /atlas-conversations/{auto} subcollection like inquiries.

const ATLAS_COLLECTION = 'atlas';
const ATLAS_USAGE_COLLECTION = 'atlasUsage';
const ATLAS_CACHE_COLLECTION = 'atlasCache';
const MAX_ATLAS_TURNS  = 40;
const ATLAS_MONTHLY_BUDGET_INR = 100;
const SYSTEM_DESIGN_COLLECTION = 'systemDesignArticles';
const APP_CONFIG_COLLECTION = 'appConfig';
const CONTACT_POLICY_DOC = 'contactPolicy';

function atlasActiveDocRef(uid) {
  return getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(ATLAS_COLLECTION).doc(ACTIVE_DOC_ID);
}

/**
 * Returns the user's active Atlas conversation, or null if none.
 * Shape mirrors getActiveChat() — timestamps converted to epoch-ms.
 *   { startedAt, updatedAt, turns: [{ role: 'user'|'model', text, ts, usage? }, ...], usage }
 */
async function getActiveAtlasConversation(uid) {
  const snap = await atlasActiveDocRef(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    startedAt: d.startedAt && d.startedAt.toMillis ? d.startedAt.toMillis() : null,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
    turns:     Array.isArray(d.turns) ? d.turns : [],
    usage:     summariseAtlasUsage(Array.isArray(d.turns) ? d.turns : []),
  };
}

function summariseAtlasUsage(turns) {
  return (Array.isArray(turns) ? turns : []).reduce((acc, turn) => {
    const usage = turn && turn.usage;
    if (!usage) return acc;
    acc.inputTokens += Number(usage.inputTokens || 0);
    acc.outputTokens += Number(usage.outputTokens || 0);
    acc.totalTokens += Number(usage.totalTokens || 0);
    acc.estimatedInr += Number(usage.estimatedInr || 0);
    acc.estimatedUsd += Number(usage.estimatedUsd || 0);
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedInr: 0,
    estimatedUsd: 0,
  });
}

/**
 * Append a single turn to the active conversation, capped at MAX_ATLAS_TURNS.
 * Role uses Gemini's vocabulary ('user' / 'model') — matches what the LLM
 * service expects so the client can pass `turns` straight back as `history`.
 *
 * Best-effort: callers fire-and-forget. Failures are surfaced as thrown
 * errors but the route layer logs and moves on — chat UX never blocks
 * on Firestore.
 */
async function appendAtlasTurn(uid, { role, text, usage }) {
  if (role !== 'user' && role !== 'model') {
    throw new Error('appendAtlasTurn: role must be "user" or "model".');
  }
  const ref = atlasActiveDocRef(uid);
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now  = FieldValue.serverTimestamp();

    let turns = [];
    if (snap.exists) {
      const d = snap.data() || {};
      turns = Array.isArray(d.turns) ? d.turns.slice() : [];
    }

    const turn = {
      role,
      text: String(text || '').slice(0, 4000),
      ts:   Date.now(),
    };
    if (usage && typeof usage === 'object') {
      turn.usage = {
        model:        String(usage.model || ''),
        modelLabel:   String(usage.modelLabel || ''),
        inputTokens:  Number(usage.inputTokens || 0),
        outputTokens: Number(usage.outputTokens || 0),
        totalTokens:  Number(usage.totalTokens || 0),
        estimatedUsd: Number(usage.estimatedUsd || 0),
        estimatedInr: Number(usage.estimatedInr || 0),
      };
    }
    turns.push(turn);
    if (turns.length > MAX_ATLAS_TURNS) {
      turns = turns.slice(turns.length - MAX_ATLAS_TURNS);
    }

    const update = { turns, updatedAt: now };
    if (!snap.exists) update.startedAt = now;

    if (snap.exists) tx.update(ref, update);
    else             tx.set(ref, update);
  });
}

async function clearActiveAtlasConversation(uid) {
  await atlasActiveDocRef(uid).delete();
}

async function getAtlasUsageSummary(uid) {
  const conv = await getActiveAtlasConversation(uid);
  const month = await getAtlasMonthlyUsageSummary();
  return {
    activeConversation: conv ? conv.usage : summariseAtlasUsage([]),
    month,
    monthlyBudgetInr:  ATLAS_MONTHLY_BUDGET_INR,
  };
}

async function appendAtlasUsageEvent(uid, usage) {
  if (!usage || typeof usage !== 'object') return;
  await getDb().collection(ATLAS_USAGE_COLLECTION).add({
    uid,
    model:        String(usage.model || ''),
    modelLabel:   String(usage.modelLabel || ''),
    inputTokens:  Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens:  Number(usage.totalTokens || 0),
    estimatedUsd: Number(usage.estimatedUsd || 0),
    estimatedInr: Number(usage.estimatedInr || 0),
    usedAt:       FieldValue.serverTimestamp(),
    usedAtMs:     Date.now(),
  });
}

async function getAtlasMonthlyUsageSummary(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const snap = await getDb()
    .collection(ATLAS_USAGE_COLLECTION)
    .where('usedAtMs', '>=', start)
    .get();

  const summary = summariseAtlasUsage(
    snap.docs.map((doc) => ({ usage: doc.data() || {} }))
  );
  summary.remainingBudgetInr = Math.max(0, ATLAS_MONTHLY_BUDGET_INR - summary.estimatedInr);
  summary.budgetUsedPercent = ATLAS_MONTHLY_BUDGET_INR
    ? Math.min(100, (summary.estimatedInr / ATLAS_MONTHLY_BUDGET_INR) * 100)
    : 0;
  return summary;
}

async function getAtlasCacheEntry(cacheKey) {
  const snap = await getDb().collection(ATLAS_CACHE_COLLECTION).doc(cacheKey).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  if (Number(data.expiresAtMs || 0) <= Date.now()) return null;

  await snap.ref.update({
    hitCount: FieldValue.increment(1),
    lastHitAt: FieldValue.serverTimestamp(),
  });

  return {
    answer: String(data.answer || ''),
    model:  String(data.model || ''),
  };
}

async function saveAtlasCacheEntry(cacheKey, entry) {
  await getDb().collection(ATLAS_CACHE_COLLECTION).doc(cacheKey).set({
    normalizedQuestion: String(entry.normalizedQuestion || '').slice(0, 500),
    model:              String(entry.model || ''),
    personaVersion:     String(entry.personaVersion || ''),
    answer:             String(entry.answer || '').slice(0, 4000),
    createdAt:          FieldValue.serverTimestamp(),
    expiresAtMs:        Number(entry.expiresAtMs || 0),
    hitCount:           0,
  });
}

// ── System Design content CMS ─────────────────────────────────────────────────
//
// Public article content lives in Firestore so fixing wording/typos does not
// require rebuilding the Cloud Run container. The checked-in JS topics remain
// a frontend fallback for local/dev outages while the CMS collection is empty.

function normaliseSystemDesignArticle(id, data) {
  const v = data || {};
  const en = v.en && typeof v.en === 'object' ? v.en : {};
  const fr = v.fr && typeof v.fr === 'object' ? v.fr : {};
  return {
    id,
    category:    String(v.category || 'architecture'),
    icon:        String(v.icon || 'article'),
    status:      String(v.status || 'Published'),
    tags:        Array.isArray(v.tags) ? v.tags.map(String).slice(0, 12) : [],
    readMinutes: Number(v.readMinutes || 5),
    stub:        !!v.stub,
    order:       Number(v.order || 999),
    updatedAt:   v.updatedAt?.toMillis ? v.updatedAt.toMillis() : null,
    en: {
      title:    String(en.title || v.title || id),
      subtitle: String(en.subtitle || v.subtitle || ''),
      body:     String(en.body || v.bodyHtml || ''),
    },
    fr: {
      title:    String(fr.title || en.title || v.title || id),
      subtitle: String(fr.subtitle || en.subtitle || v.subtitle || ''),
      body:     String(fr.body || en.body || v.bodyHtml || ''),
    },
  };
}

async function listPublishedSystemDesignArticles() {
  const snap = await getDb().collection(SYSTEM_DESIGN_COLLECTION).get();
  return snap.docs
    .map((doc) => normaliseSystemDesignArticle(doc.id, doc.data()))
    .filter((article) => article.status.toLowerCase() === 'published' || article.stub)
    .sort((a, b) => a.order - b.order || a.en.title.localeCompare(b.en.title));
}

async function listSystemDesignArticles() {
  const snap = await getDb().collection(SYSTEM_DESIGN_COLLECTION).get();
  return snap.docs
    .map((doc) => normaliseSystemDesignArticle(doc.id, doc.data()))
    .sort((a, b) => a.order - b.order || a.en.title.localeCompare(b.en.title));
}

async function getSystemDesignArticle(id) {
  const snap = await getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return normaliseSystemDesignArticle(snap.id, snap.data());
}

async function upsertSystemDesignArticle(article, { publishedBy } = {}) {
  if (!article || typeof article !== 'object') {
    throw new Error('upsertSystemDesignArticle: article object is required.');
  }
  const id = String(article.id || article.slug || '').trim();
  if (!id) throw new Error('upsertSystemDesignArticle: id or slug is required.');

  const ref = getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(id);
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data() || {}) : {};
    const nextVersion = Number(previous.version || 0) + 1;
    const now = FieldValue.serverTimestamp();
    const payload = {
      category:    String(article.category || previous.category || 'architecture'),
      icon:        String(article.icon || previous.icon || 'article'),
      status:      String(article.status || previous.status || 'Published'),
      tags:        Array.isArray(article.tags) ? article.tags.map(String).slice(0, 12) : [],
      readMinutes: Number(article.readMinutes || previous.readMinutes || 5),
      stub:        !!article.stub,
      order:       Number(article.order || previous.order || 999),
      en:          article.en && typeof article.en === 'object' ? article.en : {},
      fr:          article.fr && typeof article.fr === 'object' ? article.fr : {},
      version:     nextVersion,
      updatedAt:   now,
      updatedBy:   String(publishedBy || 'local-script'),
    };
    if (!snap.exists) payload.createdAt = now;

    tx.set(ref, payload, { merge: true });
    tx.set(ref.collection('versions').doc(String(nextVersion)), {
      ...payload,
      capturedAt: now,
    });
    return { id, version: nextVersion };
  });
}

/**
 * Moves the active chat into /users/{uid}/inquiries and clears it. Used after
 * a successful Recruiter_Inquiry__c create so we keep history but the next
 * conversation starts clean.
 */
async function completeActiveChat(uid, { salesforceId, alreadySubmitted } = {}) {
  const ref = activeDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const d = snap.data() || {};
  await getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(INQUIRIES_COLLECTION)
    .add({
      completedAt:      FieldValue.serverTimestamp(),
      startedAt:        d.startedAt || null,
      step:             d.step || 0,
      answers:          d.answers || {},
      messages:         d.messages || [],
      salesforceId:     salesforceId || null,
      alreadySubmitted: !!alreadySubmitted,
    });

  await ref.delete();
}

// ── Recommendation operations ────────────────────────────────────────────────
//
// /recommendations/{uid} — one document per Google-authenticated submitter.
//
// Why Firestore is the public read model (not Salesforce):
//   - The portfolio page renders the recommendation list on every load.
//   - Hitting Salesforce on every page load would burn API request budget
//     and add 300–800ms of latency to first contentful paint.
//   - Firestore reads are <50ms, free up to 50K/day, and globally cached.
//
// Salesforce stays the system of record (the writes go there too on POST,
// see services/salesforce/recommendation.js). The reply path is the
// inverse: I write the reply in Salesforce, an Apex trigger calls back
// into Cloud Run via Named Credential, and that handler updates the
// document here. So Firestore is always converging to mirror Salesforce.
//
// The doc id IS the Google sub claim (uid). That makes recommendations
// idempotent for free — same person re-submits → same doc → updates in
// place. No client-side Idempotency-Key plumbing needed.

const RECOMMENDATIONS_COLLECTION = 'recommendations';

function recommendationDocRef(uid) {
  return getDb().collection(RECOMMENDATIONS_COLLECTION).doc(uid);
}

/**
 * Upsert a recommendation. The document id is the submitter's Google uid,
 * so calling this twice for the same uid updates the existing row.
 *
 * On first write, sets `submittedAt`. On subsequent writes, only `updatedAt`
 * advances — the original submission timestamp is preserved.
 *
 * The reply / repliedAt fields are NEVER touched here. They flow in only
 * via writeRecommendationReply() (called from the SF → GCP callback).
 */
async function upsertRecommendation({
  uid, email, emailVerified, hostedDomain, name, company, avatarUrl, text,
}) {
  const ref = recommendationDocRef(uid);
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now  = FieldValue.serverTimestamp();

    const base = {
      uid,
      email:         email || '',
      emailVerified: !!emailVerified,
      hostedDomain:  hostedDomain || '',
      name:          name || '',
      company:       company || '',
      avatarUrl:     avatarUrl || null,
      text:          String(text || '').slice(0, 5000),
      status:        'Active',
      updatedAt:     now,
    };

    if (snap.exists) {
      tx.update(ref, base);
      return { isNew: false };
    }
    tx.set(ref, Object.assign({}, base, {
      submittedAt: now,
      reply:       null,
      repliedAt:   null,
    }));
    return { isNew: true };
  });
}

/**
 * Public read — returns recommendations for the page.
 *
 * - Filters by status === 'Active' so hidden ones never reach the client.
 * - Strips PII (raw email, hostedDomain) — only company is public.
 * - Newest first by submittedAt.
 * - Caps at 100 to bound payload size.
 */
async function listActiveRecommendations() {
  const snap = await getDb()
    .collection(RECOMMENDATIONS_COLLECTION)
    .where('status', '==', 'Active')
    .orderBy('submittedAt', 'desc')
    .limit(100)
    .get();

  return snap.docs.map((d) => {
    const v = d.data() || {};
    return {
      id:          d.id,
      name:        v.name        || '',
      company:     v.company     || '',
      avatarUrl:   v.avatarUrl   || null,
      text:        v.text        || '',
      reply:       v.reply       || null,
      // Both timestamps flow to the client so the UI can show either
      // "submitted 3h ago" (first write) or "updated 1m ago" (a later
      // edit). The list ordering still uses submittedAt — we don't want
      // editing an old recommendation to bump it to the top of the page.
      submittedAt: v.submittedAt && v.submittedAt.toMillis ? v.submittedAt.toMillis() : null,
      updatedAt:   v.updatedAt   && v.updatedAt.toMillis   ? v.updatedAt.toMillis()   : null,
      repliedAt:   v.repliedAt   && v.repliedAt.toMillis   ? v.repliedAt.toMillis()   : null,
    };
  });
}

/**
 * Write a reply onto an existing recommendation. Called from the SF → GCP
 * callback handler when I update Reply__c on the SF record.
 *
 * If the recommendation doesn't exist yet (e.g. this fires before the
 * recommendation arrived in Firestore for some reason), we no-op rather
 * than create a partial row — the reply will be re-applied on the next
 * trigger fire. Safe by construction.
 *
 * Note on `repliedAt`: we deliberately ignore whatever timestamp the
 * Apex callout sent in the body and use the Firestore server clock
 * instead. Two reasons:
 *   1. Trust — the callback is authenticated by a shared secret, but
 *      the body itself is still client-supplied data; "when did this
 *      happen" is the kind of field we don't want a bug (or attacker)
 *      able to spoof.
 *   2. Consistency — `submittedAt` and `updatedAt` are also server
 *      timestamps, so all three fields share a single clock and stay
 *      monotonically ordered. Salesforce stamps its own `Replied_At__c`
 *      on its end, so each system is the source of truth for its own
 *      copy of the timestamp; they don't need to be byte-equal.
 *
 * Returns { applied: boolean } so the caller can choose how to respond.
 */
async function writeRecommendationReply(uid, { reply /* repliedAt ignored — see above */ }) {
  const ref = recommendationDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return { applied: false, reason: 'not_found' };

  const now = FieldValue.serverTimestamp();
  await ref.update({
    reply:     String(reply || '').slice(0, 1000),
    repliedAt: now,
    updatedAt: now,
  });
  return { applied: true };
}

/**
 * Hard-delete a recommendation by uid.
 *
 * The user explicitly asked for "soft-delete in Salesforce, hard-delete
 * in Firestore" so the public read model goes clean immediately while
 * SF retains the audit trail. Cascade is implicit — the reply lives on
 * the same Firestore doc, so deleting the doc removes the reply too,
 * matching the user's "cascade-delete the reply" intent.
 *
 * Idempotent: deleting a non-existent doc is silently fine (the
 * user-facing intent is "make it gone", and from their POV it already
 * was). The boolean lets callers distinguish for logging / telemetry.
 *
 * @returns {Promise<{ deleted: boolean }>}
 */
async function deleteRecommendation(uid) {
  const ref = recommendationDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  await ref.delete();
  return { deleted: true };
}

// ── Admin-managed app configuration ──────────────────────────────────────────

async function getContactPolicyConfig() {
  const snap = await getDb().collection(APP_CONFIG_COLLECTION).doc(CONTACT_POLICY_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    allowedDomains: Object.prototype.hasOwnProperty.call(data, 'allowedDomains') && Array.isArray(data.allowedDomains)
      ? data.allowedDomains.map(String)
      : undefined,
    personalDomains: Object.prototype.hasOwnProperty.call(data, 'personalDomains') && Array.isArray(data.personalDomains)
      ? data.personalDomains.map(String)
      : undefined,
    allowedEmails: Object.prototype.hasOwnProperty.call(data, 'allowedEmails') && Array.isArray(data.allowedEmails)
      ? data.allowedEmails.map(String)
      : undefined,
    blockedDomains: Object.prototype.hasOwnProperty.call(data, 'blockedDomains') && Array.isArray(data.blockedDomains)
      ? data.blockedDomains.map(String)
      : undefined,
    updatedBy:      data.updatedBy || null,
    updatedAt:      data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
  };
}

function cleanStringList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
}

async function upsertContactPolicyConfig({ allowedDomains, personalDomains, allowedEmails, blockedDomains, updatedBy }) {
  await getDb().collection(APP_CONFIG_COLLECTION).doc(CONTACT_POLICY_DOC).set({
    allowedDomains:  cleanStringList(allowedDomains),
    personalDomains: cleanStringList(personalDomains),
    allowedEmails:   cleanStringList(allowedEmails),
    blockedDomains:  cleanStringList(blockedDomains),
    updatedBy:      updatedBy || null,
    updatedAt:      FieldValue.serverTimestamp(),
  }, { merge: true });
  return getContactPolicyConfig();
}

module.exports = {
  getDb,
  getUser,
  upsertUserVisit,
  getActiveChat,
  upsertActiveChat,
  clearActiveChat,
  completeActiveChat,
  getActiveAtlasConversation,
  appendAtlasTurn,
  clearActiveAtlasConversation,
  getAtlasUsageSummary,
  appendAtlasUsageEvent,
  getAtlasCacheEntry,
  saveAtlasCacheEntry,
  listPublishedSystemDesignArticles,
  listSystemDesignArticles,
  getSystemDesignArticle,
  upsertSystemDesignArticle,
  upsertRecommendation,
  listActiveRecommendations,
  writeRecommendationReply,
  deleteRecommendation,
  getContactPolicyConfig,
  upsertContactPolicyConfig,
};
