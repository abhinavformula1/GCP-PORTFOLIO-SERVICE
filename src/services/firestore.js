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

module.exports = {
  getDb,
  getUser,
  upsertUserVisit,
  getActiveChat,
  upsertActiveChat,
  clearActiveChat,
  completeActiveChat,
};
