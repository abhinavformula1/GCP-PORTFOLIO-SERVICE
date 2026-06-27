'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

const PROMOTIONS_COLLECTION = 'promotions';
const BILLING_USERS_COLLECTION = 'billingUsers';

function normalisePromoCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function createPromotion(promo, { createdBy } = {}) {
  const p = promo && typeof promo === 'object' ? promo : {};
  const code = normalisePromoCode(p.code);
  if (!code || code.length < 3 || code.length > 24) throw new Error('Promo code must be 3–24 chars.');

  const days = Math.max(1, Math.min(365, Number(p.days || 30)));
  const maxRedemptions = p.maxRedemptions == null ? null : Math.max(1, Math.min(100000, Number(p.maxRedemptions || 0)));
  const startsAt = p.startsAt ? Number(p.startsAt) : null;
  const expiresAt = p.expiresAt ? Number(p.expiresAt) : null;
  const active = p.active !== false;

  const db = firestore.getDb();
  const ref = db.collection(PROMOTIONS_COLLECTION).doc(code);
  await ref.set({
    code,
    days,
    maxRedemptions: maxRedemptions || null,
    redeemedCount: 0,
    active,
    startsAt: startsAt ? new Date(startsAt) : null,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdBy: createdBy || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { code };
}

async function updatePromotion(code, patch, { updatedBy } = {}) {
  const id = normalisePromoCode(code);
  const p = patch && typeof patch === 'object' ? patch : {};
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(p, 'active')) updates.active = !!p.active;
  if (Object.prototype.hasOwnProperty.call(p, 'days')) updates.days = Math.max(1, Math.min(365, Number(p.days || 30)));
  if (Object.prototype.hasOwnProperty.call(p, 'maxRedemptions')) {
    const mr = p.maxRedemptions == null ? null : Math.max(1, Math.min(100000, Number(p.maxRedemptions || 0)));
    updates.maxRedemptions = mr || null;
  }
  if (Object.prototype.hasOwnProperty.call(p, 'startsAt')) updates.startsAt = p.startsAt ? new Date(Number(p.startsAt)) : null;
  if (Object.prototype.hasOwnProperty.call(p, 'expiresAt')) updates.expiresAt = p.expiresAt ? new Date(Number(p.expiresAt)) : null;
  updates.updatedBy = updatedBy || null;
  updates.updatedAt = FieldValue.serverTimestamp();
  await firestore.getDb().collection(PROMOTIONS_COLLECTION).doc(id).set(updates, { merge: true });
  return { code: id };
}

async function listPromotions() {
  const snap = await firestore.getDb().collection(PROMOTIONS_COLLECTION).orderBy('updatedAt', 'desc').limit(200).get();
  return snap.docs.map((d) => {
    const data = d.data() || {};
    return {
      code: d.id,
      active: data.active !== false,
      days: Number(data.days || 0),
      redeemedCount: Number(data.redeemedCount || 0),
      maxRedemptions: data.maxRedemptions == null ? null : Number(data.maxRedemptions || 0),
      startsAt: data.startsAt && data.startsAt.toMillis ? data.startsAt.toMillis() : null,
      expiresAt: data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : null,
      updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
    };
  });
}

async function redeemPromotion({ uid, code }) {
  const userId = String(uid || '').trim();
  const promoCode = normalisePromoCode(code);
  if (!userId) throw new Error('Missing user id.');
  if (!promoCode) throw new Error('Missing promo code.');

  const db = firestore.getDb();
  const promoRef = db.collection(PROMOTIONS_COLLECTION).doc(promoCode);
  const userRef = db.collection(BILLING_USERS_COLLECTION).doc(userId);
  const redemptionRef = promoRef.collection('redemptions').doc(userId);

  return db.runTransaction(async (tx) => {
    const [promoSnap, redemptionSnap] = await Promise.all([
      tx.get(promoRef),
      tx.get(redemptionRef),
    ]);
    if (!promoSnap.exists) throw new Error('Invalid promo code.');
    if (redemptionSnap.exists) {
      const userSnap = await tx.get(userRef);
      const u = userSnap.exists ? (userSnap.data() || {}) : {};
      const promoUntilMs = u.promoUntil && u.promoUntil.toMillis ? u.promoUntil.toMillis() : null;
      return { alreadyRedeemed: true, code: promoCode, promoUntil: promoUntilMs || null };
    }
    const p = promoSnap.data() || {};
    if (p.active === false) throw new Error('Promo code is disabled.');
    const now = Date.now();
    const startsAt = p.startsAt && p.startsAt.toMillis ? p.startsAt.toMillis() : null;
    const expiresAt = p.expiresAt && p.expiresAt.toMillis ? p.expiresAt.toMillis() : null;
    if (startsAt && now < startsAt) throw new Error('Promo code is not active yet.');
    if (expiresAt && now > expiresAt) throw new Error('Promo code has expired.');
    const redeemed = Number(p.redeemedCount || 0);
    const maxR = p.maxRedemptions == null ? null : Number(p.maxRedemptions || 0);
    if (maxR && redeemed >= maxR) throw new Error('Promo code has reached its limit.');

    const days = Math.max(1, Math.min(365, Number(p.days || 30)));
    const until = new Date(now + days * 24 * 60 * 60 * 1000);

    tx.set(redemptionRef, { uid: userId, redeemedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(promoRef, { redeemedCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(userRef, {
      uid: userId,
      promoCode,
      promoUntil: until,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { code: promoCode, promoUntil: until.getTime(), days };
  });
}

module.exports = {
  normalisePromoCode,
  createPromotion,
  updatePromotion,
  listPromotions,
  redeemPromotion,
};

