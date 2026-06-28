'use strict';

/**
 * Billing routes (Stripe).
 *
 * Public/authenticated:
 *   POST /api/billing/checkout-session   -> { url }
 *   POST /api/billing/portal-session     -> { url }
 *
 * Admin:
 *   GET  /api/admin/subscriptions/overview
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ValidationError, AppError } = require('../errors');
const { getStripe, isStripeConfigured } = require('../services/stripe');
const billing = require('../services/billing');

const router = express.Router();

function isSafeDevRuntime() {
  // Only expose diagnostics locally / non-production.
  // Cloud Run sets K_SERVICE; treat that as production-like even if NODE_ENV misconfigured.
  return (config.server.env || 'development') !== 'production' && !process.env.K_SERVICE;
}

function assertStripeConfigured() {
  if (!isStripeConfigured()) {
    throw new AppError('Stripe is not configured. Missing STRIPE_SECRET_KEY.', 503, 'STRIPE_NOT_CONFIGURED');
  }
}

router.get('/billing/status', (_req, res) => {
  if (!isSafeDevRuntime()) return res.status(404).json({ success: false, error: 'Not found.' });

  const key = String(config.stripe.secretKey || '');
  const mode = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : key ? 'unknown' : 'unset';

  return res.status(200).json({
    success: true,
    env: config.server.env,
    adminLocalPreview: !!config.admin.localPreview,
    stripe: {
      configured: isStripeConfigured(),
      secretKeySet: !!config.stripe.secretKey,
      publishableKeySet: !!config.stripe.publishableKey,
      mode,
      webhookSecretSet: !!config.stripe.webhookSecret,
      priceMonthlySet: !!config.stripe.priceMonthly,
      priceYearlySet: !!config.stripe.priceYearly,
      siteUrl: config.stripe.siteUrl,
      endpoints: {
        checkoutSession: '/api/billing/checkout-session',
        portalSession: '/api/billing/portal-session',
        webhook: '/api/billing/webhook',
      },
    },
  });
});

// Public (no auth): exposes the minimum Stripe config needed by the frontend.
router.get('/billing/public-config', (_req, res) => {
  return res.status(200).json({
    success: true,
    publishableKey: config.stripe.publishableKey || '',
  });
});

const validateCheckout = [
  body('priceId').optional().trim().isLength({ min: 4, max: 128 }),
  body('plan').optional().trim().isIn(['monthly', 'yearly']),
  body('coupon').optional().trim().isLength({ min: 1, max: 80 }),
  body('uiMode').optional().trim().isIn(['redirect', 'embedded']),
];

router.post('/billing/checkout-session', requireAuth, validateCheckout, async (req, res, next) => {
  try {
    assertStripeConfigured();
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);

    const plan = String(req.body.plan || '').trim();
    const coupon = String(req.body.coupon || '').trim();
    const priceId = String(req.body.priceId || '').trim()
      || (plan === 'yearly' ? config.stripe.priceYearly : config.stripe.priceMonthly);
    if (!priceId) throw new AppError('Missing Stripe price id. Set STRIPE_PRICE_MONTHLY (and optionally STRIPE_PRICE_YEARLY).', 503, 'STRIPE_PRICE_NOT_CONFIGURED');

    const stripe = getStripe();
    const uid = String(req.user?.uid || '').trim();
    const email = String(req.user?.email || '').trim();
    const name = String(req.user?.name || '').trim();
    if (!uid) throw new AppError('Missing user id.', 401, 'UNAUTHORIZED');

    const siteUrl = String(config.stripe.siteUrl || '').replace(/\/$/, '');
    const successUrl = `${siteUrl}/?billing=success`;
    const cancelUrl = `${siteUrl}/?billing=cancel`;

    let discounts = undefined;
    if (coupon) {
      // Stripe expects a PromotionCode ID, not the human coupon string.
      // We resolve by `code` so the user can paste what marketing shares.
      try {
        const promoList = await stripe.promotionCodes.list({ code: coupon, active: true, limit: 1 });
        const promo = promoList && promoList.data && promoList.data[0] ? promoList.data[0] : null;
        if (promo && promo.id) {
          discounts = [{ promotion_code: promo.id }];
        }
      } catch (_) {
        // Ignore invalid coupon lookup; checkout still works and user can enter
        // a promo code manually in Stripe UI because allow_promotion_codes=true.
      }
    }

    const uiMode = String(req.body.uiMode || 'redirect').trim();
    const wantsEmbedded = uiMode === 'embedded';
    const sessionParams = {
      mode: 'subscription',
      client_reference_id: uid,
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: wantsEmbedded ? undefined : successUrl,
      cancel_url: wantsEmbedded ? undefined : cancelUrl,
      ui_mode: wantsEmbedded ? 'embedded' : undefined,
      return_url: wantsEmbedded ? `${siteUrl}/software-architecture?checkout=return` : undefined,
      allow_promotion_codes: true,
      discounts,
      subscription_data: {
        metadata: {
          uid,
          email: email || '',
          name: name || '',
        },
      },
      metadata: {
        uid,
        email: email || '',
        name: name || '',
      },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Best-effort: store the checkout session pointer for audit/debug.
    billing.appendStripeCheckoutInitiated({ uid, email, name, sessionId: session.id, priceId }).catch(function () {});

    if (wantsEmbedded) {
      return res.status(200).json({ success: true, clientSecret: session.client_secret });
    }
    return res.status(200).json({ success: true, url: session.url });
  } catch (err) {
    return next(err);
  }
});

router.post('/billing/portal-session', requireAuth, async (req, res, next) => {
  try {
    assertStripeConfigured();
    const stripe = getStripe();
    const uid = String(req.user?.uid || '').trim();
    if (!uid) throw new AppError('Missing user id.', 401, 'UNAUTHORIZED');

    const customerId = await billing.getStripeCustomerIdForUser(uid);
    if (!customerId) throw new AppError('No Stripe customer found for this user yet.', 404, 'STRIPE_CUSTOMER_NOT_FOUND');

    const siteUrl = String(config.stripe.siteUrl || '').replace(/\/$/, '');
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/`,
    });
    return res.status(200).json({ success: true, url: session.url });
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/subscriptions/overview', requireAdmin, async (req, res, next) => {
  try {
    const data = await billing.getSubscriptionsOverview();
    return res.status(200).json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

