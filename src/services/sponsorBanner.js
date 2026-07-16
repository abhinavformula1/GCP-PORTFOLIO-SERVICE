'use strict';

const sponsorBannerRepository = require('../repositories/sponsorBannerRepository');

async function getSponsorBanner() {
  const banner = await sponsorBannerRepository.getSponsorBanner();
  if (!banner) return null;
  if (!banner.url) return null;
  if (banner.expiresAt && banner.expiresAt < Date.now()) return null;
  return banner;
}

async function upsertSponsorBanner({ url, alt, link, cta, expiresAt }) {
  await sponsorBannerRepository.upsertSponsorBanner({ url, alt, link, cta, expiresAt });
  return getSponsorBanner();
}

async function deleteSponsorBanner() {
  await sponsorBannerRepository.deleteSponsorBanner();
}

module.exports = {
  getSponsorBanner,
  upsertSponsorBanner,
  deleteSponsorBanner,
};

