'use strict';

/**
 * Promotions routes (Firestore-backed; Stripe optional).
 *
 * Public/authenticated:
 *   POST /api/billing/redeem-promo
 *
 * Admin:
 *   GET   /api/admin/promotions
 *   POST  /api/admin/promotions
 *   PATCH /api/admin/promotions/:code
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ValidationError, AppError } = require('../errors');
const promotions = require('../services/promotions');

const router = express.Router();

const validateRedeemPromo = [
  body('code').trim().isLength({ min: 3, max: 24 }),
];

const validateCreatePromo = [
  body('code').trim().isLength({ min: 3, max: 24 }),
  body('days').optional().isInt({ min: 1, max: 365 }),
  body('maxRedemptions').optional({ nullable: true }).isInt({ min: 1, max: 100000 }),
  body('active').optional().isBoolean(),
  body('startsAt').optional({ nullable: true }).isInt({ min: 0 }),
  body('expiresAt').optional({ nullable: true }).isInt({ min: 0 }),
];

const validateUpdatePromo = [
  body('days').optional().isInt({ min: 1, max: 365 }),
  body('maxRedemptions').optional({ nullable: true }).isInt({ min: 1, max: 100000 }),
  body('active').optional().isBoolean(),
  body('startsAt').optional({ nullable: true }).isInt({ min: 0 }),
  body('expiresAt').optional({ nullable: true }).isInt({ min: 0 }),
];

router.post('/billing/redeem-promo', requireAuth, validateRedeemPromo, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
    const uid = String(req.user?.uid || '').trim();
    if (!uid) throw new AppError('Missing user id.', 401, 'UNAUTHORIZED');
    const code = String(req.body.code || '').trim();
    const out = await promotions.redeemPromotion({ uid, code });
    return res.status(200).json({ success: true, ...out });
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/promotions', requireAdmin, async (req, res, next) => {
  try {
    const promos = await promotions.listPromotions();
    return res.status(200).json({ success: true, promos });
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/promotions', requireAdmin, validateCreatePromo, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
    const createdBy = String(req.user?.email || req.user?.uid || '').trim() || null;
    const saved = await promotions.createPromotion(req.body, { createdBy });
    return res.status(200).json({ success: true, ...saved });
  } catch (err) {
    return next(err);
  }
});

router.patch('/admin/promotions/:code', requireAdmin, validateUpdatePromo, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
    const updatedBy = String(req.user?.email || req.user?.uid || '').trim() || null;
    const out = await promotions.updatePromotion(req.params.code, req.body, { updatedBy });
    return res.status(200).json({ success: true, ...out });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

