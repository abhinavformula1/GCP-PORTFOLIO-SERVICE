'use strict';

/**
 * Billing repository.
 *
 * Firestore-backed persistence for billing users, customers, and event logs.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const BILLING_USERS_COLLECTION = 'billingUsers';
const BILLING_CUSTOMERS_COLLECTION = 'billingCustomers';
const BILLING_EVENTS_COLLECTION = 'billingEvents';

async function appendBillingEvent(data) {
  const ref = firestore.getDb().collection(BILLING_EVENTS_COLLECTION).doc();
  await ref.set(Object.assign({}, data, {
    createdAt: FieldValue.serverTimestamp(),
  }));
  return { id: ref.id };
}

async function upsertBillingUser(uid, data) {
  const id = String(uid || '').trim();
  if (!id) return;
  await firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(id).set(Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true });
}

async function getBillingUser(uid) {
  const id = String(uid || '').trim();
  if (!id) return null;
  const snap = await firestore.getDb().collection(BILLING_USERS_COLLECTION).doc(id).get();
  return snap.exists ? (snap.data() || {}) : null;
}

async function listBillingUsers(limit = 250) {
  const snap = await firestore.getDb()
    .collection(BILLING_USERS_COLLECTION)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
}

async function upsertBillingCustomer(customerId, data) {
  const id = String(customerId || '').trim();
  if (!id) return;
  await firestore.getDb().collection(BILLING_CUSTOMERS_COLLECTION).doc(id).set(Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }), { merge: true });
}

async function getBillingCustomer(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return null;
  const snap = await firestore.getDb().collection(BILLING_CUSTOMERS_COLLECTION).doc(id).get();
  return snap.exists ? (snap.data() || {}) : null;
}

module.exports = {
  appendBillingEvent,
  upsertBillingUser,
  getBillingUser,
  listBillingUsers,
  upsertBillingCustomer,
  getBillingCustomer,
};
