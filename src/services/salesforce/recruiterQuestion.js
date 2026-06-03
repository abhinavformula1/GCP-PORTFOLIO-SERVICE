'use strict';

/**
 * Recruiter question domain operation — VOLATILE layer.
 *
 * Calls the custom Apex REST endpoint at /services/apexrest/question.
 *
 * Why Apex REST (not sObject REST):
 *   - The contract uses a CLIENT-supplied UUID as the External ID for
 *     idempotent UPSERT. Doing the upsert in Apex keeps validation,
 *     status defaulting, and audit-stamping in one transaction.
 *   - Lets us return a normalised envelope (`created` flag, current
 *     `status`, current `answer`) — independent of sObject schema.
 *
 * Why this module is interesting (vs siteVisitor.js / recruiterInquiry.js):
 *
 *   This is the FIRST endpoint in the codebase wrapped in retry-with-
 *   exponential-backoff. The reason is the use case: a recruiter has
 *   typed out a question and clicked Send. They will not click again if
 *   the network blips — so the server must absorb transient failures
 *   on their behalf. The 401 token-refresh retry pattern (used by
 *   siteVisitor / recruiterInquiry) is preserved on top.
 *
 * Idempotency contract:
 *
 *   The caller MUST supply `gcpQuestionId` (a UUID). It is used as the
 *   External ID on Recruiter_Question__c.GCP_Question_Id__c. The Apex
 *   endpoint UPSERTs by that key, so:
 *     - Same key, same payload    → no double-create (safe to retry)
 *     - Same key, edited payload  → in-place update
 *     - Different key             → new row
 *
 *   A retry storm at this layer therefore CANNOT create duplicate
 *   Recruiter_Question__c rows. That is the whole point of doing
 *   retries here at all.
 *
 * Apex REST contract (mirrors RecruiterQuestionService.cls):
 *
 *   POST /services/apexrest/question
 *   {
 *     "gcpQuestionId": "<client-generated UUID — REQUIRED>",
 *     "name":          "<recruiter name — optional>",
 *     "email":         "<recruiter email — REQUIRED>",
 *     "company":       "<company — optional>",
 *     "question":      "<question text — REQUIRED, ≤ 32K chars>",
 *     "transactionId": "<correlation UUID for audit log>"
 *   }
 *
 *   → 201 { success:true, created:true,  questionId, gcpQuestionId, status, answer }
 *   → 200 { success:true, created:false, questionId, gcpQuestionId, status, answer }
 *   → 400 { success:false, errorCode:"VALIDATION_ERROR" | "BAD_JSON" }
 *   → 502 { success:false, errorCode:"DML_ERROR", message }
 *   → 500 { success:false, errorCode:"UNEXPECTED_ERROR" }
 */

const { getToken, invalidateToken, isConfigured } = require('./auth');
const { sfApexPost }                              = require('./httpClient');
const { withRetry, isTransientSalesforceError }   = require('./retry');
const { SalesforceError }                         = require('../../errors');

/**
 * Upserts a Recruiter_Question__c via Apex REST.
 *
 * Two retry layers stack here:
 *
 *   1. Outer (this function): exponential backoff for TRANSIENT failures
 *      (network blips, 429, 5xx). Up to 3 attempts total.
 *   2. Inner (per attempt): one immediate retry on 401 with a fresh token,
 *      to handle the narrow window where the cached JWT expired between
 *      issue and use. This is auth recovery, not flake recovery.
 *
 * @param {object} data
 *   @param {string} data.gcpQuestionId  UUID — REQUIRED. External ID on SF.
 *   @param {string} data.email          REQUIRED.
 *   @param {string} data.question       REQUIRED.
 *   @param {string} [data.name]
 *   @param {string} [data.company]
 * @param {object} [opts]
 *   @param {string} [opts.transactionId] Correlation ID for Integration_Log__c.
 *
 * @returns {Promise<{
 *   skipped?: boolean,
 *   id: string|null,
 *   gcpQuestionId: string,
 *   created: boolean,
 *   status: string|null,
 *   answer: string|null
 * }>}
 */
async function upsertQuestion(data, opts = {}) {
  if (!isConfigured()) {
    console.log('[salesforce] SF not configured — skipping Recruiter_Question upsert');
    return {
      skipped:       true,
      id:            null,
      gcpQuestionId: data.gcpQuestionId,
      created:       false,
      status:        null,
      answer:        null,
    };
  }
  if (!data || !data.gcpQuestionId) {
    throw new SalesforceError('upsertQuestion requires data.gcpQuestionId');
  }

  // The retried operation. Resolves on success, throws on permanent failure
  // OR transient failure (which the outer withRetry will then classify and
  // either retry-with-backoff or rethrow on exhaustion).
  const attempt = (allowTokenRetry) => async () => {
    const { accessToken, instanceUrl } = await getToken();

    const payload = {
      gcpQuestionId: data.gcpQuestionId,
      name:          data.name    || '',
      email:         data.email,
      company:       data.company || '',
      question:      data.question,
      transactionId: opts.transactionId || '',
    };

    const meta = {
      apiName:       'Apex.RecruiterQuestionService.upsertQuestion',
      className:     'recruiterQuestion.js',
      transactionId: opts.transactionId || '',
    };

    const { status, data: result } = await sfApexPost(
      instanceUrl, accessToken, 'question', payload, meta
    );

    // Token expired mid-flight: clear cache and try ONCE more with a fresh
    // token. This is independent of the transient-failure retry loop —
    // 401s are an auth race, not a flake.
    if (status === 401 && allowTokenRetry) {
      invalidateToken();
      return attempt(false)();
    }

    // Happy path: 201 (created) or 200 (updated)
    if ((status === 201 || status === 200) && result && result.success === true) {
      console.log(
        `[salesforce] Recruiter_Question__c ${result.created ? 'created' : 'updated'} ` +
        `(id=${result.questionId} gcpId=${result.gcpQuestionId})`
      );
      return {
        id:            result.questionId,
        gcpQuestionId: result.gcpQuestionId,
        created:       !!result.created,
        status:        result.status || null,
        answer:        result.answer || null,
      };
    }

    // Anything else is a failure. Build a SalesforceError whose .detail
    // includes "HTTP <status>" so the retry predicate can classify it.
    const reason = (result && result.message)
      || (result && result.errorCode)
      || JSON.stringify(result);
    throw new SalesforceError(
      `Apex REST upsertQuestion failed (HTTP ${status})`,
      reason
    );
  };

  return withRetry(attempt(true), {
    label:       'upsertQuestion',
    attempts:    3,
    baseMs:      200,
    factor:      3,
    jitterMs:    100,
    shouldRetry: isTransientSalesforceError,
  });
}

module.exports = { upsertQuestion };
