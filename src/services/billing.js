'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

const BILLING_USERS_COLLECTION = 'billingUsers';
const BILLING_CUSTOMERS_COLLECTION = 'billingCustomers';
const BILLING_EVENTS_COLLECTION = 'billingEvents';

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
  const ref = firestore.getDb().collection(BILLING_EVENTS_COLLECTION).doc();
  await ref.set({
    type: 'checkout_initiated',
    uid: id,
    email: email || null,
    name: name || null,
    sessionId: sessionId || null,
    priceId: priceId || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
}

async function upsertStripeCheckoutCompleted(session) {
  const s = session && typeof session === 'object' ? session : {};
  const uid = String(s.client_reference_id || (s.metadata && s.metadata.uid) || '').trim();
  const customerId = String(s.customer || '').trim();
  const subscriptionId = String(s.subscription || '').trim();
  if (!uid || !customerId) return null;

  const userRef = firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(uid);
  const customerRef = firestore.getDb().collection(BILLING_CUSTOMERS_COLLECTION).doc(customerId);
  await Promise.all([
    userRef.set({
      uid,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId || null,
      email: (s.customer_details && s.customer_details.email) ? String(s.customer_details.email) : (s.metadata && s.metadata.email) ? String(s.metadata.email) : null,
      name: (s.customer_details && s.customer_details.name) ? String(s.customer_details.name) : (s.metadata && s.metadata.name) ? String(s.metadata.name) : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    customerRef.set({
      uid,
      stripeCustomerId: customerId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
  return { uid, customerId, subscriptionId };
}

async function upsertStripeSubscription(subscription) {
  const sub = subscription && typeof subscription === 'object' ? subscription : {};
  const subscriptionId = String(sub.id || '').trim();
  const customerId = String(sub.customer || '').trim();
  if (!subscriptionId || !customerId) return null;

  // Resolve uid via metadata, falling back to our customer index.
  let uid = String(sub.metadata && sub.metadata.uid ? sub.metadata.uid : '').trim();
  if (!uid) {
    const custSnap = await firestore.getDb().collection(BILLING_CUSTOMERS_COLLECTION).doc(customerId).get();
    if (custSnap.exists) uid = String((custSnap.data() || {}).uid || '').trim();
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

  const userRef = firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(uid);
  await userRef.set({
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
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await firestore.getDb().collection(BILLING_EVENTS_COLLECTION).doc().set({
    type: 'subscription_' + status,
    uid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { uid, customerId, subscriptionId, status };
}

async function appendStripeInvoiceEvent(invoice, type) {
  const inv = invoice && typeof invoice === 'object' ? invoice : {};
  const customerId = String(inv.customer || '').trim();
  const subscriptionId = String(inv.subscription || '').trim();
  let uid = '';
  if (customerId) {
    const custSnap = await firestore.getDb().collection(BILLING_CUSTOMERS_COLLECTION).doc(customerId).get();
    if (custSnap.exists) uid = String((custSnap.data() || {}).uid || '').trim();
  }
  await firestore.getDb().collection(BILLING_EVENTS_COLLECTION).doc().set({
    type: String(type || 'invoice_event'),
    uid: uid || null,
    stripeCustomerId: customerId || null,
    stripeSubscriptionId: subscriptionId || null,
    invoiceId: inv.id || null,
    amountPaid: Number(inv.amount_paid || 0),
    amountDue: Number(inv.amount_due || 0),
    currency: inv.currency ? String(inv.currency).toUpperCase() : null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function getStripeCustomerIdForUser(uid) {
  const id = String(uid || '').trim();
  if (!id) return '';
  const snap = await firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(id).get();
  if (!snap.exists) return '';
  const data = snap.data() || {};
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
  const snap = await firestore.getDb().collection(BILLING_USERS_COLLECTION).orderBy('updatedAt', 'desc').limit(250).get();
  const rows = snap.docs.map((d) => {
    const data = d.data() || {};
    const { mrrCents, currency } = mrrFromPlan({
      amount: data.amount,
      currency: data.currency,
      interval: data.interval,
      intervalCount: data.intervalCount,
    });
    return {
      uid: d.id,
      name: data.name || null,
      email: data.email || null,
      status: data.status || 'unknown',
      priceId: data.priceId || null,
      planNickname: data.planNickname || null,
      amount: Number(data.amount || 0),
      currency: data.currency || null,
      interval: data.interval || null,
      intervalCount: Number(data.intervalCount || 1),
      currentPeriodEnd: data.currentPeriodEnd || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
      updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
      mrrCents,
      mrrCurrency: currency,
    };
  });

  const active = rows.filter((r) => r.status === 'active' || r.status === 'trialing');
  const mrrByCurrency = active.reduce((acc, r) => {
    const cur = String(r.mrrCurrency || 'USD');
    acc[cur] = (acc[cur] || 0) + Number(r.mrrCents || 0);
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
    },
    subscriptions: rows,
  };
}

async function getUserSubscriptionEntitlement(uid) {
  const id = String(uid || '').trim();
  if (!id) return { active: false, status: 'guest' };
  const snap = await firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(id).get();
  if (!snap.exists) return { active: false, status: 'none' };
  const d = snap.data() || {};
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
  };
}

module.exports = {
  appendStripeCheckoutInitiated,
  upsertStripeCheckoutCompleted,
  upsertStripeSubscription,
  appendStripeInvoiceEvent,
  getStripeCustomerIdForUser,
  getSubscriptionsOverview,
  getUserSubscriptionEntitlement,
};

