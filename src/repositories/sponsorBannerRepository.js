'use strict';

/**
 * Sponsor banner repository.
 *
 * Firestore-backed persistence for the legacy single active sponsor banner.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const COLLECTION = 'sponsorship';
const DOC_ID = 'active';

function normaliseBanner(data) {
  const d = data && typeof data === 'object' ? data : {};
  const expiresAtMs = d.expiresAt && d.expiresAt.toMillis ? d.expiresAt.toMillis() : null;
  return {
    url: String(d.url || ''),
    alt: String(d.alt || ''),
    link: String(d.link || ''),
    cta: String(d.cta || ''),
    expiresAt: expiresAtMs,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
  };
}

function bannerDoc() {
  return firestore.getDb().collection(COLLECTION).doc(DOC_ID);
}

async function getSponsorBanner() {
  const snap = await bannerDoc().get();
  if (!snap.exists) return null;
  return normaliseBanner(snap.data());
}

async function upsertSponsorBanner({ url, alt, link, cta, expiresAt }) {
  const ref = bannerDoc();
  await ref.set({
    url: String(url || '').trim(),
    alt: String(alt || '').trim(),
    link: String(link || '').trim(),
    cta: String(cta || '').trim(),
    expiresAt: expiresAt || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  const saved = await ref.get();
  return normaliseBanner(saved.data() || {});
}

async function deleteSponsorBanner() {
  await bannerDoc().delete();
}

module.exports = {
  getSponsorBanner,
  upsertSponsorBanner,
  deleteSponsorBanner,
};
