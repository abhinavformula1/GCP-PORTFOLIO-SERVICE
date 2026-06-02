'use strict';

/**
 * Recruiter_Inquiry__c domain operation — VOLATILE layer.
 *
 * This file is expected to change whenever:
 *   - The "Hire Me" form gains/renames/removes fields
 *   - Validation/duplicate rules in Salesforce change behaviour
 *   - We add new domain logic on top of recruiter inquiries
 *
 * It depends on the stable auth + httpClient layers underneath.
 *
 * Fields on Recruiter_Inquiry__c:
 *   Full_Name__c       Text(255)  required
 *   Work_Email__c      Email      required
 *   Company_Name__c    Text(255)
 *   Description__c     Text Area  (role, contract type, urgency, slot notes)
 */

const { getToken, invalidateToken } = require('./auth');
const { sfPost }                    = require('./httpClient');
const { SalesforceError }           = require('../../errors');

/**
 * Creates a Recruiter_Inquiry__c record in Salesforce.
 * Retries once on 401 (expired token).
 *
 * @param {object} data  { name, email, company, notes }
 * @param {object} [opts]
 *   @param {string} opts.transactionId  Correlation ID stamped on the
 *     resulting Integration_Log__c row so the audit trail can be joined
 *     back to the originating /api/hire request.
 * @param {boolean} [retry=true]  Internal: token-refresh retry guard.
 */
async function createInquiry(data, opts = {}, retry = true) {
  const { accessToken, instanceUrl } = await getToken();

  const payload = {
    Full_Name__c:    data.name,
    Work_Email__c:   data.email,
    Company_Name__c: data.company,
    Description__c:  data.notes || '',
  };

  const meta = {
    apiName:       'Recruiter_Inquiry__c.create',
    className:     'recruiterInquiry.js',
    transactionId: opts.transactionId || '',
  };

  const { status, data: result } = await sfPost(
    instanceUrl, accessToken, 'Recruiter_Inquiry__c', payload, meta
  );

  if (status === 401 && retry) {
    invalidateToken();
    return createInquiry(data, opts, false);
  }

  // Salesforce Duplicate Rule blocked the create — treat as a soft success
  // ("we've already heard from you"), not an error. The route layer turns
  // this into a friendly "alreadySubmitted: true" response to the caller.
  if (status === 400 && Array.isArray(result)) {
    const isDuplicate = result.some((e) => e?.errorCode === 'DUPLICATES_DETECTED');
    if (isDuplicate) {
      console.log(`[salesforce] Duplicate inquiry blocked for ${data.email}`);
      return { id: null, duplicate: true };
    }
  }

  if (status !== 201) {
    const msg = Array.isArray(result) ? result[0]?.message : JSON.stringify(result);
    throw new SalesforceError(`Record creation failed (HTTP ${status})`, msg);
  }

  console.log(`[salesforce] Recruiter_Inquiry__c created: ${result.id}`);
  return { id: result.id, duplicate: false };
}

module.exports = { createInquiry };
