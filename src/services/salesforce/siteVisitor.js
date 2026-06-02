'use strict';

/**
 * Site_Visitor__c domain operation — VOLATILE layer.
 *
 * This file is expected to change whenever:
 *   - We track new visitor attributes (UA, locale, last-page, …)
 *   - The Google_UID__c external-ID strategy changes
 *   - Visit-counting / first-seen semantics evolve
 *
 * It depends on the stable auth + httpClient layers underneath.
 */

const { getToken, invalidateToken, isConfigured } = require('./auth');
const { sfPatch }                                 = require('./httpClient');
const { SalesforceError }                         = require('../../errors');

/**
 * Upserts a Site_Visitor__c record keyed by the Google `sub` (uid).
 *
 *   PATCH /sobjects/Site_Visitor__c/Google_UID__c/{uid}
 *
 * The External-ID upsert pattern is idempotent — Salesforce creates the
 * record if no match is found, otherwise updates the existing one. Same
 * uid signing in 50 times → still exactly one record.
 *
 * Inputs:
 *   uid          (string)  Google sub claim — partition key
 *   email        (string)
 *   name         (string)
 *   firstSeenAt  (number, epoch-ms or null)
 *   lastSeenAt   (number, epoch-ms or null)
 *   visitCount   (number)
 *
 * Returns: { id, created } or { skipped: true } when SF auth isn't
 * configured locally. Never throws unexpectedly — Cloud Run sign-in must
 * not fail just because Salesforce is unreachable.
 */
async function upsertSiteVisitor({ uid, email, name, firstSeenAt, lastSeenAt, visitCount }, retry = true) {
  if (!isConfigured()) {
    console.log('[salesforce] SF not configured — skipping Site_Visitor upsert');
    return { skipped: true };
  }
  if (!uid) {
    throw new SalesforceError('upsertSiteVisitor requires a uid');
  }

  const { accessToken, instanceUrl } = await getToken();

  const payload = {
    Email__c:        email || null,
    Name__c:         name  || null,
    Last_Seen__c:    lastSeenAt  ? new Date(lastSeenAt).toISOString()  : new Date().toISOString(),
    Visit_Count__c:  typeof visitCount === 'number' ? visitCount : 1,
  };
  // Only set First_Seen__c on first sight — never overwrite it on later upserts.
  // Salesforce upsert semantics: omitted fields are left untouched, so we send
  // it only when we know this is the first visit.
  if (firstSeenAt) {
    payload.First_Seen__c = new Date(firstSeenAt).toISOString();
  }

  const path = `Site_Visitor__c/Google_UID__c/${encodeURIComponent(uid)}`;
  const { status, data: result } = await sfPatch(instanceUrl, accessToken, path, payload);

  if (status === 401 && retry) {
    invalidateToken();
    return upsertSiteVisitor(
      { uid, email, name, firstSeenAt, lastSeenAt, visitCount },
      false
    );
  }

  // 201 Created (new) or 204 No Content (updated existing) are both success.
  if (status === 201) {
    console.log(`[salesforce] Site_Visitor__c created for uid=${uid} (id=${result.id})`);
    return { id: result.id, created: true };
  }
  if (status === 204 || status === 200) {
    console.log(`[salesforce] Site_Visitor__c updated for uid=${uid}`);
    return { id: null, created: false };
  }

  const msg = Array.isArray(result) ? result[0]?.message : JSON.stringify(result);
  throw new SalesforceError(`Site_Visitor upsert failed (HTTP ${status})`, msg);
}

module.exports = { upsertSiteVisitor };
