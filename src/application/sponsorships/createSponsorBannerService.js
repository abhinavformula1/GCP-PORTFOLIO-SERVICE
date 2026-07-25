'use strict';

const { assertPort } = require('../ports/assert');

function createSponsorBannerService(repository, clock = Date) {
  assertPort(repository, 'application.sponsorBanner.repository', [
    'getSponsorBanner',
    'upsertSponsorBanner',
    'deleteSponsorBanner',
  ]);
  assertPort(clock, 'application.sponsorBanner.clock', ['now']);

  async function getSponsorBanner() {
    const banner = await repository.getSponsorBanner();
    if (!banner || !banner.url) return null;
    if (banner.expiresAt && banner.expiresAt < clock.now()) return null;
    return banner;
  }

  return {
    getSponsorBanner,

    async upsertSponsorBanner(data) {
      await repository.upsertSponsorBanner(data);
      return getSponsorBanner();
    },

    async deleteSponsorBanner() {
      await repository.deleteSponsorBanner();
    },
  };
}

module.exports = { createSponsorBannerService };
