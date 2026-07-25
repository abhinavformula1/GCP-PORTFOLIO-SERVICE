'use strict';

const { assertDependencies } = require('../ports/assert');

function createRecruiterInquiryService(dependencies) {
  assertDependencies(dependencies, 'application.salesforce.inquiry', { getToken: 'function', invalidateToken: 'function', sfApexPost: 'function' });
  const { getToken, invalidateToken, sfApexPost } = dependencies;

/**
 * Recruiter inquiry domain operation — VOLATILE layer.
 *
 * Calls the custom Apex REST endpoint at /services/apexrest/inquiry.
 *
 * Why Apex REST (not sObject REST):
 *   - One HTTP call atomically creates Account + Recruiter_Inquiry__c + Task
 *   - Lookup-or-create-Account-by-domain logic lives in Salesforce, not here
 *   - Stable contract — if Salesforce field API names change, this client
 *     does not need to know
 *   - Duplicate Rule still fires (Apex catches it and surfaces a clean
 *     `alreadySubmitted` flag in the JSON envelope)
 *
 * This file is expected to change whenever:
 *   - The "Hire Me" form gains/renames/removes fields
 *   - The Apex REST contract evolves (new return fields, new validations)
 *   - We add new domain logic on top of recruiter inquiries
 *
 * It depends on the stable auth + httpClient layers underneath.
 *
 * Apex REST contract (mirrors RecruiterInquiryService.cls):
 *
 *   POST /services/apexrest/inquiry
 *   {
 *     "name":          "<full name>",
 *     "email":         "<work email>",
 *     "company":       "<company>",
 *     "message":       "<optional message ≤255 chars>",
 *     "transactionId": "<uuid for audit correlation>"
 *   }
 *
 *   → 201 { success:true,  alreadySubmitted:false, accountId, inquiryId, taskId }
 *   → 200 { success:true,  alreadySubmitted:true,  errorCode:"DUPLICATES_DETECTED" }
 *   → 400 { success:false, errorCode:"VALIDATION_ERROR" | "BAD_JSON" }
 *   → 502 { success:false, errorCode:"DML_ERROR" }
 *   → 500 { success:false, errorCode:"UNEXPECTED_ERROR" }
 */

const { SalesforceError }           = require('../../domain/errors');

/**
 * Creates a recruiter inquiry via the Apex REST endpoint.
 * Retries once on 401 (expired token).
 *
 * @param {object} data  { name, email, company, notes }
 *   `notes` from the route layer maps to the Apex `message` field, which
 *   lands in Recruiter_Inquiry__c.Description__c on the SF side.
 * @param {object} [opts]
 *   @param {string} opts.transactionId  Correlation ID stamped on the
 *     resulting Integration_Log__c row so the audit trail can be joined
 *     back to the originating /api/hire request.
 * @param {boolean} [retry=true]  Internal: token-refresh retry guard.
 *
 * @returns {Promise<{id: string|null, duplicate: boolean}>}
 *   `id` is the Recruiter_Inquiry__c Id on success, null on duplicate.
 *   `duplicate:true` means SF Duplicate Rule blocked the create —
 *   treat as soft-success in the UI.
 */
async function createInquiry(data, opts = {}, retry = true) {
  const { accessToken, instanceUrl } = await getToken();

  const payload = {
    name:          data.name,
    email:         data.email,
    company:       data.company,
    message:       data.notes || '',
    transactionId: opts.transactionId || '',
  };

  const meta = {
    apiName:       'Apex.RecruiterInquiryService.createInquiry',
    className:     'recruiterInquiry.js',
    transactionId: opts.transactionId || '',
  };

  const { status, data: result } = await sfApexPost(
    instanceUrl, accessToken, 'inquiry', payload, meta
  );

  // Token expired mid-flight → drop cache and retry once with a fresh token.
  if (status === 401 && retry) {
    invalidateToken();
    return createInquiry(data, opts, false);
  }

  // Soft-success: Apex caught a Duplicate Rule block and surfaced it as
  // a structured envelope. Translate to our existing { duplicate:true }
  // shape so the route layer's "alreadySubmitted" branch keeps working
  // without any change.
  if (result && result.alreadySubmitted === true) {
    console.log(`[salesforce] Duplicate inquiry blocked for ${data.email}`);
    return { id: null, duplicate: true };
  }

  // Happy path: 201 Created with full envelope.
  if (status === 201 && result && result.success === true) {
    console.log(
      `[salesforce] Recruiter inquiry created via Apex REST — ` +
      `inquiry=${result.inquiryId} account=${result.accountId} task=${result.taskId}`
    );
    return { id: result.inquiryId, duplicate: false };
  }

  // Anything else is a real failure. Apex puts a human-readable reason
  // in `message`; fall back to the raw envelope if it's missing.
  const reason = (result && result.message)
    || (result && result.errorCode)
    || JSON.stringify(result);
  throw new SalesforceError(
    `Apex REST createInquiry failed (HTTP ${status})`,
    reason
  );
}

  return { createInquiry };
}

module.exports = { createRecruiterInquiryService };
