'use strict';

/**
 * Analytics routes.
 *
 * Public:
 *   POST /api/analytics/track         — record a page view (anonymous client id)
 *
 * Admin:
 *   GET  /api/admin/analytics/overview — KPI summary + recent trend
 *
 * Privacy: we never store IP or email here. clientId is a random UUID stored
 * in localStorage by the client.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const { ValidationError } = require('../errors');
const { analyticsTrackLimiter } = require('../middleware/rateLimiter');
const analytics = require('../services/analytics');
const geoip = require('geoip-lite');

const router = express.Router();

function getClientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').trim();
  if (xf) {
    const first = xf.split(',').map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  }
  const xr = String(req.headers['x-real-ip'] || '').trim();
  if (xr) return xr;
  const ra = (req.socket && req.socket.remoteAddress) ? String(req.socket.remoteAddress) : '';
  return ra;
}

function normaliseIp(raw) {
  const ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

function geoFromReq(req) {
  try {
    const ip = normaliseIp(getClientIp(req));
    if (!ip) return null;
    if (ip === '127.0.0.1' || ip === '::1') return null;
    const geo = geoip.lookup(ip);
    if (!geo) return null;
    const city = geo.city ? String(geo.city).trim() : '';
    const region = geo.region ? String(geo.region).trim() : '';
    const country = geo.country ? String(geo.country).trim() : '';
    if (!city && !region && !country) return null;
    return { city: city || null, region: region || null, country: country || null, source: 'geoip-lite' };
  } catch (_) {
    return null;
  }
}

const validateTrack = [
  body('clientId')
    .trim()
    .isLength({ min: 8, max: 80 })
    .withMessage('clientId is required.'),
  body('path')
    .trim()
    .isLength({ min: 1, max: 240 })
    .withMessage('path is required.'),
  body('referrer').optional().trim().isLength({ max: 240 }),
  body('lang').optional().trim().isLength({ max: 12 }),
  body('host').optional().trim().isLength({ max: 120 }),
  body('device').optional().trim().isIn(['mobile', 'desktop']).withMessage('device must be mobile or desktop.'),
  body('utm').optional().isObject(),
  body('utm.source').optional().trim().isLength({ max: 80 }),
  body('utm.medium').optional().trim().isLength({ max: 80 }),
  body('utm.campaign').optional().trim().isLength({ max: 120 }),
  body('utm.content').optional().trim().isLength({ max: 120 }),
  body('utm.term').optional().trim().isLength({ max: 120 }),
];

const validateEvent = [
  body('clientId')
    .trim()
    .isLength({ min: 8, max: 80 })
    .withMessage('clientId is required.'),
  body('type')
    .trim()
    .isIn(['page_view', 'engagement', 'pdf_download'])
    .withMessage('type must be page_view, engagement, or pdf_download.'),
  body('path').optional().trim().isLength({ min: 1, max: 240 }),
  body('referrer').optional().trim().isLength({ max: 240 }),
  body('lang').optional().trim().isLength({ max: 12 }),
  body('host').optional().trim().isLength({ max: 120 }),
  body('device').optional().trim().isIn(['mobile', 'desktop']).withMessage('device must be mobile or desktop.'),
  body('tz').optional().trim().isLength({ max: 60 }),
  body('region').optional().trim().isLength({ max: 8 }),
  body('utm').optional().isObject(),
  body('utm.source').optional().trim().isLength({ max: 80 }),
  body('utm.medium').optional().trim().isLength({ max: 80 }),
  body('utm.campaign').optional().trim().isLength({ max: 120 }),
  body('utm.content').optional().trim().isLength({ max: 120 }),
  body('utm.term').optional().trim().isLength({ max: 120 }),
  body('dwellMs').optional().isInt({ min: 0, max: 60 * 60 * 1000 }),
  body('scrollPct').optional().isInt({ min: 0, max: 100 }),
  body('pdfKind').optional().trim().isLength({ max: 60 }),
  body('pdfId').optional().trim().isLength({ max: 140 }),
  body('user').optional().isObject(),
  body('user.sub').optional().trim().isLength({ max: 80 }),
  body('user.name').optional().trim().isLength({ max: 120 }),
];

router.post('/analytics/track', analyticsTrackLimiter, validateTrack, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(errors.array()[0].msg);
    }

    const clientId = String(req.body.clientId || '').trim();
    const path = String(req.body.path || '').trim();
    const referrer = String(req.body.referrer || '').trim();
    const lang = String(req.body.lang || '').trim();
    const host = String(req.body.host || '').trim();
    const device = String(req.body.device || '').trim();
    const utm = req.body.utm && typeof req.body.utm === 'object' ? req.body.utm : null;

    await analytics.trackPageView({
      clientId,
      path,
      referrer,
      lang,
      host,
      device,
      utm,
    });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.post('/analytics/event', analyticsTrackLimiter, validateEvent, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(errors.array()[0].msg);
    }

    const type = String(req.body.type || '').trim();
    const clientId = String(req.body.clientId || '').trim();
    const path = String(req.body.path || '').trim();
    const referrer = String(req.body.referrer || '').trim();
    const lang = String(req.body.lang || '').trim();
    const host = String(req.body.host || '').trim();
    const device = String(req.body.device || '').trim();
    const tz = String(req.body.tz || '').trim();
    const region = String(req.body.region || '').trim();
    const utm = req.body.utm && typeof req.body.utm === 'object' ? req.body.utm : null;
    const dwellMs = req.body.dwellMs != null ? Number(req.body.dwellMs || 0) : null;
    const scrollPct = req.body.scrollPct != null ? Number(req.body.scrollPct || 0) : null;
    const pdfKind = String(req.body.pdfKind || '').trim();
    const pdfId = String(req.body.pdfId || '').trim();
    const user = req.body.user && typeof req.body.user === 'object' ? req.body.user : null;
    const geo = geoFromReq(req);

    await analytics.recordAnalyticsEvent({
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
    });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/analytics/overview', requireAdmin, async (req, res, next) => {
  try {
    const month = String(req.query.month || '').trim();
    const data = await analytics.getAnalyticsOverview({ month });
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/analytics/today', requireAdmin, async (req, res, next) => {
  try {
    const data = await analytics.getAnalyticsToday();
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/analytics/cleanup-test', requireAdmin, async (req, res, next) => {
  try {
    const month = String(req.query.month || '').trim();
    const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : undefined;
    const data = await analytics.cleanupAnalyticsTestData({ month, paths });
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/analytics/cleanup-today-test-users', requireAdmin, async (req, res, next) => {
  try {
    const day = String(req.query.day || '').trim();
    const names = Array.isArray(req.body && req.body.names) ? req.body.names : undefined;
    const subs = Array.isArray(req.body && req.body.subs) ? req.body.subs : undefined;
    const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : undefined;
    const data = await analytics.cleanupAnalyticsTodayTestUsers({ day, names, subs, paths });
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

