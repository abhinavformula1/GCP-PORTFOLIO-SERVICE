'use strict';

/**
 * Analytics repository.
 *
 * Owns Firestore persistence for analytics events, rollups, and cleanup jobs.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const ANALYTICS_DAILY_COLLECTION = 'analyticsDaily';
const ANALYTICS_MONTHLY_COLLECTION = 'analyticsMonthly';

async function recordEvent({
  eventType,
  clientId,
  path,
  rawReferrer,
  referrerLabel,
  langId,
  device,
  utm,
  utmKey,
  referrerKey,
  tzId,
  regionId,
  geoCountry,
  geoRegion,
  geoCity,
  geoSource,
  userInfo,
  userKeyHash,
  clientIdHash,
  pathHash,
  dwellMs,
  scrollPct,
  pdfKind,
  pdfId,
  pdfKeyHash,
  dayId,
  monthId,
}) {
  const db = firestore.getDb();
  const dailyRef = db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId);
  const monthlyRef = db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId);
  const dailyVisitorRef = dailyRef.collection('visitors').doc(clientId);
  const monthlyVisitorRef = monthlyRef.collection('visitors').doc(clientId);

  const dailyUserRef = dailyRef.collection('users').doc(userKeyHash);
  const dailyUserPagesRef = path ? dailyUserRef.collection('pages').doc(pathHash) : null;
  const monthlyUserRef = monthlyRef.collection('users').doc(userKeyHash);
  const monthlyPageRef = monthlyRef.collection('pages').doc(pathHash);
  const monthlyReferrerRef = monthlyRef.collection('referrers').doc(referrerKey);
  const monthlyDeviceRef = monthlyRef.collection('devices').doc(device);
  const monthlyCampaignRef = utmKey ? monthlyRef.collection('campaigns').doc(utmKey) : null;

  return db.runTransaction(async (tx) => {
    const [dailyVisitorSnap, monthlyVisitorSnap] = await Promise.all([
      tx.get(dailyVisitorRef),
      tx.get(monthlyVisitorRef),
    ]);

    const nowTs = FieldValue.serverTimestamp();
    const dayBase = { updatedAt: nowTs };
    const monthBase = { updatedAt: nowTs };

    if (eventType === 'page_view') {
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

    if (eventType === 'page_view') {
      tx.set(monthlyPageRef, {
        path,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });
      tx.set(monthlyReferrerRef, {
        referrer: referrerLabel,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });
      tx.set(monthlyDeviceRef, {
        device,
        pageViews: FieldValue.increment(1),
        updatedAt: nowTs,
      }, { merge: true });
      if (monthlyCampaignRef && utm) {
        tx.set(monthlyCampaignRef, {
          key: utmKey,
          utm,
          pageViews: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }

    if (eventType === 'page_view') {
      const visitorPayload = {
        clientId,
        path,
        referrer: String(rawReferrer || '').slice(0, 240) || null,
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

    const label = userInfo.kind === 'signed'
      ? (userInfo.name || userInfo.sub || '')
      : ('anon-' + clientIdHash.slice(0, 6));

    tx.set(dailyUserRef, {
      kind: userInfo.kind,
      sub: userInfo.sub || null,
      name: userInfo.name || null,
      label,
      region: regionId,
      tz: tzId,
      device,
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
      device,
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
          path,
          pageViews: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }
    if (eventType === 'engagement') {
      const ms = Math.max(0, Math.min(Number(dwellMs || 0), 60 * 60 * 1000));
      tx.set(dailyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      tx.set(monthlyUserRef, { readMs: FieldValue.increment(ms) }, { merge: true });
      if (dailyUserPagesRef && path) {
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
        tx.set(dailyUserRef.collection('pdfs').doc(pdfKeyHash), {
          kind: pdfKind || 'pdf',
          id: pdfId || null,
          downloads: FieldValue.increment(1),
          updatedAt: nowTs,
        }, { merge: true });
      }
    }
  });
}

async function fetchOverview(monthId, recentDayIds) {
  const db = firestore.getDb();
  const monthlyRef = db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId);
  const monthlySnap = await monthlyRef.get();
  const monthly = monthlySnap.exists ? (monthlySnap.data() || {}) : {};

  const [topPagesSnap, topRefsSnap, topCampaignsSnap, recentUsersSnap] = await Promise.all([
    monthlyRef.collection('pages').orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    monthlyRef.collection('referrers').orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    monthlyRef.collection('campaigns').orderBy('pageViews', 'desc').limit(10).get().catch(() => null),
    monthlyRef.collection('users').orderBy('lastSeenAt', 'desc').limit(12).get().catch(() => null),
  ]);

  const refs = recentDayIds.map((dayId) => db.collection(ANALYTICS_DAILY_COLLECTION).doc(dayId));
  const dailySnaps = refs.length ? await db.getAll.apply(db, refs) : [];

  return {
    monthly,
    topPages: topPagesSnap && topPagesSnap.docs ? topPagesSnap.docs : [],
    topReferrers: topRefsSnap && topRefsSnap.docs ? topRefsSnap.docs : [],
    topCampaigns: topCampaignsSnap && topCampaignsSnap.docs ? topCampaignsSnap.docs : [],
    recentUsers: recentUsersSnap && recentUsersSnap.docs ? recentUsersSnap.docs : [],
    dailySeries: dailySnaps,
  };
}

async function fetchTodayUsers(dayId) {
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

async function cleanupMonthlyTestData({ monthId, paths }) {
  const db = firestore.getDb();
  const monthlyRef = db.collection(ANALYTICS_MONTHLY_COLLECTION).doc(monthId);

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
    if (paths.includes(base)) {
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
    if (paths.includes(base)) {
      removedVisitors += 1;
      visitorsToDelete.push(d.ref);
    }
  });

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

async function cleanupDailyTestUsers({ dayId, names, subs, paths }) {
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
    const data = doc.data() || {};
    const name = String(data.name || '').trim();
    const sub = String(data.sub || '').trim();
    const isMatch = (name && names.includes(name)) || (sub && subs.includes(sub));
    if (!isMatch) return;
    removedUserPageViews += Number(data.pageViews || 0);
    removedUserReadMs += Number(data.readMs || 0);
    removedUserPdf += Number(data.pdfDownloads || 0);
    toDeleteUsers.push(doc.ref);
  });

  const visitorDocs = visitorsSnap && visitorsSnap.docs ? visitorsSnap.docs : [];
  const toDeleteVisitors = [];
  visitorDocs.forEach((doc) => {
    const data = doc.data() || {};
    const path = String(data.path || '');
    const base = path.split('?')[0].split('#')[0];
    if (paths.includes(base)) {
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

  for (const userRef of toDeleteUsers) {
    await deleteSubcollection(userRef, 'pages');
    await deleteSubcollection(userRef, 'pdfs');
  }

  const deleteRefs = toDeleteUsers.concat(toDeleteVisitors);
  for (let i = 0; i < deleteRefs.length; i += 450) {
    const batch = db.batch();
    deleteRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

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
  recordEvent,
  fetchOverview,
  fetchTodayUsers,
  cleanupMonthlyTestData,
  cleanupDailyTestUsers,
};
