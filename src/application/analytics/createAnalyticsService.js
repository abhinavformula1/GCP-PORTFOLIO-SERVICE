'use strict';

const { assertDependencies } = require('../ports/assert');

function createAnalyticsService(dependencies) {
  assertDependencies(dependencies, 'application.analytics', { crypto: ['createHash'], analyticsRepository: ['recordEvent', 'fetchOverview', 'fetchTodayUsers', 'cleanupMonthlyTestData', 'cleanupDailyTestUsers'], geoLookup: 'function' });
  const { crypto, analyticsRepository, geoLookup } = dependencies;


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

function resolveGeo(ip) {
  try {
    const geo = geoLookup(ip);
    if (!geo) return null;
    const city = String(geo.city || '').trim();
    const region = String(geo.region || '').trim();
    const country = String(geo.country || '').trim();
    if (!city && !region && !country) return null;
    return { city: city || null, region: region || null, country: country || null, source: 'geoip-lite' };
  } catch (_) {
    return null;
  }
}

async function trackPageViewRequest(input) {
  const body = input || {};
  await trackPageView({
    clientId: String(body.clientId || '').trim(),
    path: String(body.path || '').trim(),
    referrer: String(body.referrer || '').trim(),
    lang: String(body.lang || '').trim(),
    host: String(body.host || '').trim(),
    device: String(body.device || '').trim(),
    utm: body.utm && typeof body.utm === 'object' ? body.utm : null,
  });
}

async function recordEventRequest(input, clientIp) {
  const body = input || {};
  await recordAnalyticsEvent({
    type: String(body.type || '').trim(),
    clientId: String(body.clientId || '').trim(),
    path: String(body.path || '').trim(),
    referrer: String(body.referrer || '').trim(),
    lang: String(body.lang || '').trim(),
    host: String(body.host || '').trim(),
    device: String(body.device || '').trim(),
    tz: String(body.tz || '').trim(),
    region: String(body.region || '').trim(),
    geo: clientIp ? resolveGeo(clientIp) : null,
    utm: body.utm && typeof body.utm === 'object' ? body.utm : null,
    dwellMs: body.dwellMs != null ? Number(body.dwellMs || 0) : null,
    scrollPct: body.scrollPct != null ? Number(body.scrollPct || 0) : null,
    pdfKind: String(body.pdfKind || '').trim(),
    pdfId: String(body.pdfId || '').trim(),
    user: body.user && typeof body.user === 'object' ? body.user : null,
  });
}

async function getOverviewResponse(month) {
  return { success: true, ...await getAnalyticsOverview({ month: String(month || '').trim() }) };
}

async function getTodayResponse() {
  return { success: true, ...await getAnalyticsToday() };
}

async function cleanupTestResponse({ month, paths }) {
  return {
    success: true,
    ...await cleanupAnalyticsTestData({
      month: String(month || '').trim(),
      paths: Array.isArray(paths) ? paths : undefined,
    }),
  };
}

async function cleanupTodayResponse({ day, names, subs, paths }) {
  return {
    success: true,
    ...await cleanupAnalyticsTodayTestUsers({
      day: String(day || '').trim(),
      names: Array.isArray(names) ? names : undefined,
      subs: Array.isArray(subs) ? subs : undefined,
      paths: Array.isArray(paths) ? paths : undefined,
    }),
  };
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
  if (eventType === 'page_view' && !p) {
    throw new Error('recordAnalyticsEvent: path is required for page_view.');
  }

  return analyticsRepository.recordEvent({
    eventType,
    clientId: cid,
    path: p,
    rawReferrer: referrer,
    referrerLabel: refKey,
    langId,
    device: dev,
    utm: u,
    utmKey: uKey ? hashKey(uKey) : '',
    referrerKey: hashKey(refKey),
    tzId,
    regionId,
    geoCountry,
    geoRegion,
    geoCity,
    geoSource,
    userInfo,
    userKeyHash: hashKey(userInfo.key),
    clientIdHash: hashKey(cid),
    pathHash: hashKey(p),
    dwellMs,
    scrollPct,
    pdfKind,
    pdfId,
    pdfKeyHash: hashKey((pdfKind || 'pdf') + ':' + (pdfId || 'unknown')),
    dayId,
    monthId,
  });
}

async function getAnalyticsOverview({ month } = {}) {
  const now = new Date();
  const monthId = looksLikeMonthId(month) ? String(month) : toMonthId(now);

  // Avoid indexed queries. We store daily docs by `YYYY-MM-DD` so we can
  // deterministically read the last N days without orderBy().
  const baseUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const recentDayIds = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(baseUtc);
    d.setUTCDate(d.getUTCDate() - i);
    recentDayIds.push(toDateId(d));
  }

  const overview = await analyticsRepository.fetchOverview(monthId, recentDayIds);

  const topPages = overview.topPages.map((data) => {
    return { path: String(data.path || ''), pageViews: Number(data.pageViews || 0) };
  });

  const topReferrers = overview.topReferrers.map((data) => {
    return { referrer: String(data.referrer || ''), pageViews: Number(data.pageViews || 0) };
  });

  const topCampaigns = overview.topCampaigns.map((data) => {
    return {
      utm: data.utm || null,
      key: String(data.key || ''),
      pageViews: Number(data.pageViews || 0),
    };
  });

  const recentUsers = overview.recentUsers.map((data) => {
    return {
      kind: data.kind || 'anon',
      name: data.name || null,
      label: data.label || null,
      region: data.region || null,
      geoCountry: data.geoCountry || null,
      geoRegion: data.geoRegion || null,
      geoCity: data.geoCity || null,
      device: data.device || null,
      lastSeenAt: Number(data.lastSeenAt) || null,
    };
  });

  const series = overview.dailySeries.map((record) => {
    const data = record && record.data ? record.data : {};
    return {
      date: record && record.id ? record.id : '',
      pageViews: Number(data.pageViews || 0),
      uniqueVisitors: Number(data.uniqueVisitors || 0),
    };
  });

  return {
    month: monthId,
    totals: {
      pageViews: Number(overview.monthly.pageViews || 0),
      uniqueVisitors: Number(overview.monthly.uniqueVisitors || 0),
      pdfDownloads: Number(overview.monthly.pdfDownloads || 0),
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
  return analyticsRepository.fetchTodayUsers(dayId);
}

async function cleanupAnalyticsTestData({ month, paths } = {}) {
  const now = new Date();
  const monthId = looksLikeMonthId(month) ? String(month) : toMonthId(now);
  const kill = Array.isArray(paths) && paths.length
    ? paths.map((p) => String(p || '').trim()).filter(Boolean)
    : ['/test', '/sd'];
  return analyticsRepository.cleanupMonthlyTestData({ monthId, paths: kill });
}

async function cleanupAnalyticsTodayTestUsers({ day, names, subs, paths } = {}) {
  const now = new Date();
  const dayId = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : toDateId(now);
  const killNames = Array.isArray(names) ? names.map((v) => String(v || '').trim()).filter(Boolean) : ['Test User'];
  const killSubs = Array.isArray(subs) ? subs.map((v) => String(v || '').trim()).filter(Boolean) : ['user-sub-123'];
  const killPaths = Array.isArray(paths) && paths.length
    ? paths.map((p) => String(p || '').trim()).filter(Boolean)
    : ['/test', '/sd'];
  return analyticsRepository.cleanupDailyTestUsers({
    dayId,
    names: killNames,
    subs: killSubs,
    paths: killPaths,
  });
}

  return {
  trackPageView,
  recordAnalyticsEvent,
  getAnalyticsOverview,
  getAnalyticsToday,
  cleanupAnalyticsTestData,
  cleanupAnalyticsTodayTestUsers,
  resolveGeo,
  trackPageViewRequest,
  recordEventRequest,
  getOverviewResponse,
  getTodayResponse,
  cleanupTestResponse,
  cleanupTodayResponse,
};
}

module.exports = { createAnalyticsService };
