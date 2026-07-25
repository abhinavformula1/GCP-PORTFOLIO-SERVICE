'use strict';

const { assertPort } = require('../ports/assert');

function createSponsorshipsService(repository, clock = Date) {
  assertPort(repository, 'application.sponsorships.repository', [
    'listSponsorships',
    'listActiveSponsorships',
    'upsertSponsorship',
    'deleteSponsorship',
  ]);
  assertPort(clock, 'application.sponsorships.clock', ['now']);

  return {
    listSponsorships() {
      return repository.listSponsorships();
    },

    async listActiveSponsorships(placement) {
      const now = clock.now();
      const sponsors = await repository.listActiveSponsorships(placement);
      return sponsors.filter(function (sponsorship) {
        if (sponsorship.startsAt && sponsorship.startsAt > now) return false;
        if (sponsorship.expiresAt && sponsorship.expiresAt < now) return false;
        return true;
      });
    },

    upsertSponsorship(id, data) {
      return repository.upsertSponsorship(id, data);
    },

    async deleteSponsorship(id) {
      await repository.deleteSponsorship(id);
    },
  };
}

module.exports = { createSponsorshipsService };
