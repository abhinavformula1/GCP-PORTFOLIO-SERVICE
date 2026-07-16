'use strict';

/**
 * Users repository.
 *
 * Domain-facing persistence for lightweight signed-in user profile data.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const USERS_COLLECTION = 'users';

async function getUser(uid) {
  const snap = await firestore.getDb().collection(USERS_COLLECTION).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function mergeUserFields(uid, fields) {
  const id = String(uid || '').trim();
  if (!id || !fields || typeof fields !== 'object') return;
  await firestore.getDb().collection(USERS_COLLECTION).doc(id).set(fields, { merge: true });
}

async function upsertUserVisit({ uid, email, name, picture }) {
  const ref = firestore.getDb().collection(USERS_COLLECTION).doc(uid);

  return firestore.getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    if (snap.exists) {
      const existing = snap.data();
      const existingTier = existing && existing.tier ? String(existing.tier) : '';
      const update = {
        email,
        name,
        picture: picture || null,
        lastSeenAt: now,
        visitCount: FieldValue.increment(1),
      };
      if (!existingTier) update.tier = 'free';
      tx.update(ref, update);
      return {
        isReturning: true,
        visitCount: (existing.visitCount || 0) + 1,
        firstSeenAt: existing.firstSeenAt || null,
        lastSeenAt: existing.lastSeenAt || null,
        tier: existingTier || 'free',
      };
    }

    tx.set(ref, {
      email,
      name,
      picture: picture || null,
      firstSeenAt: now,
      lastSeenAt: now,
      visitCount: 1,
      tier: 'free',
    });
    return {
      isReturning: false,
      visitCount: 1,
      firstSeenAt: null,
      lastSeenAt: null,
      tier: 'free',
    };
  });
}

module.exports = {
  getUser,
  mergeUserFields,
  upsertUserVisit,
};
