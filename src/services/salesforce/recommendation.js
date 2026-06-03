'use strict';

/**
 * Recommendation domain operation — VOLATILE layer.
 *
 * Calls the custom Apex REST endpoint at /services/apexrest/recommendation.
 *
 * Dual-write context:
 *
 *   The route handler writes to BOTH Firestore (for instant public visibility)
 *   AND Salesforce (system of record). The two writes are independent —
 *   if Firestore succeeds and SF transiently fails, the recommendation is
 *   visible to the recruiter immediately, while the SF write is retried
 *   underneath via the withRetry helper. SF eventually catches up.
 *
 *   That's deliberately the trade-off we want for a public-facing recommendation
 *   board: a brief window where the page is "ahead of" the system of record
 *   is fine; a recruiter staring at a spinner because Salesforce had a 502
 *   is not.
 *
 * Idempotency:
 *
 *   The submitter's Google uid is the External ID on
 *   Recommendation__c.Google_UID__c. Same person re-submitting → in-place
 *   UPDATE, never a duplicate. This is the same pattern as siteVisitor.js
 *   but with a different external-id source (Google sub vs uid).
 *
 * Apex REST contract (mirrors RecommendationService.cls):
 *
 *   POST /services/apexrest/recommendation
 *   {
 *     "googleUid":     "<google sub — REQUIRED, External Id>",
 *     "name":          "<full name>",
 *     "email":         "<verified Google email>",
 *     "company":       "<email domain or hd claim>",
 *     "avatarUrl":     "<picture claim, optional>",
 *     "text":          "<recommendation text — REQUIRED, ≤ 5000>",
 *     "transactionId": "<correlation UUID>"
 *   }
 *
 *   → 201 { success:true, created:true,  recommendationId, googleUid }
 *   → 200 { success:true, created:false, recommendationId, googleUid }
 *   → 400 { success:false, errorCode:"VALIDATION_ERROR" | "BAD_JSON" }
 *   → 502 { success:false, errorCode:"DML_ERROR" }
 *   → 500 { success:false, errorCode:"UNEXPECTED_ERROR" }
 */

const { getToken, invalidateToken, isConfigured } = require('./auth');
const { sfApexPost }                              = require('./httpClient');
const { withRetry, isTransientSalesforceError }   = require('./retry');
const { SalesforceError }                         = require('../../errors');

/**
 * Upsert a recommendation in Salesforce. Two retry layers (same shape as
 * recruiterQuestion):
 *   - Outer: exponential backoff on transient failures (network, 429, 5xx)
 *   - Inner: one immediate retry on 401 with a fresh token
 *
 * @param {object} data
 *   @param {string} data.googleUid  REQUIRED — External Id on SF.
 *   @param {string} data.email      REQUIRED.
 *   @param {string} data.text       REQUIRED.
 *   @param {string} [data.name]
 *   @param {string} [data.company]
 *   @param {string} [data.avatarUrl]
 * @param {object} [opts]
 *   @param {string} [opts.transactionId] Correlation ID for Integration_Log__c.
 * @returns {Promise<{ skipped?: boolean, id: string|null, googleUid: string, created: boolean }>}
 */
async function upsertRecommendation(data, opts = {}) {
  if (!isConfigured()) {
    console.log('[salesforce] SF not configured — skipping Recommendation upsert');
    return {
      skipped:   true,
      id:        null,
      googleUid: data.googleUid,
      created:   false,
    };
  }
  if (!data || !data.googleUid) {
    throw new SalesforceError('upsertRecommendation requires data.googleUid');
  }

  const attempt = (allowTokenRetry) => async () => {
    const { accessToken, instanceUrl } = await getToken();

    const payload = {
      googleUid:     data.googleUid,
      name:          data.name      || '',
      email:         data.email,
      company:       data.company   || '',
      avatarUrl:     data.avatarUrl || '',
      text:          data.text,
      transactionId: opts.transactionId || '',
    };

    const meta = {
      apiName:       'Apex.RecommendationService.upsertRecommendation',
      className:     'recommendation.js',
      transactionId: opts.transactionId || '',
    };

    const { status, data: result } = await sfApexPost(
      instanceUrl, accessToken, 'recommendation', payload, meta
    );

    if (status === 401 && allowTokenRetry) {
      invalidateToken();
      return attempt(false)();
    }

    if ((status === 201 || status === 200) && result && result.success === true) {
      console.log(
        `[salesforce] Recommendation__c ${result.created ? 'created' : 'updated'} ` +
        `(id=${result.recommendationId} googleUid=${result.googleUid})`
      );
      return {
        id:        result.recommendationId,
        googleUid: result.googleUid,
        created:   !!result.created,
      };
    }

    const reason = (result && result.message)
      || (result && result.errorCode)
      || JSON.stringify(result);
    throw new SalesforceError(
      `Apex REST upsertRecommendation failed (HTTP ${status})`,
      reason
    );
  };

  return withRetry(attempt(true), {
    label:       'upsertRecommendation',
    attempts:    3,
    baseMs:      200,
    factor:      3,
    jitterMs:    100,
    shouldRetry: isTransientSalesforceError,
  });
}

module.exports = { upsertRecommendation };
