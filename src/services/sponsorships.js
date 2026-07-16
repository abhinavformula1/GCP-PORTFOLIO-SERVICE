'use strict';

const sponsorshipsRepository = require('../repositories/sponsorshipsRepository');

async function listSponsorships() {
  return sponsorshipsRepository.listSponsorships();
}

async function listActiveSponsorships(placement) {
  const now = new Date();
  const sponsors = await sponsorshipsRepository.listActiveSponsorships(placement);
  return sponsors
    .filter(function (s) {
      if (s.startsAt  && s.startsAt  > now.getTime()) return false;
      if (s.expiresAt && s.expiresAt < now.getTime()) return false;
      return true;
    });
}

async function upsertSponsorship(id, data) {
  return sponsorshipsRepository.upsertSponsorship(id, data);
}

async function deleteSponsorship(id) {
  await sponsorshipsRepository.deleteSponsorship(id);
}

module.exports = {
  listSponsorships,
  listActiveSponsorships,
  upsertSponsorship,
  deleteSponsorship,
};

