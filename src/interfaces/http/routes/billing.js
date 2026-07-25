'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError } = require('../../../domain/errors');
const { assertDependencies } = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.billing', {
    requireAuth: 'function',
    requireAdmin: 'function',
    billing: [
      'status', 'publicConfig', 'prices', 'createCheckout', 'createGuestEmbedded',
      'createGuestRedirect', 'claim', 'portal', 'overview', 'adminPortal', 'cancel',
    ],
  });
  const { requireAuth, requireAdmin, billing } = dependencies;
  const router = express.Router();

  function baseUrl(req) {
    const protoRaw = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const hostRaw = req.headers['x-forwarded-host'] || req.get('host') || '';
    const proto = String(Array.isArray(protoRaw) ? protoRaw[0] : protoRaw).split(',')[0].trim() || 'http';
    const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(',')[0].trim();
    try {
      return new URL(host ? `${proto}://${host}` : billing.siteUrl).origin.replace(/\/$/, '');
    } catch (_) {
      return 'http://localhost:8080';
    }
  }

  function validate(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
  }

  const validateCheckout = [
    body('priceId').optional().trim().isLength({ min: 4, max: 128 }),
    body('plan').optional().trim().isIn(['monthly', 'yearly']),
    body('coupon').optional().trim().isLength({ min: 1, max: 80 }),
    body('uiMode').optional().trim().isIn(['redirect', 'embedded']),
  ];
  const validateEmbeddedCheckout = [
    body('priceId').optional().trim().isLength({ min: 4, max: 128 }),
    body('plan').optional().trim().isIn(['monthly', 'yearly']),
    body('coupon').optional().trim().isLength({ min: 1, max: 80 }),
    body('uiMode').optional().trim().isIn(['embedded']),
  ];
  const validateClaim = [
    body('sessionId').trim().isLength({ min: 6, max: 200 }).withMessage('Missing Stripe session id.'),
  ];

  router.get('/billing/status', (_req, res) => {
    const result = billing.status();
    return res.status(result.statusCode).json(result.body);
  });
  router.get('/billing/public-config', (_req, res) => res.status(200).json(billing.publicConfig()));
  router.get('/billing/prices', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res.status(200).json(await billing.prices());
  });

  router.post('/billing/checkout-session', requireAuth, validateCheckout, async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.createCheckout({
        input: req.body, user: req.user, baseUrl: baseUrl(req),
      }));
    } catch (error) { return next(error); }
  });
  router.post('/billing/checkout-session-guest', validateEmbeddedCheckout, async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.createGuestEmbedded({ input: req.body, baseUrl: baseUrl(req) }));
    } catch (error) { return next(error); }
  });
  router.post('/billing/checkout-session-guest-redirect', validateCheckout, async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.createGuestRedirect({ input: req.body, baseUrl: baseUrl(req) }));
    } catch (error) { return next(error); }
  });
  router.post('/billing/claim', requireAuth, validateClaim, async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.claim({ sessionId: req.body.sessionId, user: req.user }));
    } catch (error) { return next(error); }
  });
  router.post('/billing/portal-session', requireAuth, async (req, res, next) => {
    try {
      return res.status(200).json(await billing.portal({ user: req.user, baseUrl: baseUrl(req) }));
    } catch (error) { return next(error); }
  });
  router.get('/admin/subscriptions/overview', requireAdmin, async (_req, res, next) => {
    try {
      return res.status(200).json(await billing.overview());
    } catch (error) { return next(error); }
  });
  router.post('/admin/subscriptions/portal-session', requireAdmin, [
    body('customerId').trim().isLength({ min: 6, max: 200 }).withMessage('Missing Stripe customer id.'),
  ], async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.adminPortal({
        customerId: req.body.customerId, baseUrl: baseUrl(req),
      }));
    } catch (error) { return next(error); }
  });
  router.post('/admin/subscriptions/cancel', requireAdmin, [
    body('subscriptionId').trim().isLength({ min: 6, max: 200 }).withMessage('Missing Stripe subscription id.'),
    body('cancelAtPeriodEnd').optional().isBoolean().withMessage('cancelAtPeriodEnd must be a boolean.'),
  ], async (req, res, next) => {
    try {
      validate(req);
      return res.status(200).json(await billing.cancel(req.body));
    } catch (error) { return next(error); }
  });

  return router;
}

module.exports = { createRouter };
