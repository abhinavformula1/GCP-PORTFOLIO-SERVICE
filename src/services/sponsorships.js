'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

const SPONSORSHIPS_COLLECTION = 'sponsorships';

function normaliseSponsor(id, data) {
  return {
    id:          id,
    company:     String(data.company     || ''),
    headline:    String(data.headline    || ''),
    cta:         String(data.cta         || 'Learn More'),
    ctaUrl:      String(data.ctaUrl      || ''),
    logoUrl:     String(data.logoUrl     || ''),
    placement:   String(data.placement   || 'article-footer'),
    active:      data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt:    data.startsAt  && data.startsAt.toMillis  ? data.startsAt.toMillis()  : null,
    expiresAt:   data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : null,
    updatedAt:   data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
  };
}

async function listSponsorships() {
  const snap = await firestore.getDb().collection(SPONSORSHIPS_COLLECTION).orderBy('updatedAt', 'desc').get();
  return snap.docs.map(function (d) { return normaliseSponsor(d.id, d.data()); });
}

async function listActiveSponsorships(placement) {
  const now = new Date();
  let query = firestore.getDb().collection(SPONSORSHIPS_COLLECTION).where('active', '==', true);
  if (placement) query = query.where('placement', '==', placement);
  const snap = await query.get();
  return snap.docs
    .map(function (d) { return normaliseSponsor(d.id, d.data()); })
    .filter(function (s) {
      if (s.startsAt  && s.startsAt  > now.getTime()) return false;
      if (s.expiresAt && s.expiresAt < now.getTime()) return false;
      return true;
    });
}

async function upsertSponsorship(id, data) {
  const ref = id
    ? firestore.getDb().collection(SPONSORSHIPS_COLLECTION).doc(id)
    : firestore.getDb().collection(SPONSORSHIPS_COLLECTION).doc();
  const payload = {
    company:     String(data.company     || ''),
    headline:    String(data.headline    || ''),
    cta:         String(data.cta         || 'Learn More'),
    ctaUrl:      String(data.ctaUrl      || ''),
    logoUrl:     String(data.logoUrl     || ''),
    placement:   String(data.placement   || 'article-footer'),
    active:      data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt:    data.startsAt  ? new Date(data.startsAt)  : null,
    expiresAt:   data.expiresAt ? new Date(data.expiresAt) : null,
    updatedAt:   FieldValue.serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  const saved = await ref.get();
  return normaliseSponsor(saved.id, saved.data());
}

async function deleteSponsorship(id) {
  await firestore.getDb().collection(SPONSORSHIPS_COLLECTION).doc(id).delete();
}

module.exports = {
  listSponsorships,
  listActiveSponsorships,
  upsertSponsorship,
  deleteSponsorship,
};

