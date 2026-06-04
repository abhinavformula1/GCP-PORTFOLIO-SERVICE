'use strict';

/**
 * Recommendation domain operation — VOLATILE layer.
 *
 * Calls the custom Apex REST endpoint at /services/apexrest/testimonial.
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
 *   Testimonial__c.Google_UID__c. Same person re-submitting → in-place
 *   UPDATE, never a duplicate. This is the same pattern as siteVisitor.js
 *   but with a different external-id source (Google sub vs uid).
 *
 * Apex REST contract (mirrors TestimonialService.cls — note: the SF object
 * is named Testimonial__c to avoid collision with the standard `Recommendation`
 * sObject Salesforce ships for Einstein Next Best Action; the user-facing
 * copy on the portfolio page still says "Recommendations"):
 *
 *   POST /services/apexrest/testimonial
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
 *   → 201 { success:true, created:true,  testimonialId, googleUid }
 *   → 200 { success:true, created:false, testimonialId, googleUid }
 *   → 400 { success:false, errorCode:"VALIDATION_ERROR" | "BAD_JSON" }
 *   → 502 { success:false, errorCode:"DML_ERROR" }
 *   → 500 { success:false, errorCode:"UNEXPECTED_ERROR" }
 */

const { getToken, invalidateToken, isConfigured } = require('./auth');
const { sfApexPost, sfApexDelete }                = require('./httpClient');
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
      apiName:       'Apex.TestimonialService.upsertTestimonial',
      className:     'recommendation.js',
      transactionId: opts.transactionId || '',
    };

    const { status, data: result } = await sfApexPost(
      instanceUrl, accessToken, 'testimonial', payload, meta
    );

    if (status === 401 && allowTokenRetry) {
      invalidateToken();
      return attempt(false)();
    }

    if ((status === 201 || status === 200) && result && result.success === true) {
      console.log(
        `[salesforce] Testimonial__c ${result.created ? 'created' : 'updated'} ` +
        `(id=${result.testimonialId} googleUid=${result.googleUid})`
      );
      return {
        id:        result.testimonialId,
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

/**
 * Soft-delete a recommendation in Salesforce.
 *
 * Apex semantics (mirrors `TestimonialService.deleteTestimonial` —
 * see the Apex deliverable in the conversation):
 *   - Locates the row via `Google_UID__c` (External Id) — same key the
 *     upsert uses, so the delete is idempotent and can't hit the wrong
 *     record.
 *   - Sets `Status__c = 'Deleted'` rather than DELETE-ing the row, so
 *     the audit trail is preserved (replies the user posted, history
 *     of edits, related Integration_Log__c entries).
 *   - Cascade-clears `Reply__c` and `Replied_At__c` so the row no
 *     longer participates in the public read model even if a future
 *     bug accidentally surfaces it. The reply is part of the same
 *     "this exchange is gone" intent.
 *
 * Why we don't hard-delete: the recommender has the right to retract
 * their public recommendation, but Salesforce is also a CRM record of
 * "who said what and when" — we want that history preserved for the
 * org owner to review.
 *
 * Idempotency: same retry shape as upsertRecommendation. A 404 from SF
 * (the row never existed there — e.g. the original write failed and
 * the recruiter is deleting via a Firestore-only doc) is treated as a
 * silent no-op rather than an error, because the user-facing intent
 * (make the recommendation gone) is satisfied either way.
 *
 * @param {{ googleUid: string }} data
 * @param {object} [opts]
 *   @param {string} [opts.transactionId]
 * @returns {Promise<{ skipped?: boolean, deleted: boolean, googleUid: string }>}
 */
async function deleteRecommendation(data, opts = {}) {
  if (!isConfigured()) {
    console.log('[salesforce] SF not configured — skipping Recommendation delete');
    return {
      skipped:   true,
      deleted:   false,
      googleUid: data && data.googleUid,
    };
  }
  if (!data || !data.googleUid) {
    throw new SalesforceError('deleteRecommendation requires data.googleUid');
  }

  // googleUid is a fixed-shape Google `sub` claim (digits) so technically
  // safe to drop into a URL. We still encode it because (a) costs nothing
  // and (b) any future change to the claim format won't quietly become a
  // request-smuggling vector.
  const apexPath = `testimonial?googleUid=${encodeURIComponent(data.googleUid)}`;

  const attempt = (allowTokenRetry) => async () => {
    const { accessToken, instanceUrl } = await getToken();

    const meta = {
      apiName:       'Apex.TestimonialService.deleteTestimonial',
      className:     'recommendation.js',
      transactionId: opts.transactionId || '',
    };

    const { status, data: result } = await sfApexDelete(
      instanceUrl, accessToken, apexPath, meta
    );

    if (status === 401 && allowTokenRetry) {
      invalidateToken();
      return attempt(false)();
    }

    // 404: row didn't exist in SF. Treat as success — the user-facing
    // contract is "the recommendation is gone", and from their POV it
    // already was.
    if (status === 404) {
      console.log(
        `[salesforce] Testimonial__c not found for delete (googleUid=${data.googleUid}); treating as no-op`
      );
      return { deleted: false, googleUid: data.googleUid };
    }

    if ((status === 200 || status === 204) && (!result || result.success !== false)) {
      console.log(
        `[salesforce] Testimonial__c soft-deleted (googleUid=${data.googleUid})`
      );
      return { deleted: true, googleUid: data.googleUid };
    }

    const reason = (result && result.message)
      || (result && result.errorCode)
      || JSON.stringify(result || {});
    throw new SalesforceError(
      `Apex REST deleteRecommendation failed (HTTP ${status})`,
      reason
    );
  };

  return withRetry(attempt(true), {
    label:       'deleteRecommendation',
    attempts:    3,
    baseMs:      200,
    factor:      3,
    jitterMs:    100,
    shouldRetry: isTransientSalesforceError,
  });
}

module.exports = { upsertRecommendation, deleteRecommendation };
