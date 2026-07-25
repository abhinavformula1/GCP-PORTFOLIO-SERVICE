'use strict';

const { AppError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createBillingUseCases(dependencies) {
  assertDependencies(dependencies, 'application.billingUseCases', {
    billing: [
      'isStripeConfigured', 'retrievePrice', 'listPromotionCodes', 'createCheckoutSession',
      'getStripeCustomerIdForUser', 'appendStripeCheckoutInitiated', 'retrieveCheckoutSession',
      'updateSubscription', 'claimStripeCheckoutOwnership', 'retrieveSubscription',
      'upsertStripeSubscription', 'createBillingPortalSession', 'getSubscriptionsOverview',
    ],
    settings: 'value',
  });
  assertDependencies(dependencies.settings, 'application.billingUseCases.settings', {
    stripe: 'value',
    environment: 'value',
    isCloudRuntime: 'value',
  });
  const { billing, settings } = dependencies;
  const stripe = settings.stripe;

  function assertConfigured() {
    if (!billing.isStripeConfigured()) {
      throw new AppError('Stripe is not configured. Missing STRIPE_SECRET_KEY.', 503, 'STRIPE_NOT_CONFIGURED');
    }
  }

  function priceId(input) {
    const plan = String(input.plan || '').trim();
    const selected = String(input.priceId || '').trim()
      || (plan === 'yearly' ? stripe.priceYearly : stripe.priceMonthly);
    if (!selected) {
      throw new AppError(
        'Missing Stripe price id. Set STRIPE_PRICE_MONTHLY (and optionally STRIPE_PRICE_YEARLY).',
        503,
        'STRIPE_PRICE_NOT_CONFIGURED'
      );
    }
    return selected;
  }

  async function discountsFor(couponInput) {
    const coupon = String(couponInput || '').trim();
    if (!coupon) return undefined;
    try {
      const result = await billing.listPromotionCodes({ code: coupon, active: true, limit: 1 });
      const promotion = result?.data?.[0];
      return promotion?.id ? [{ promotion_code: promotion.id }] : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function embeddedReturnUrl(baseUrl) {
    return `${String(baseUrl || '').replace(/\/$/, '')}/software-architecture?checkout=return&session_id={CHECKOUT_SESSION_ID}`;
  }

  function status() {
    if (settings.environment === 'production' || settings.isCloudRuntime) {
      return { statusCode: 404, body: { success: false, error: 'Not found.' } };
    }
    const key = String(stripe.secretKey || '');
    const mode = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : key ? 'unknown' : 'unset';
    return {
      statusCode: 200,
      body: {
        success: true,
        env: settings.environment,
        adminLocalPreview: !!settings.adminLocalPreview,
        stripe: {
          configured: billing.isStripeConfigured(),
          secretKeySet: !!stripe.secretKey,
          publishableKeySet: !!stripe.publishableKey,
          mode,
          webhookSecretSet: !!stripe.webhookSecret,
          priceMonthlySet: !!stripe.priceMonthly,
          priceYearlySet: !!stripe.priceYearly,
          siteUrl: stripe.siteUrl,
          endpoints: {
            checkoutSession: '/api/billing/checkout-session',
            portalSession: '/api/billing/portal-session',
            webhook: '/api/billing/webhook',
          },
        },
      },
    };
  }

  function publicConfig() {
    return { success: true, publishableKey: stripe.publishableKey || '' };
  }

  async function prices() {
    try {
      const output = {};
      for (const [name, id, fallbackInterval] of [
        ['monthly', stripe.priceMonthly, 'month'],
        ['yearly', stripe.priceYearly, 'year'],
      ]) {
        if (!id) continue;
        try {
          const price = await billing.retrievePrice(id);
          output[name] = {
            id: price.id,
            amount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval || fallbackInterval,
          };
        } catch (_) {}
      }
      return { success: true, prices: output };
    } catch (_) {
      return { success: true, prices: {} };
    }
  }

  async function createCheckout({ input, user, baseUrl }) {
    assertConfigured();
    const uid = String(user?.uid || '').trim();
    const email = String(user?.email || '').trim();
    const name = String(user?.name || '').trim();
    if (!uid) throw new AppError('Missing user id.', 401, 'UNAUTHORIZED');
    const selectedPrice = priceId(input);
    const wantsEmbedded = String(input.uiMode || 'redirect').trim() === 'embedded';
    let customerId = null;
    try { customerId = await billing.getStripeCustomerIdForUser(uid); } catch (_) {}
    const params = {
      mode: 'subscription',
      client_reference_id: uid,
      ...(customerId ? { customer: customerId } : { customer_email: email || undefined }),
      line_items: [{ price: selectedPrice, quantity: 1 }],
      success_url: wantsEmbedded ? undefined : `${baseUrl}/?billing=success`,
      cancel_url: wantsEmbedded ? undefined : `${baseUrl}/?billing=cancel`,
      ui_mode: wantsEmbedded ? 'embedded_page' : undefined,
      return_url: wantsEmbedded ? embeddedReturnUrl(baseUrl) : undefined,
      allow_promotion_codes: false,
      discounts: await discountsFor(input.coupon),
      subscription_data: { metadata: { uid, email: email || '', name: name || '' } },
      metadata: { uid, email: email || '', name: name || '' },
    };
    let session;
    try {
      session = await billing.createCheckoutSession(params);
    } catch (error) {
      if (!wantsEmbedded || (String(error.param || '') !== 'ui_mode' && !/ui_mode/i.test(String(error.message || '')))) {
        throw error;
      }
      session = await billing.createCheckoutSession({
        ...params,
        ui_mode: 'embedded',
        return_url: embeddedReturnUrl(baseUrl),
      });
    }
    billing.appendStripeCheckoutInitiated({
      uid, email, name, sessionId: session.id, priceId: selectedPrice,
    }).catch(() => {});
    return wantsEmbedded
      ? { success: true, clientSecret: session.client_secret }
      : { success: true, url: session.url };
  }

  async function createGuestEmbedded({ input, baseUrl }) {
    assertConfigured();
    const params = {
      mode: 'subscription',
      line_items: [{ price: priceId(input), quantity: 1 }],
      ui_mode: 'embedded_page',
      return_url: embeddedReturnUrl(baseUrl),
      allow_promotion_codes: false,
      discounts: await discountsFor(input.coupon),
      subscription_data: { metadata: { guest: '1' } },
      metadata: { guest: '1' },
    };
    let session;
    try {
      session = await billing.createCheckoutSession(params);
    } catch (error) {
      if (String(error.param || '') !== 'ui_mode' && !/ui_mode/i.test(String(error.message || ''))) throw error;
      session = await billing.createCheckoutSession({
        ...params,
        ui_mode: 'embedded',
        return_url: embeddedReturnUrl(baseUrl),
      });
    }
    return { success: true, clientSecret: session.client_secret };
  }

  async function createGuestRedirect({ input, baseUrl }) {
    assertConfigured();
    const session = await billing.createCheckoutSession({
      mode: 'subscription',
      line_items: [{ price: priceId(input), quantity: 1 }],
      success_url: `${baseUrl}/?billing=success`,
      cancel_url: `${baseUrl}/?billing=cancel`,
      allow_promotion_codes: false,
      discounts: await discountsFor(input.coupon),
      subscription_data: { metadata: { guest: '1' } },
      metadata: { guest: '1' },
    });
    if (!session?.url) throw new AppError('Checkout failed.', 503, 'STRIPE_CHECKOUT_FAILED');
    return { success: true, url: session.url };
  }

  async function claim({ sessionId, user }) {
    assertConfigured();
    const uid = String(user?.uid || '').trim();
    const email = String(user?.email || '').trim().toLowerCase();
    if (!uid || !email) throw new AppError('Missing user identity.', 401, 'UNAUTHORIZED');
    const session = await billing.retrieveCheckoutSession(String(sessionId || '').trim());
    const customerId = String(session?.customer || '').trim();
    const subscriptionId = String(session?.subscription || '').trim();
    const paidEmail = String(session?.customer_details?.email || session?.customer_email || '').trim().toLowerCase();
    if (!customerId || !subscriptionId) {
      throw new AppError('Checkout session is not complete yet. Please try again after payment.', 409, 'CHECKOUT_NOT_COMPLETE');
    }
    if (!paidEmail || paidEmail !== email) {
      throw new AppError(
        'This Stripe checkout was completed with a different email. Please sign in with the same email used during payment.',
        409,
        'CHECKOUT_EMAIL_MISMATCH'
      );
    }
    try {
      await billing.updateSubscription(subscriptionId, {
        metadata: { uid, email: user.email || '', name: user.name || '' },
      });
    } catch (_) {}
    const paidName = String(session?.customer_details?.name || '').trim();
    await billing.claimStripeCheckoutOwnership({
      uid,
      customerId,
      subscriptionId,
      email: user.email || paidEmail || null,
      name: user.name || paidName || null,
    });
    const subscription = await billing.retrieveSubscription(subscriptionId);
    if (subscription && typeof subscription === 'object') {
      subscription.metadata = { ...(subscription.metadata || {}), uid };
    }
    await billing.upsertStripeSubscription(subscription);
    return { success: true };
  }

  async function portal({ user, baseUrl }) {
    assertConfigured();
    const uid = String(user?.uid || '').trim();
    if (!uid) throw new AppError('Missing user id.', 401, 'UNAUTHORIZED');
    const customerId = await billing.getStripeCustomerIdForUser(uid);
    if (!customerId) throw new AppError('No Stripe customer found for this user yet.', 404, 'STRIPE_CUSTOMER_NOT_FOUND');
    const session = await billing.createBillingPortalSession({ customer: customerId, return_url: `${baseUrl}/` });
    return { success: true, url: session.url };
  }

  async function overview() {
    let data = await billing.getSubscriptionsOverview();
    const key = String(stripe.secretKey || '');
    const stripeMode = key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : 'unknown';
    try {
      if (billing.isStripeConfigured()) {
        const rows = Array.isArray(data.subscriptions) ? data.subscriptions : [];
        for (const row of rows.filter((item) => item?.stripeSubscriptionId && !item.currentPeriodEnd).slice(0, 25)) {
          try {
            const subscription = await billing.retrieveSubscription(String(row.stripeSubscriptionId));
            if (subscription && typeof subscription === 'object') {
              subscription.metadata = { ...(subscription.metadata || {}), uid: String(row.uid || '') };
            }
            await billing.upsertStripeSubscription(subscription);
            row.currentPeriodStart = subscription?.current_period_start ? Number(subscription.current_period_start) * 1000 : null;
            row.currentPeriodEnd = subscription?.current_period_end ? Number(subscription.current_period_end) * 1000 : null;
            row.cancelAtPeriodEnd = !!subscription?.cancel_at_period_end;
          } catch (_) {}
        }
        data = { ...data, subscriptions: rows };
      }
    } catch (_) {}
    return { success: true, stripeMode, ...data };
  }

  async function adminPortal({ customerId, baseUrl }) {
    assertConfigured();
    const session = await billing.createBillingPortalSession({
      customer: String(customerId || '').trim(),
      return_url: `${baseUrl}/admin/software-architecture/`,
    });
    return { success: true, url: session.url };
  }

  async function cancel({ subscriptionId, cancelAtPeriodEnd }) {
    assertConfigured();
    const subscription = await billing.updateSubscription(String(subscriptionId || '').trim(), {
      cancel_at_period_end: cancelAtPeriodEnd !== false,
    });
    await billing.upsertStripeSubscription(subscription);
    return {
      success: true,
      cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
      status: subscription.status || '',
    };
  }

  return Object.freeze({
    siteUrl: stripe.siteUrl,
    status, publicConfig, prices, createCheckout, createGuestEmbedded,
    createGuestRedirect, claim, portal, overview, adminPortal, cancel,
  });
}

module.exports = { createBillingUseCases };
