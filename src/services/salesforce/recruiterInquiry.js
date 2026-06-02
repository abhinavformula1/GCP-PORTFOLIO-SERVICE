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
 */
async function createInquiry(data, retry = true) {
  const { accessToken, instanceUrl } = await getToken();

  const payload = {
    Full_Name__c:    data.name,
    Work_Email__c:   data.email,
    Company_Name__c: data.company,
    Description__c:  data.notes || '',
  };

  const { status, data: result } = await sfPost(
    instanceUrl, accessToken, 'Recruiter_Inquiry__c', payload
  );

  if (status === 401 && retry) {
    invalidateToken();
    return createInquiry(data, false);
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
