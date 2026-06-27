'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

// Legacy "single active banner" model (separate from B2B sponsor cards).
// Stored as: /sponsorship/active
const COLLECTION = 'sponsorship';
const DOC_ID = 'active';

function normaliseBanner(data) {
  const d = data && typeof data === 'object' ? data : {};
  const expiresAtMs = d.expiresAt && d.expiresAt.toMillis ? d.expiresAt.toMillis() : null;
  return {
    url: String(d.url || ''),
    alt: String(d.alt || ''),
    link: String(d.link || ''),
    cta:  String(d.cta || ''),
    expiresAt: expiresAtMs,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
  };
}

async function getSponsorBanner() {
  const snap = await firestore.getDb().collection(COLLECTION).doc(DOC_ID).get();
  if (!snap.exists) return null;
  const banner = normaliseBanner(snap.data());
  if (!banner.url) return null;
  if (banner.expiresAt && banner.expiresAt < Date.now()) return null;
  return banner;
}

async function upsertSponsorBanner({ url, alt, link, cta, expiresAt }) {
  const ref = firestore.getDb().collection(COLLECTION).doc(DOC_ID);
  await ref.set({
    url: String(url || '').trim(),
    alt: String(alt || '').trim(),
    link: String(link || '').trim(),
    cta:  String(cta || '').trim(),
    expiresAt: expiresAt ? expiresAt : null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return getSponsorBanner();
}

async function deleteSponsorBanner() {
  await firestore.getDb().collection(COLLECTION).doc(DOC_ID).delete();
}

module.exports = {
  getSponsorBanner,
  upsertSponsorBanner,
  deleteSponsorBanner,
};

