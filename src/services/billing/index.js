'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const billingRepository = require('../../repositories/billingRepository');
const usersRepository = require('../../repositories/usersRepository');

function normaliseStripeAmount(price) {
  const p = price && typeof price === 'object' ? price : null;
  if (!p) return { amount: 0, currency: '' };
  const amt = Number(p.unit_amount || 0);
  const cur = String(p.currency || '').toUpperCase();
  return { amount: isFinite(amt) ? amt : 0, currency: cur };
}

function inferInterval(price) {
  const p = price && typeof price === 'object' ? price : null;
  const rec = p && p.recurring ? p.recurring : null;
  const interval = rec ? String(rec.interval || '') : '';
  const count = rec ? Number(rec.interval_count || 1) : 1;
  return { interval: interval || '', intervalCount: isFinite(count) ? count : 1 };
}

async function appendStripeCheckoutInitiated({ uid, email, name, sessionId, priceId }) {
  const id = String(uid || '').trim();
  if (!id) return null;
  return billingRepository.appendBillingEvent({
    type: 'checkout_initiated',
    uid: id,
    email: email || null,
    name: name || null,
    sessionId: sessionId || null,
    priceId: priceId || null,
  });
}

async function upsertStripeCheckoutCompleted(session) {
  const s = session && typeof session === 'object' ? session : {};
  const uid = String(s.client_reference_id || (s.metadata && s.metadata.uid) || '').trim();
  const customerId = String(s.customer || '').trim();
  const subscriptionId = String(s.subscription || '').trim();
  if (!uid || !customerId) return null;

  await Promise.all([
    billingRepository.upsertBillingUser(uid, {
      uid,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId || null,
      email: (s.customer_details && s.customer_details.email) ? String(s.customer_details.email) : (s.metadata && s.metadata.email) ? String(s.metadata.email) : null,
      name: (s.customer_details && s.customer_details.name) ? String(s.customer_details.name) : (s.metadata && s.metadata.name) ? String(s.metadata.name) : null,
    }),
    billingRepository.upsertBillingCustomer(customerId, {
      uid,
      stripeCustomerId: customerId,
    }),
  ]);
  return { uid, customerId, subscriptionId };
}

async function upsertStripeSubscription(subscription) {
  const sub = subscription && typeof subscription === 'object' ? subscription : {};
  const subscriptionId = String(sub.id || '').trim();
  const customerId = String(sub.customer || '').trim();
  if (!subscriptionId || !customerId) return null;

  let uid = String(sub.metadata && sub.metadata.uid ? sub.metadata.uid : '').trim();
  if (!uid) {
    const customer = await billingRepository.getBillingCustomer(customerId);
    if (customer) uid = String(customer.uid || '').trim();
  }
  if (!uid) return null;

  const status = String(sub.status || '').trim();
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  const currentPeriodEndMs = sub.current_period_end ? Number(sub.current_period_end) * 1000 : null;
  const currentPeriodStartMs = sub.current_period_start ? Number(sub.current_period_start) * 1000 : null;

  const item = sub.items && sub.items.data && sub.items.data[0] ? sub.items.data[0] : null;
  const price = item && item.price ? item.price : null;
  const priceId = price ? String(price.id || '') : '';
  const productId = price ? String(price.product || '') : '';
  const nickname = price ? String(price.nickname || '') : '';
  const { amount, currency } = normaliseStripeAmount(price);
  const { interval, intervalCount } = inferInterval(price);

  await billingRepository.upsertBillingUser(uid, {
    uid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    cancelAtPeriodEnd,
    currentPeriodStart: currentPeriodStartMs,
    currentPeriodEnd: currentPeriodEndMs,
    priceId: priceId || null,
    productId: productId || null,
    planNickname: nickname || null,
    amount,
    currency: currency || null,
    interval: interval || null,
    intervalCount,
  });

  try {
    const userData = await usersRepository.getUser(uid) || {};
    if (String(userData.tierSource || '') !== 'manual') {
      const userTier = (status === 'active' || status === 'trialing') ? 'premium' : 'free';
      await usersRepository.mergeUserFields(uid, {
        tier: userTier,
        tierSource: 'stripe',
        tierUpdatedAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (tierErr) {
    console.warn('[billing] Failed to sync users.tier for uid', uid, tierErr.message);
  }

  await billingRepository.appendBillingEvent({
    type: 'subscription_' + status,
    uid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
  });

  return { uid, customerId, subscriptionId, status };
}

async function appendStripeInvoiceEvent(invoice, type) {
  const inv = invoice && typeof invoice === 'object' ? invoice : {};
  const customerId = String(inv.customer || '').trim();
  const subscriptionId = String(inv.subscription || '').trim();
  let uid = '';
  if (customerId) {
    const customer = await billingRepository.getBillingCustomer(customerId);
    if (customer) uid = String(customer.uid || '').trim();
  }
  await billingRepository.appendBillingEvent({
    type: String(type || 'invoice_event'),
    uid: uid || null,
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscriptionId || null,
    invoiceId: inv.id || null,
    amountPaid: Number(inv.amount_paid || 0),
    amountDue: Number(inv.amount_due || 0),
    currency: inv.currency ? String(inv.currency).toUpperCase() : null,
  });
}

async function getStripeCustomerIdForUser(uid) {
  const id = String(uid || '').trim();
  if (!id) return '';
  const data = await billingRepository.getBillingUser(id);
  if (!data) return '';
  return String(data.stripeCustomerId || '').trim();
}

function mrrFromPlan({ amount, currency, interval, intervalCount }) {
  const amt = Number(amount || 0);
  const cur = String(currency || '').toUpperCase();
  if (!amt || !cur) return { mrrCents: 0, currency: cur || 'USD' };
  const i = String(interval || '');
  const c = Number(intervalCount || 1) || 1;
  if (i === 'month') return { mrrCents: Math.round(amt / c), currency: cur };
  if (i === 'year') return { mrrCents: Math.round(amt / (12 * c)), currency: cur };
  return { mrrCents: 0, currency: cur };
}

async function getSubscriptionsOverview() {
  const rows = (await billingRepository.listBillingUsers(250)).map(({ id, data }) => {
    const { mrrCents, currency } = mrrFromPlan({
      amount: data.amount,
      currency: data.currency,
      interval: data.interval,
      intervalCount: data.intervalCount,
    });
    return {
      uid: id,
      name: data.name || null,
      email: data.email || null,
      status: data.status || 'unknown',
      stripeCustomerId: data.stripeCustomerId || null,
      stripeSubscriptionId: data.stripeSubscriptionId || null,
      priceId: data.priceId || null,
      planNickname: data.planNickname || null,
      amount: Number(data.amount || 0),
      currency: data.currency || null,
      interval: data.interval || null,
      intervalCount: Number(data.intervalCount || 1),
      currentPeriodStart: data.currentPeriodStart || null,
      currentPeriodEnd: data.currentPeriodEnd || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
      updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
      mrrCents,
      mrrCurrency: currency,
    };
  });

  try {
    const missing = rows
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => (!r.name || !r.email) && r.uid);
    if (missing.length) {
      const filled = await Promise.all(missing.map(async ({ r, idx }) => {
        try {
          const u = await usersRepository.getUser(r.uid);
          if (!u) return null;
          const name = r.name || u.name || null;
          const email = r.email || u.email || null;
          if (name || email) {
            await billingRepository.upsertBillingUser(r.uid, {
              name,
              email,
            });
          }
          return { idx, name, email };
        } catch (_) {
          return null;
        }
      }));
      filled.filter(Boolean).forEach((f) => {
        rows[f.idx] = { ...rows[f.idx], name: f.name || rows[f.idx].name, email: f.email || rows[f.idx].email };
      });
    }
  } catch (_) {}

  const active = rows.filter((r) => r.status === 'active' || r.status === 'trialing');
  const mrrByCurrency = active.reduce((acc, r) => {
    const cur = String(r.mrrCurrency || 'USD');
    acc[cur] = (acc[cur] || 0) + Number(r.mrrCents || 0);
    return acc;
  }, {});
  const arrByCurrency = Object.keys(mrrByCurrency).reduce((acc, cur) => {
    acc[cur] = Number(mrrByCurrency[cur] || 0) * 12;
    return acc;
  }, {});

  const counts = rows.reduce((acc, r) => {
    const s = String(r.status || 'unknown');
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return {
    kpis: {
      total: rows.length,
      active: active.length,
      statusCounts: counts,
      mrrByCurrency,
      arrByCurrency,
    },
    subscriptions: rows,
  };
}

async function getUserSubscriptionEntitlement(uid) {
  const id = String(uid || '').trim();
  if (!id) return { active: false, status: 'guest' };

  try {
    const u = await usersRepository.getUser(id);
    if (u && String(u.tierSource || '') === 'manual') {
        const manualActive = String(u.tier || '') === 'premium';
        return {
          active: manualActive,
          status: manualActive ? 'active' : 'free',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          promo: null,
          planNickname: 'Manual override',
          amount: 0,
          currency: null,
          interval: null,
          intervalCount: 1,
        };
    }
  } catch (_) {}

  const d = await billingRepository.getBillingUser(id);
  if (!d) return { active: false, status: 'none' };
  const status = String(d.status || 'unknown');
  const promoUntil = d.promoUntil && d.promoUntil.toMillis ? d.promoUntil.toMillis() : (d.promoUntil ? Number(d.promoUntil) : null);
  const promoActive = promoUntil && promoUntil > Date.now();
  const active = status === 'active' || status === 'trialing' || promoActive;
  return {
    active,
    status,
    currentPeriodEnd: d.currentPeriodEnd || null,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
    promo: promoActive ? { until: promoUntil, code: d.promoCode || null } : null,
    planNickname: d.planNickname || null,
    amount: Number(d.amount || 0) || 0,
    currency: d.currency || null,
    interval: d.interval || null,
    intervalCount: Number(d.intervalCount || 1) || 1,
  };
}

async function claimStripeCheckoutOwnership({ uid, customerId, subscriptionId, email, name }) {
  const id = String(uid || '').trim();
  const customer = String(customerId || '').trim();
  if (!id || !customer) return null;

  await Promise.all([
    billingRepository.upsertBillingCustomer(customer, {
      uid: id,
      stripeCustomerId: customer,
      email: email || null,
    }),
    billingRepository.upsertBillingUser(id, {
      uid: id,
      stripeCustomerId: customer,
      stripeSubscriptionId: subscriptionId || null,
      email: email || null,
      name: name || null,
    }),
  ]);

  return { uid: id, customerId: customer, subscriptionId: subscriptionId || null };
}

module.exports = {
  appendStripeCheckoutInitiated,
  upsertStripeCheckoutCompleted,
  upsertStripeSubscription,
  appendStripeInvoiceEvent,
  getStripeCustomerIdForUser,
  getSubscriptionsOverview,
  getUserSubscriptionEntitlement,
  claimStripeCheckoutOwnership,
};
