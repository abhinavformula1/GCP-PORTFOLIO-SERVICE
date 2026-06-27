'use strict';

const crypto = require('crypto');
const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

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
  const langId = String(lang || '').trim().slice(0, 12) || null;
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

  const db = firestore.getDb();
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
      if (monthlyCampaignRef && u) {
        tx.set(monthlyCampaignRef, {
          key: uKey,
          utm: u,
          pageViews: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }

    // Visitor uniqueness per day / month (page_view only)
    if (eventType === 'page_view') {
      const visitorPayload = {
        clientId: cid,
        path: p,
        referrer: String(referrer || '').slice(0, 240) || null,
        lang: langId,
        updatedAt: nowTs,
      };
      if (!dailyVisitorSnap.exists) {
        tx.set(dailyVisitorRef, Object.assign({ firstSeenAt: nowTs }, visitorPayload), { merge: true });
        tx.set(dailyRef, { uniqueVisitors: FieldValue.increment(1), updatedAt: nowTs }, { merge: true });
      } else {
        tx.set(dailyVisitorRef, { updatedAt: nowTs }, { merge: true });
      }
      if (!monthlyVisitorSnap.exists) {
        tx.set(monthlyVisitorRef, Object.assign({ firstSeenAt: nowTs }, visitorPayload), { merge: true });
        tx.set(monthlyRef, { uniqueVisitors: FieldValue.increment(1), updatedAt: nowTs }, { merge: true });
      } else {
        tx.set(monthlyVisitorRef, { updatedAt: nowTs }, { merge: true });
      }
    }

    // User aggregates (daily/monthly)
    const label = userInfo.kind === 'signed'
      ? (userInfo.name || userInfo.sub || '')
      : ('anon-' + hashKey(cid).slice(0, 6));

    tx.set(dailyUserRef, {
      kind: userInfo.kind,
      sub: userInfo.sub || null,
      name: userInfo.name || null,
      label,
      region: regionId,
      tz: tzId,
      device: dev,
      geoCountry,
      geoRegion,
      geoCity,
      geoSource,
      updatedAt: nowTs,
      firstSeenAt: dailyVisitorSnap.exists ? undefined : nowTs,
      lastSeenAt: nowTs,
    }, { merge: true });
    tx.set(monthlyUserRef, {
      kind: userInfo.kind,
      sub: userInfo.sub || null,
      name: userInfo.name || null,
      label,
      region: regionId,
      tz: tzId,
      device: dev,
      geoCountry,
      geoRegion,
      geoCity,
      geoSource,
      updatedAt: nowTs,
      lastSeenAt: nowTs,
    }, { merge: true });

    if (eventType === 'page_view') {
      tx.set(dailyUserRef, { pageViews: FieldValue.increment(1) }, { merge: true });
      tx.set(monthlyUserRef, { pageViews: FieldValue.increment(1) }, { merge: true });
      if (dailyUserPagesRef) {
        tx.set(dailyUserPagesRef, {
          path: p,
          pageViews: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }
    if (eventType === 'engagement') {
      const ms = Math.max(0, Math.min(Number(dwellMs || 0), 60 * 60 * 1000));
      tx.set(dailyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      tx.set(monthlyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      if (dailyUserPagesRef && p) {
        tx.set(dailyUserPagesRef, { readMs: FieldValue.increment(ms) }, { merge: true });
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

  const db = firestore.getDb();
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
  const db = firestore.getDb();
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

  const db = firestore.getDb();
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

  const db = firestore.getDb();
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

module.exports = {
  trackPageView,
  recordAnalyticsEvent,
  getAnalyticsOverview,
  getAnalyticsToday,
  cleanupAnalyticsTestData,
  cleanupAnalyticsTodayTestUsers,
};

