'use strict';

/**
 * Recommendations repository.
 *
 * Domain-facing Firestore-backed persistence for public recommendations.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const RECOMMENDATIONS_COLLECTION = 'recommendations';

function recommendationDocRef(uid) {
  return firestore.getDb().collection(RECOMMENDATIONS_COLLECTION).doc(uid);
}

async function upsertRecommendation({
  uid, email, emailVerified, hostedDomain, name, company, avatarUrl, text,
}) {
  const ref = recommendationDocRef(uid);
  return firestore.getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    const base = {
      uid,
      email: email || '',
      emailVerified: !!emailVerified,
      hostedDomain: hostedDomain || '',
      name: name || '',
      company: company || '',
      avatarUrl: avatarUrl || null,
      text: String(text || '').slice(0, 5000),
      status: 'Active',
      updatedAt: now,
    };

    if (snap.exists) {
      tx.update(ref, base);
      return { isNew: false };
    }
    tx.set(ref, Object.assign({}, base, {
      submittedAt: now,
      reply: null,
      repliedAt: null,
    }));
    return { isNew: true };
  });
}

async function listActiveRecommendations() {
  const snap = await firestore.getDb()
    .collection(RECOMMENDATIONS_COLLECTION)
    .where('status', '==', 'Active')
    .orderBy('submittedAt', 'desc')
    .limit(100)
    .get();

  return snap.docs.map((d) => {
    const v = d.data() || {};
    return {
      id: d.id,
      name: v.name || '',
      company: v.company || '',
      avatarUrl: v.avatarUrl || null,
      text: v.text || '',
      reply: v.reply || null,
      submittedAt: v.submittedAt && v.submittedAt.toMillis ? v.submittedAt.toMillis() : null,
      updatedAt: v.updatedAt && v.updatedAt.toMillis ? v.updatedAt.toMillis() : null,
      repliedAt: v.repliedAt && v.repliedAt.toMillis ? v.repliedAt.toMillis() : null,
    };
  });
}

async function writeRecommendationReply(uid, { reply }) {
  const ref = recommendationDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return { applied: false, reason: 'not_found' };

  const now = FieldValue.serverTimestamp();
  await ref.update({
    reply: String(reply || '').slice(0, 1000),
    repliedAt: now,
    updatedAt: now,
  });
  return { applied: true };
}

async function deleteRecommendation(uid) {
  const ref = recommendationDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return { deleted: false };
  await ref.delete();
  return { deleted: true };
}

module.exports = {
  upsertRecommendation,
  listActiveRecommendations,
  writeRecommendationReply,
  deleteRecommendation,
};
