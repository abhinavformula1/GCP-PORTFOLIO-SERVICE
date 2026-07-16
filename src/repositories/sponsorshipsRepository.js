'use strict';

/**
 * Sponsorships repository.
 *
 * Firestore-backed persistence for B2B sponsorship cards.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const SPONSORSHIPS_COLLECTION = 'sponsorships';

function normaliseSponsor(id, data) {
  return {
    id,
    company: String(data.company || ''),
    headline: String(data.headline || ''),
    cta: String(data.cta || 'Learn More'),
    ctaUrl: String(data.ctaUrl || ''),
    logoUrl: String(data.logoUrl || ''),
    placement: String(data.placement || 'article-footer'),
    active: data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt: data.startsAt && data.startsAt.toMillis ? data.startsAt.toMillis() : null,
    expiresAt: data.expiresAt && data.expiresAt.toMillis ? data.expiresAt.toMillis() : null,
    updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
  };
}

function sponsorshipsCollection() {
  return firestore.getDb().collection(SPONSORSHIPS_COLLECTION);
}

async function listSponsorships() {
  const snap = await sponsorshipsCollection().orderBy('updatedAt', 'desc').get();
  return snap.docs.map((d) => normaliseSponsor(d.id, d.data()));
}

async function listActiveSponsorships(placement) {
  let query = sponsorshipsCollection().where('active', '==', true);
  if (placement) query = query.where('placement', '==', placement);
  const snap = await query.get();
  return snap.docs.map((d) => normaliseSponsor(d.id, d.data()));
}

async function upsertSponsorship(id, data) {
  const ref = id
    ? sponsorshipsCollection().doc(id)
    : sponsorshipsCollection().doc();
  const payload = {
    company: String(data.company || ''),
    headline: String(data.headline || ''),
    cta: String(data.cta || 'Learn More'),
    ctaUrl: String(data.ctaUrl || ''),
    logoUrl: String(data.logoUrl || ''),
    placement: String(data.placement || 'article-footer'),
    active: data.active !== false,
    adsenseSlot: String(data.adsenseSlot || ''),
    startsAt: data.startsAt ? new Date(data.startsAt) : null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(payload, { merge: true });
  const saved = await ref.get();
  return normaliseSponsor(saved.id, saved.data() || {});
}

async function deleteSponsorship(id) {
  await sponsorshipsCollection().doc(id).delete();
}

module.exports = {
  listSponsorships,
  listActiveSponsorships,
  upsertSponsorship,
  deleteSponsorship,
};
