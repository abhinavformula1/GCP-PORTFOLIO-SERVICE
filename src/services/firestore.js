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
const crypto = require('crypto');

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
const ANALYTICS_DAILY_COLLECTION = 'analyticsDaily';
const ANALYTICS_MONTHLY_COLLECTION = 'analyticsMonthly';

function hashKey(value) {
  const raw = String(value || '').trim();
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function safeHost(referrer) {
  const raw = String(referrer || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname || '';
  } catch (_) {
    return '';
  }
}

function normaliseReferrerKey({ referrer, siteHost }) {
  const host = safeHost(referrer);
  if (!host) return 'direct';
  const own = String(siteHost || '').trim().toLowerCase();
  if (own && host.toLowerCase() === own) return 'internal';
  return host.toLowerCase();
}

function normaliseUtm(utm) {
  if (!utm || typeof utm !== 'object') return null;
  const source = String(utm.source || '').trim().slice(0, 80);
  const medium = String(utm.medium || '').trim().slice(0, 80);
  const campaign = String(utm.campaign || '').trim().slice(0, 120);
  const content = String(utm.content || '').trim().slice(0, 120);
  const term = String(utm.term || '').trim().slice(0, 120);
  if (!source && !medium && !campaign && !content && !term) return null;
  return { source, medium, campaign, content, term };
}

function utmKey(utm) {
  const u = normaliseUtm(utm);
  if (!u) return '';
  return [u.source || '-', u.medium || '-', u.campaign || '-', u.content || '-', u.term || '-'].join('|');
}

function shouldIgnoreAnalyticsPath(path) {
  const raw = String(path || '').trim();
  if (!raw) return true;
  const p = raw.split('#')[0];
  const base = p.split('?')[0] || '';

  // Never track non-page surfaces.
  if (base.startsWith('/api/')) return true;
  if (base.startsWith('/assets/')) return true;
  if (base.startsWith('/admin/')) return true;
  if (base.startsWith('/print/')) return true;

  // Explicit dev/test artifacts (we used these in smoke tests).
  if (base === '/test' || base.startsWith('/test/')) return true;
  if (base === '/sd' || base.startsWith('/sd/')) return true;

  // Obvious noise.
  if (base === '/favicon.ico') return true;
  if (base === '/robots.txt' || base === '/sitemap.xml') return true;
  return false;
}

function normaliseUser(user, clientId) {
  const cid = String(clientId || '').trim();
  const u = user && typeof user === 'object' ? user : null;
  const sub = u ? String(u.sub || '').trim() : '';
  const name = u ? String(u.name || '').trim() : '';
  if (sub) {
    return { key: `u:${sub}`, kind: 'signed', sub, name: name || null };
  }
  return { key: `c:${cid}`, kind: 'anon', sub: '', name: null };
}

function toDateId(d) {
  const dt = d instanceof Date ? d : new Date();
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toMonthId(d) {
  const dt = d instanceof Date ? d : new Date();
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function looksLikeMonthId(value) {
  return /^\d{4}-\d{2}$/.test(String(value || ''));
}

async function trackPageView({ clientId, path, referrer, lang, host, device, utm, tz, region, user }) {
  return recordAnalyticsEvent({
    type: 'page_view',
    clientId,
    path,
    referrer,
    lang,
    host,
    device,
    tz,
    region,
    utm,
    user,
  });
}

async function recordAnalyticsEvent({
  type,
  clientId,
  path,
  referrer,
  lang,
  host,
  device,
  tz,
  region,
  geo,
  utm,
  dwellMs,
  scrollPct,
  pdfKind,
  pdfId,
  user,
}) {
  const cid = String(clientId || '').trim();
  const p = String(path || '').trim().slice(0, 240);
  if (!cid || cid.length < 8) throw new Error('trackPageView: clientId is required.');
  const eventType = String(type || '').trim();
  if (!eventType) throw new Error('recordAnalyticsEvent: type is required.');

  // Drop dev/test/noise paths early to keep analytics clean.
  if ((eventType === 'page_view' || eventType === 'engagement') && shouldIgnoreAnalyticsPath(p)) {
    return null;
  }

  const refKey = normaliseReferrerKey({ referrer, siteHost: host });
  const u = normaliseUtm(utm);
  const uKey = utmKey(u);
  const dev = (String(device || '').trim() === 'mobile') ? 'mobile' : 'desktop';
  const tzId = String(tz || '').trim().slice(0, 60) || null;
  const regionId = String(region || '').trim().slice(0, 8) || null;
  const userInfo = normaliseUser(user, cid);
  const geoObj = geo && typeof geo === 'object' ? geo : null;
  const geoCountry = geoObj && geoObj.country ? String(geoObj.country).trim().slice(0, 2).toUpperCase() : null;
  const geoRegion = geoObj && geoObj.region ? String(geoObj.region).trim().slice(0, 40) : null;
  const geoCity = geoObj && geoObj.city ? String(geoObj.city).trim().slice(0, 80) : null;
  const geoSource = geoObj && geoObj.source ? String(geoObj.source).trim().slice(0, 40) : null;

  const now = new Date();
  const dayId = toDateId(now);
  const monthId = toMonthId(now);

  const db = getDb();
  const dailyRef = db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId);
  const monthlyRef = db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId);
  const dailyVisitorRef = dailyRef.collection('visitors').doc(cid);
  const monthlyVisitorRef = monthlyRef.collection('visitors').doc(cid);

  const dailyUserRef = dailyRef.collection('users').doc(hashKey(userInfo.key));
  const dailyUserPagesRef = p ? dailyUserRef.collection('pages').doc(hashKey(p)) : null;

  const monthlyUserRef = monthlyRef.collection('users').doc(hashKey(userInfo.key));

  const monthlyPageRef = monthlyRef.collection('pages').doc(hashKey(p));
  const monthlyReferrerRef = monthlyRef.collection('referrers').doc(hashKey(refKey));
  const monthlyDeviceRef = monthlyRef.collection('devices').doc(dev);
  const monthlyCampaignRef = uKey ? monthlyRef.collection('campaigns').doc(hashKey(uKey)) : null;

  // Transaction ensures visitor uniqueness counters are correct.
  return db.runTransaction(async (tx) => {
    const [dailyVisitorSnap, monthlyVisitorSnap] = await Promise.all([
      tx.get(dailyVisitorRef),
      tx.get(monthlyVisitorRef),
    ]);

    const nowTs = FieldValue.serverTimestamp();
    const dayBase = { updatedAt: nowTs };
    const monthBase = { updatedAt: nowTs };

    if (eventType === 'page_view') {
      if (!p) throw new Error('recordAnalyticsEvent: path is required for page_view.');
      tx.set(dailyRef, Object.assign({}, dayBase, { pageViews: FieldValue.increment(1) }), { merge: true });
      tx.set(monthlyRef, Object.assign({}, monthBase, { pageViews: FieldValue.increment(1) }), { merge: true });
    } else if (eventType === 'engagement') {
      const ms = Math.max(0, Math.min(Number(dwellMs || 0), 60 * 60 * 1000));
      tx.set(dailyRef, Object.assign({}, dayBase, { readMs: FieldValue.increment(ms) }), { merge: true });
      tx.set(monthlyRef, Object.assign({}, monthBase, { readMs: FieldValue.increment(ms) }), { merge: true });
    } else if (eventType === 'pdf_download') {
      tx.set(dailyRef, Object.assign({}, dayBase, { pdfDownloads: FieldValue.increment(1) }), { merge: true });
      tx.set(monthlyRef, Object.assign({}, monthBase, { pdfDownloads: FieldValue.increment(1) }), { merge: true });
    } else {
      tx.set(dailyRef, dayBase, { merge: true });
      tx.set(monthlyRef, monthBase, { merge: true });
    }

    // Monthly breakouts (views)
    if (eventType === 'page_view') {
      tx.set(monthlyPageRef, {
        path: p,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });

      tx.set(monthlyReferrerRef, {
        referrer: refKey,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });

      tx.set(monthlyDeviceRef, {
        device: dev,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });

      if (monthlyCampaignRef) {
        tx.set(monthlyCampaignRef, {
          utm: u,
          key: uKey,
          pageViews: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }

    // Unique visitor for the day
    if (eventType === 'page_view' && !dailyVisitorSnap.exists) {
      tx.set(dailyVisitorRef, {
        firstSeenAt: nowTs,
        path: p,
        referrer: String(referrer || '').slice(0, 240) || null,
        lang: String(lang || '').slice(0, 12) || null,
      });
      tx.set(dailyRef, { uniqueVisitors: FieldValue.increment(1) }, { merge: true });
    }

    // Unique visitor for the month
    if (eventType === 'page_view' && !monthlyVisitorSnap.exists) {
      tx.set(monthlyVisitorRef, {
        firstSeenAt: nowTs,
        path: p,
        referrer: String(referrer || '').slice(0, 240) || null,
        lang: String(lang || '').slice(0, 12) || null,
      });
      tx.set(monthlyRef, { uniqueVisitors: FieldValue.increment(1) }, { merge: true });
    }

    // Per-user daily rollup (for "today" dashboard)
    const userBase = {
      kind: userInfo.kind,
      sub: userInfo.sub || null,
      name: userInfo.name || null,
      tz: tzId,
      region: regionId,
      device: dev,
      lastSeenAt: nowTs,
      geoCountry,
      geoRegion,
      geoCity,
      geoSource,
    };
    tx.set(dailyUserRef, userBase, { merge: true });

    // Per-user monthly rollup (for "who are the uniques this month?")
    const anonLabel = userInfo.kind === 'anon'
      ? ('anon-' + hashKey(cid).slice(0, 6))
      : null;
    tx.set(monthlyUserRef, Object.assign({}, userBase, {
      label: anonLabel,
      lastSeenAt: nowTs,
    }), { merge: true });

    if (eventType === 'page_view') {
      tx.set(dailyUserRef, {
        pageViews: FieldValue.increment(1),
        firstSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(monthlyUserRef, {
        pageViews: FieldValue.increment(1),
        firstSeenAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (dailyUserPagesRef) {
        tx.set(dailyUserPagesRef, { path: p, pageViews: FieldValue.increment(1), updatedAt: nowTs }, { merge: true });
      }
    }
    if (eventType === 'engagement') {
      const ms = Math.max(0, Math.min(Number(dwellMs || 0), 60 * 60 * 1000));
      tx.set(dailyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      tx.set(monthlyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      if (dailyUserPagesRef) {
        tx.set(dailyUserPagesRef, { path: p, readMs: FieldValue.increment(ms), updatedAt: nowTs }, { merge: true });
      }
      const sp = Math.max(0, Math.min(Number(scrollPct || 0), 100));
      if (dailyUserPagesRef && sp) {
        tx.set(dailyUserPagesRef, { lastScrollPct: sp }, { merge: true });
      }
    }
    if (eventType === 'pdf_download') {
      tx.set(dailyUserRef, { pdfDownloads: FieldValue.increment(1) }, { merge: true });
      tx.set(monthlyUserRef, { pdfDownloads: FieldValue.increment(1) }, { merge: true });
      if (pdfKind || pdfId) {
        const k = (pdfKind || 'pdf') + ':' + (pdfId || 'unknown');
        tx.set(dailyUserRef.collection('pdfs').doc(hashKey(k)), {
          kind: pdfKind || 'pdf',
          id: pdfId || null,
          downloads: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }
  });
}

async function getAnalyticsOverview({ month } = {}) {
  const now = new Date();
  const monthId = looksLikeMonthId(month) ? String(month) : toMonthId(now);

  const db = getDb();
  const monthlySnap = await db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId).get();
  const monthly = monthlySnap.exists ? (monthlySnap.data() || {}) : {};

  const [topPagesSnap, topRefsSnap, topCampaignsSnap, recentUsersSnap] = await Promise.all([
    db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId).collection('pages')
      .orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId).collection('referrers')
      .orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId).collection('campaigns')
      .orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId).collection('users')
      .orderBy('lastSeenAt', 'desc').limit(12).get().catch(() => null),
  ]);

  const topPages = topPagesSnap && topPagesSnap.docs
    ? topPagesSnap.docs.map((d) => {
      const data = d.data() || {};
      return { path: String(data.path || ''), pageViews: Number(data.pageViews || 0) };
    })
    : [];

  const topReferrers = topRefsSnap && topRefsSnap.docs
    ? topRefsSnap.docs.map((d) => {
      const data = d.data() || {};
      return { referrer: String(data.referrer || ''), pageViews: Number(data.pageViews || 0) };
    })
    : [];

  const topCampaigns = topCampaignsSnap && topCampaignsSnap.docs
    ? topCampaignsSnap.docs.map((d) => {
      const data = d.data() || {};
      return {
        utm: data.utm || null,
        key: String(data.key || ''),
        pageViews: Number(data.pageViews || 0),
      };
    })
    : [];

  const recentUsers = recentUsersSnap && recentUsersSnap.docs
    ? recentUsersSnap.docs.map((d) => {
      const data = d.data() || {};
      return {
        kind: data.kind || 'anon',
        name: data.name || null,
        label: data.label || null,
        region: data.region || null,
        geoCountry: data.geoCountry || null,
        geoRegion: data.geoRegion || null,
        geoCity: data.geoCity || null,
        device: data.device || null,
        lastSeenAt: data.lastSeenAt && data.lastSeenAt.toMillis ? data.lastSeenAt.toMillis() : null,
      };
    })
    : [];

  // Avoid indexed queries. We store daily docs by `YYYY-MM-DD` so we can
  // deterministically read the last N days without orderBy().
  const baseUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const refs = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(baseUtc);
    d.setUTCDate(d.getUTCDate() - i);
    refs.push(db.collection(ANALYTICS_DAILY_COLLECTION).doc(toDateId(d)));
  }
  const snaps = await db.getAll.apply(db, refs);
  const series = snaps.map((snap) => {
    const data = snap && snap.exists ? (snap.data() || {}) : {};
    return {
      date: snap && snap.id ? snap.id : '',
      pageViews: Number(data.pageViews || 0),
      uniqueVisitors: Number(data.uniqueVisitors || 0),
    };
  });

  return {
    month: monthId,
    totals: {
      pageViews: Number(monthly.pageViews || 0),
      uniqueVisitors: Number(monthly.uniqueVisitors || 0),
      pdfDownloads: Number(monthly.pdfDownloads || 0),
    },
    series,
    topPages,
    topReferrers,
    topCampaigns,
    recentUsers,
  };
}

async function getAnalyticsToday() {
  const now = new Date();
  const dayId = toDateId(now);
  const db = getDb();
  const usersSnap = await db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId).collection('users').get();
  const users = (usersSnap && usersSnap.docs ? usersSnap.docs : []).map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      kind: data.kind || 'anon',
      sub: data.sub || null,
      name: data.name || null,
      region: data.region || null,
      geoCountry: data.geoCountry || null,
      geoRegion: data.geoRegion || null,
      geoCity: data.geoCity || null,
      tz: data.tz || null,
      device: data.device || null,
      pageViews: Number(data.pageViews || 0),
      readMs: Number(data.readMs || 0),
      pdfDownloads: Number(data.pdfDownloads || 0),
      lastSeenAt: data.lastSeenAt && data.lastSeenAt.toMillis ? data.lastSeenAt.toMillis() : null,
      firstSeenAt: data.firstSeenAt && data.firstSeenAt.toMillis ? data.firstSeenAt.toMillis() : null,
    };
  }).sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0));

  // Top pages per user (best effort, small N)
  const enriched = await Promise.all(users.slice(0, 50).map(async (u) => {
    try {
      const pagesSnap = await db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId)
        .collection('users').doc(u.id).collection('pages')
        .orderBy('pageViews', 'desc').limit(5).get();
      const pages = (pagesSnap && pagesSnap.docs ? pagesSnap.docs : []).map((d) => {
        const data = d.data() || {};
        return {
          path: String(data.path || ''),
          pageViews: Number(data.pageViews || 0),
          readMs: Number(data.readMs || 0),
        };
      });
      return Object.assign({}, u, { pages });
    } catch (_) {
      return Object.assign({}, u, { pages: [] });
    }
  }));

  return { day: dayId, users: enriched };
}

async function cleanupAnalyticsTestData({ month, paths } = {}) {
  const now = new Date();
  const monthId = looksLikeMonthId(month) ? String(month) : toMonthId(now);
  const kill = Array.isArray(paths) && paths.length
    ? paths.map((p) => String(p || '').trim()).filter(Boolean)
    : ['/test', '/sd'];

  const db = getDb();
  const monthlyRef = db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId);

  // Load all pages + visitors for this month (typically small).
  const [pagesSnap, visitorsSnap] = await Promise.all([
    monthlyRef.collection('pages').get(),
    monthlyRef.collection('visitors').get(),
  ]);

  const pagesToDelete = [];
  let removedPageViews = 0;
  (pagesSnap && pagesSnap.docs ? pagesSnap.docs : []).forEach((d) => {
    const data = d.data() || {};
    const path = String(data.path || '');
    const base = path.split('?')[0].split('#')[0];
    if (kill.includes(base)) {
      removedPageViews += Number(data.pageViews || 0);
      pagesToDelete.push(d.ref);
    }
  });

  const visitorsToDelete = [];
  let removedVisitors = 0;
  (visitorsSnap && visitorsSnap.docs ? visitorsSnap.docs : []).forEach((d) => {
    const data = d.data() || {};
    const path = String(data.path || '');
    const base = path.split('?')[0].split('#')[0];
    if (kill.includes(base)) {
      removedVisitors += 1;
      visitorsToDelete.push(d.ref);
    }
  });

  // Batch delete + counter correction. We can safely decrement pageViews and
  // uniqueVisitors by the removed counts we can prove from docs.
  const batch = db.batch();
  pagesToDelete.forEach((ref) => batch.delete(ref));
  visitorsToDelete.forEach((ref) => batch.delete(ref));
  batch.set(monthlyRef, {
    pageViews: removedPageViews ? FieldValue.increment(-Math.abs(removedPageViews)) : FieldValue.increment(0),
    uniqueVisitors: removedVisitors ? FieldValue.increment(-Math.abs(removedVisitors)) : FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return {
    month: monthId,
    removed: {
      pages: pagesToDelete.length,
      pageViews: removedPageViews,
      visitors: removedVisitors,
    },
  };
}

async function cleanupAnalyticsTodayTestUsers({ day, names, subs, paths } = {}) {
  const now = new Date();
  const dayId = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : toDateId(now);
  const killNames = Array.isArray(names) ? names.map((v) => String(v || '').trim()).filter(Boolean) : ['Test User'];
  const killSubs = Array.isArray(subs) ? subs.map((v) => String(v || '').trim()).filter(Boolean) : ['user-sub-123'];
  const killPaths = Array.isArray(paths) && paths.length
    ? paths.map((p) => String(p || '').trim()).filter(Boolean)
    : ['/test', '/sd'];

  const db = getDb();
  const dailyRef = db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId);
  const usersCol = dailyRef.collection('users');
  const visitorsCol = dailyRef.collection('visitors');

  const [usersSnap, visitorsSnap] = await Promise.all([
    usersCol.get(),
    visitorsCol.get(),
  ]);

  const userDocs = usersSnap && usersSnap.docs ? usersSnap.docs : [];
  const toDeleteUsers = [];
  let removedUserPageViews = 0;
  let removedUserReadMs = 0;
  let removedUserPdf = 0;

  userDocs.forEach((doc) => {
    const d = doc.data() || {};
    const name = String(d.name || '').trim();
    const sub = String(d.sub || '').trim();
    const isMatch = (name && killNames.includes(name)) || (sub && killSubs.includes(sub));
    if (!isMatch) return;
    removedUserPageViews += Number(d.pageViews || 0);
    removedUserReadMs += Number(d.readMs || 0);
    removedUserPdf += Number(d.pdfDownloads || 0);
    toDeleteUsers.push(doc.ref);
  });

  // Delete visitor docs that point at known dev/test paths (e.g. /sd).
  const visitorDocs = visitorsSnap && visitorsSnap.docs ? visitorsSnap.docs : [];
  const toDeleteVisitors = [];
  visitorDocs.forEach((doc) => {
    const d = doc.data() || {};
    const path = String(d.path || '');
    const base = path.split('?')[0].split('#')[0];
    if (killPaths.includes(base)) {
      toDeleteVisitors.push(doc.ref);
    }
  });

  async function deleteSubcollection(parentRef, subName) {
    try {
      const snap = await parentRef.collection(subName).get();
      const docs = snap && snap.docs ? snap.docs : [];
      for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (_) {}
  }

  // Remove child docs (pages, pdfs) for each deleted user.
  for (const userRef of toDeleteUsers) {
    await deleteSubcollection(userRef, 'pages');
    await deleteSubcollection(userRef, 'pdfs');
  }

  // Delete user + visitor docs in batches.
  const deleteRefs = toDeleteUsers.concat(toDeleteVisitors);
  for (let i = 0; i < deleteRefs.length; i += 450) {
    const batch = db.batch();
    deleteRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // Correct daily rollup counters (best-effort).
  const removedVisitors = toDeleteVisitors.length;
  await dailyRef.set({
    pageViews: removedUserPageViews ? FieldValue.increment(-Math.abs(removedUserPageViews)) : FieldValue.increment(0),
    readMs: removedUserReadMs ? FieldValue.increment(-Math.abs(removedUserReadMs)) : FieldValue.increment(0),
    pdfDownloads: removedUserPdf ? FieldValue.increment(-Math.abs(removedUserPdf)) : FieldValue.increment(0),
    uniqueVisitors: removedVisitors ? FieldValue.increment(-Math.abs(removedVisitors)) : FieldValue.increment(0),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    day: dayId,
    removed: {
      users: toDeleteUsers.length,
      visitors: removedVisitors,
      pageViews: removedUserPageViews,
      readMs: removedUserReadMs,
      pdfDownloads: removedUserPdf,
    },
  };
}

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

const ALLOWED_CONTENT_TYPES = new Set(['system-design', 'architecture', 'case-study']);
function normaliseContentType(raw, categoryFallback) {
  const explicit = String(raw || '').trim();
  if (ALLOWED_CONTENT_TYPES.has(explicit)) return explicit;
  const category = String(categoryFallback || '').trim().toLowerCase();
  if (category === 'case-study' || category === 'case_study' || category === 'casestudy') return 'case-study';
  if (category === 'architecture') return 'architecture';
  return 'system-design';
}

function sanitiseArticleBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      let plain;
      try {
        plain = JSON.parse(JSON.stringify(block));
      } catch {
        return null;
      }
      if (!plain || typeof plain !== 'object') return null;
      plain.id = String(plain.id || '');
      plain.type = String(plain.type || 'paragraph');
      // Firestore does not support nested arrays.
      // Convert matrix rows from [['c0','c1',...]] to [{cells:['c0','c1',...]}].
      if (plain.type === 'matrix' && Array.isArray(plain.rows)) {
        plain.rows = plain.rows.map((row) =>
          Array.isArray(row) ? { cells: row.map(String) } : row
        );
      }
      return plain;
    })
    .filter(Boolean)
    .slice(0, 200);
}

function normaliseSystemDesignArticle(id, data) {
  const v = data || {};
  const en = v.en && typeof v.en === 'object' ? v.en : {};
  const fr = v.fr && typeof v.fr === 'object' ? v.fr : {};
  const blocks = sanitiseArticleBlocks(v.blocks);
  return {
    id,
    // category is legacy; contentType is the primary filter axis.
    category:    v.category != null ? String(v.category) : '',
    contentType: normaliseContentType(v.contentType, v.category),
    icon:        String(v.icon || 'article'),
    status:      String(v.status || 'Published'),
    tags:        Array.isArray(v.tags) ? v.tags.map(String).slice(0, 12) : [],
    readMinutes: v.readMinutes ? Number(v.readMinutes) : null,
    tier:        String(v.tier || 'free'),
    stub:        !!v.stub,
    order:       Number(v.order || 999),
    blocks,
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

    const contentType = normaliseContentType(
      article.contentType !== undefined ? article.contentType : previous.contentType,
      article.category !== undefined ? article.category : previous.category
    );
    const tags = article.tags !== undefined
      ? (Array.isArray(article.tags) ? article.tags.map(String).slice(0, 12) : [])
      : (Array.isArray(previous.tags) ? previous.tags.map(String).slice(0, 12) : []);
    const blocks = article.blocks !== undefined
      ? sanitiseArticleBlocks(article.blocks)
      : sanitiseArticleBlocks(previous.blocks);
    const thumbnail = article.thumbnail !== undefined
      ? (typeof article.thumbnail === 'string' ? article.thumbnail : '')
      : (typeof previous.thumbnail === 'string' ? previous.thumbnail : '');
    const enDoc = (article.en && typeof article.en === 'object')
      ? article.en
      : (previous.en && typeof previous.en === 'object' ? previous.en : {});
    const frDoc = (article.fr && typeof article.fr === 'object')
      ? article.fr
      : (previous.fr && typeof previous.fr === 'object' ? previous.fr : {});

    const payload = {
      contentType,
      icon:        String(article.icon || previous.icon || 'article'),
      status:      String(article.status || previous.status || 'Published'),
      tags,
      readMinutes: article.readMinutes !== undefined
        ? (article.readMinutes ? Number(article.readMinutes) : null)
        : (previous.readMinutes ? Number(previous.readMinutes) : null),
      tier:        String(article.tier || previous.tier || 'free'),
      stub:        article.stub !== undefined ? !!article.stub : !!previous.stub,
      order:       Number(article.order || previous.order || 999),
      blocks,
      thumbnail,
      en:          enDoc,
      fr:          frDoc,
      version:     nextVersion,
      updatedAt:   now,
      updatedBy:   String(publishedBy || 'local-script'),
    };
    // Persist legacy category only when explicitly supplied or already present.
    if (article.category !== undefined) payload.category = String(article.category || '');
    else if (previous.category !== undefined) payload.category = String(previous.category || '');
    if (!snap.exists) payload.createdAt = now;

    tx.set(ref, payload, { merge: true });
    tx.set(ref.collection('versions').doc(String(nextVersion)), {
      ...payload,
      capturedAt: now,
    });
    return { id, version: nextVersion };
  });
}

async function deleteSystemDesignArticle(id) {
  const articleId = String(id || '').trim();
  if (!articleId) return;
  await getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(articleId).delete();
}

// ── Tier configuration ────────────────────────────────────────────────────────
const TIER_CONFIG_COLLECTION = 'config';
const TIER_CONFIG_DOC        = 'tierSettings';

const DEFAULT_TIER_CONFIG = {
  free: {
    items: [
      { icon: 'article',  label: 'Popular Articles' },
    ],
  },
  premium: {
    items: [
      { icon: 'library_books',  label: 'All Articles' },
      { icon: 'support_agent',  label: 'Customer Support' },
      { icon: 'build',          label: 'Implementation Help' },
    ],
  },
};

async function getTierConfig() {
  const snap = await getDb().collection(TIER_CONFIG_COLLECTION).doc(TIER_CONFIG_DOC).get();
  if (!snap.exists) return DEFAULT_TIER_CONFIG;
  const d = snap.data() || {};
  return {
    free:    { items: Array.isArray(d.free?.items)    ? d.free.items    : DEFAULT_TIER_CONFIG.free.items },
    premium: { items: Array.isArray(d.premium?.items) ? d.premium.items : DEFAULT_TIER_CONFIG.premium.items },
  };
}

async function upsertTierConfig(config) {
  await getDb().collection(TIER_CONFIG_COLLECTION).doc(TIER_CONFIG_DOC).set({
    free:    { items: Array.isArray(config?.free?.items)    ? config.free.items    : [] },
    premium: { items: Array.isArray(config?.premium?.items) ? config.premium.items : [] },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── SEO / AEO configuration ───────────────────────────────────────────────────
const SEO_CONFIG_DOC = 'seoConfig';

const DEFAULT_SEO_CONFIG = {
  siteUrl:             'https://portfolio-service-647206478056.asia-southeast1.run.app',
  siteDescription:     'Senior Salesforce Application Engineer with 12+ years across Salesforce, GCP, MuleSoft and API integrations. Deep-dive system design articles on authentication, security, and enterprise architecture.',
  ogImageUrl:          '',
  adsensePublisherId:  '',
  jsonLdEnabled:       true,
  sitemapEnabled:      true,
  robotsNoindex:       false,
  hreflangFrEnabled:   false,
};

async function getSeoConfig() {
  const snap = await getDb().collection(TIER_CONFIG_COLLECTION).doc(SEO_CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SEO_CONFIG };
  const d = snap.data() || {};
  return {
    siteUrl:            String(d.siteUrl           || DEFAULT_SEO_CONFIG.siteUrl),
    siteDescription:    String(d.siteDescription   || DEFAULT_SEO_CONFIG.siteDescription),
    ogImageUrl:         String(d.ogImageUrl         || ''),
    adsensePublisherId: String(d.adsensePublisherId || ''),
    jsonLdEnabled:      d.jsonLdEnabled    !== false,
    sitemapEnabled:     d.sitemapEnabled   !== false,
    robotsNoindex:      !!d.robotsNoindex,
    hreflangFrEnabled:  !!d.hreflangFrEnabled,
  };
}

async function upsertSeoConfig(cfg) {
  await getDb().collection(TIER_CONFIG_COLLECTION).doc(SEO_CONFIG_DOC).set({
    siteUrl:            String(cfg.siteUrl           || DEFAULT_SEO_CONFIG.siteUrl),
    siteDescription:    String(cfg.siteDescription   || DEFAULT_SEO_CONFIG.siteDescription),
    ogImageUrl:         String(cfg.ogImageUrl         || ''),
    adsensePublisherId: String(cfg.adsensePublisherId || ''),
    jsonLdEnabled:      cfg.jsonLdEnabled    !== false,
    sitemapEnabled:     cfg.sitemapEnabled   !== false,
    robotsNoindex:      !!cfg.robotsNoindex,
    hreflangFrEnabled:  !!cfg.hreflangFrEnabled,
    updatedAt:          FieldValue.serverTimestamp(),
  });
}

// ── Atlas configuration ───────────────────────────────────────────────────────
const ATLAS_CONFIG_DOC = 'atlasConfig';

const DEFAULT_ATLAS_CONFIG = {
  enabledModels:        ['flash-lite', 'flash'],
  defaultModel:         'flash-lite',
  budgetCapInr:         100,
  modelSelectorVisible: true,
};

async function getAtlasConfig() {
  const snap = await getDb().collection(TIER_CONFIG_COLLECTION).doc(ATLAS_CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_ATLAS_CONFIG };
  const d = snap.data() || {};
  return {
    enabledModels:        Array.isArray(d.enabledModels) ? d.enabledModels : DEFAULT_ATLAS_CONFIG.enabledModels,
    defaultModel:         String(d.defaultModel         || DEFAULT_ATLAS_CONFIG.defaultModel),
    budgetCapInr:         typeof d.budgetCapInr === 'number' ? d.budgetCapInr : DEFAULT_ATLAS_CONFIG.budgetCapInr,
    modelSelectorVisible: d.modelSelectorVisible !== false,
  };
}

async function upsertAtlasConfig(cfg) {
  await getDb().collection(TIER_CONFIG_COLLECTION).doc(ATLAS_CONFIG_DOC).set({
    enabledModels:        Array.isArray(cfg.enabledModels) ? cfg.enabledModels : DEFAULT_ATLAS_CONFIG.enabledModels,
    defaultModel:         String(cfg.defaultModel         || DEFAULT_ATLAS_CONFIG.defaultModel),
    budgetCapInr:         typeof cfg.budgetCapInr === 'number' ? cfg.budgetCapInr : DEFAULT_ATLAS_CONFIG.budgetCapInr,
    modelSelectorVisible: cfg.modelSelectorVisible !== false,
    updatedAt:            FieldValue.serverTimestamp(),
  });
}

// ── Component registry ────────────────────────────────────────────────────────
const COMPONENT_REGISTRY_DOC = 'componentRegistry';

async function getComponentRegistry() {
  const snap = await getDb().collection(TIER_CONFIG_COLLECTION).doc(COMPONENT_REGISTRY_DOC).get();
  if (!snap.exists) return {};
  return snap.data()?.enabled || {};
}

async function upsertComponentRegistry(enabled) {
  await getDb().collection(TIER_CONFIG_COLLECTION).doc(COMPONENT_REGISTRY_DOC).set({
    enabled:   enabled || {},
    updatedAt: FieldValue.serverTimestamp(),
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
    privatePhone: Object.prototype.hasOwnProperty.call(data, 'privatePhone')
      ? String(data.privatePhone || '').trim()
      : undefined,
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

function cleanPhone(value) {
  const raw = String(value || '').trim();
  return raw;
}

async function upsertContactPolicyConfig({ privatePhone, allowedDomains, personalDomains, allowedEmails, blockedDomains, updatedBy }) {
  await getDb().collection(APP_CONFIG_COLLECTION).doc(CONTACT_POLICY_DOC).set({
    privatePhone:   cleanPhone(privatePhone),
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
  deleteSystemDesignArticle,
  getTierConfig,
  upsertTierConfig,
  getSeoConfig,
  upsertSeoConfig,
  getAtlasConfig,
  upsertAtlasConfig,
  getComponentRegistry,
  upsertComponentRegistry,
  upsertRecommendation,
  listActiveRecommendations,
  writeRecommendationReply,
  deleteRecommendation,
  trackPageView,
  recordAnalyticsEvent,
  getAnalyticsOverview,
  getAnalyticsToday,
  cleanupAnalyticsTestData,
  cleanupAnalyticsTodayTestUsers,
  getContactPolicyConfig,
  upsertContactPolicyConfig,
  listSponsorships,
  listActiveSponsorships,
  getSponsorship,
  upsertSponsorship,
  deleteSponsorship,
};

// ── Sponsorship banners ───────────────────────────────────────────────────────
const SPONSORSHIPS_COLLECTION = 'sponsorships';

function normaliseSponsor(id, data) {
  return {
    id:          id,
    company:     String(data.company     || ''),
    headline:    String(data.headline    || ''),
    cta:         String(data.cta         || 'Learn More'),
    ctaUrl:      String(data.ctaUrl      || ''),
    logoUrl:     String(data.logoUrl     || ''),
    placement:   String(data.placement   || 'article-footer'),
    active:      data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt:    data.startsAt  && data.startsAt.toMillis  ? data.startsAt.toMillis()  : null,
    expiresAt:   data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : null,
    updatedAt:   data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
  };
}

async function listSponsorships() {
  const snap = await getDb().collection(SPONSORSHIPS_COLLECTION).orderBy('updatedAt', 'desc').get();
  return snap.docs.map(function (d) { return normaliseSponsor(d.id, d.data()); });
}

async function listActiveSponsorships(placement) {
  const now = new Date();
  let query = getDb().collection(SPONSORSHIPS_COLLECTION).where('active', '==', true);
  if (placement) query = query.where('placement', '==', placement);
  const snap = await query.get();
  return snap.docs
    .map(function (d) { return normaliseSponsor(d.id, d.data()); })
    .filter(function (s) {
      if (s.startsAt  && s.startsAt  > now.getTime()) return false;
      if (s.expiresAt && s.expiresAt < now.getTime()) return false;
      return true;
    });
}

async function getSponsorship(id) {
  const snap = await getDb().collection(SPONSORSHIPS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return normaliseSponsor(snap.id, snap.data());
}

async function upsertSponsorship(id, data) {
  const ref = id
    ? getDb().collection(SPONSORSHIPS_COLLECTION).doc(id)
    : getDb().collection(SPONSORSHIPS_COLLECTION).doc();
  const payload = {
    company:     String(data.company     || ''),
    headline:    String(data.headline    || ''),
    cta:         String(data.cta         || 'Learn More'),
    ctaUrl:      String(data.ctaUrl      || ''),
    logoUrl:     String(data.logoUrl     || ''),
    placement:   String(data.placement   || 'article-footer'),
    active:      data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt:    data.startsAt  ? new Date(data.startsAt)  : null,
    expiresAt:   data.expiresAt ? new Date(data.expiresAt) : null,
    updatedAt:   FieldValue.serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  const saved = await ref.get();
  return normaliseSponsor(saved.id, saved.data());
}

async function deleteSponsorship(id) {
  await getDb().collection(SPONSORSHIPS_COLLECTION).doc(id).delete();
}
