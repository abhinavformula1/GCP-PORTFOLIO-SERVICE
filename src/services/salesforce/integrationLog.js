'use strict';

/**
 * Integration_Log__c writer — observability inside Salesforce.
 *
 * Every outbound Salesforce REST API call (create, upsert, …) is mirrored
 * to a Salesforce record so admins can:
 *   - Build SOQL reports / dashboards on integration health
 *   - Trace a single Recruiter_Inquiry__c back to the exact request that
 *     created it (correlation via Transaction_Id__c)
 *   - Inspect the literal HTTP status + response body the platform sent
 *     us, including DUPLICATES_DETECTED envelopes
 *
 * Design contract (must hold under all conditions):
 *   1. NEVER throws — failures here MUST NOT break the parent operation
 *   2. NEVER recurses — uses `skipLogging:true` so its own writes don't
 *      try to log themselves
 *   3. Bounded — every field is truncated to fit Salesforce storage limits
 *      so a giant response body can't trip STRING_TOO_LONG
 *   4. Fire-and-forget at the call site — the caller doesn't await us
 */

const { getToken }   = require('./auth');
const { sfRequest }  = require('./httpClient');

// Source-of-truth for SF field caps. If the schema changes (e.g. Response_Body__c
// gets bumped to 65,536), update HERE — every call site picks it up.
const LIMITS = {
  endpoint:        255,
  apiName:         255,
  className:       255,
  responseStatus:  255,
  transactionId:   255,
  requestBody:     131072,  // Long Text Area max for Request_Body__c
  responseBody:    32768,   // Long Text Area max for Response_Body__c
};

function truncate(value, max) {
  const s = value == null ? '' : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Best-effort write of a single Integration_Log__c row. Always resolves —
 * never rejects. Errors are swallowed and logged to console so the parent
 * SF operation stays unaffected.
 */
async function writeLog(entry) {
  try {
    const { accessToken, instanceUrl } = await getToken();

    const payload = {
      API_Endpoint__c:         truncate(entry.endpoint,             LIMITS.endpoint),
      API_Name__c:             truncate(entry.apiName,              LIMITS.apiName),
      Class_Name__c:           truncate(entry.className,            LIMITS.className),
      Request_Body__c:         truncate(entry.requestBody,          LIMITS.requestBody),
      Response_Body__c:        truncate(entry.responseBody,         LIMITS.responseBody),
      Response_Status_Code__c: truncate(entry.responseStatus,       LIMITS.responseStatus),
      Transaction_Id__c:       truncate(entry.transactionId,        LIMITS.transactionId),
    };

    // skipLogging: true is the recursion guard — Integration_Log__c writes
    // are NOT themselves logged, otherwise a single hire submit would
    // create infinite log rows.
    await sfRequest(
      'POST',
      instanceUrl,
      accessToken,
      'Integration_Log__c',
      payload,
      { skipLogging: true }
    );
  } catch (err) {
    // Never let logging break the parent. Surface to Cloud Logging only.
    console.error('[integrationLog] Failed to write Integration_Log__c (non-fatal):', err.message);
  }
}

module.exports = { writeLog };
