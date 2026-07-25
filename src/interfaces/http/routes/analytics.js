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
const { ValidationError } = require('../../../domain/errors');
const { assertDependencies } = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.analytics', {
    requireAdmin: 'function',
    analyticsTrackLimiter: 'function',
    analytics: [
      'trackPageViewRequest', 'recordEventRequest', 'getOverviewResponse',
      'getTodayResponse', 'cleanupTestResponse', 'cleanupTodayResponse',
    ],
  });
  const {
    requireAdmin,
    analyticsTrackLimiter,
    analytics,
  } = dependencies;

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

    await analytics.trackPageViewRequest(req.body);
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

    const ip = normaliseIp(getClientIp(req));
    const clientIp = ip === '127.0.0.1' || ip === '::1' ? '' : ip;
    await analytics.recordEventRequest(req.body, clientIp);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/analytics/overview', requireAdmin, async (req, res, next) => {
  try {
    return res.status(200).json(await analytics.getOverviewResponse(req.query.month));
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/analytics/today', requireAdmin, async (req, res, next) => {
  try {
    return res.status(200).json(await analytics.getTodayResponse());
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/analytics/cleanup-test', requireAdmin, async (req, res, next) => {
  try {
    return res.status(200).json(await analytics.cleanupTestResponse({
      month: req.query.month,
      paths: req.body && req.body.paths,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/analytics/cleanup-today-test-users', requireAdmin, async (req, res, next) => {
  try {
    return res.status(200).json(await analytics.cleanupTodayResponse({
      day: req.query.day,
      names: req.body && req.body.names,
      subs: req.body && req.body.subs,
      paths: req.body && req.body.paths,
    }));
  } catch (err) {
    return next(err);
  }
});

  return router;
}

module.exports = { createRouter };

