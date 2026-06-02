'use strict';

/**
 * Salesforce HTTP transport — STABLE layer.
 *
 * Generic JSON request to a /services/data/<ver>/sobjects/... endpoint.
 * Used by every domain operation (createInquiry, upsertSiteVisitor, …).
 *
 * Layer above (auth.js) provides the access token and instance URL.
 * Layer below is plain Node's https module.
 *
 * This file rarely changes — it implements the Salesforce REST envelope
 * (URL pattern, Bearer header, JSON body) and would only be edited if
 * Salesforce changed its REST conventions.
 */

const https  = require('https');
const config = require('../../config');
const { SalesforceError } = require('../../errors');

/**
 * Generic JSON request. Returns { status, data } where data is the
 * parsed JSON body (or {} for empty 204 responses).
 *
 * Side-effect: fires-and-forgets a write to Integration_Log__c via
 * `integrationLog.writeLog` after every response, unless:
 *   - meta.skipLogging is true (used by integrationLog itself to avoid
 *     infinite recursion — its own writes can't be logged)
 *   - the request target IS Integration_Log__c (defence-in-depth, so even
 *     if a caller forgets skipLogging the recursion still terminates)
 *
 * The log call is dispatched on a microtask AFTER the response promise
 * resolves, so callers never wait on the audit write. Errors there are
 * swallowed by integrationLog's own try/catch.
 *
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} instanceUrl    e.g. https://orgfarm-xxx.my.salesforce.com
 * @param {string} accessToken    Bearer token from auth.js
 * @param {string} sobjectPath    e.g. "Site_Visitor__c/Google_UID__c/abc"
 * @param {object} [payload]      Optional JSON body
 * @param {object} [meta]         Optional audit-log metadata
 *   @param {string} meta.apiName       e.g. "Recruiter_Inquiry__c.create"
 *   @param {string} meta.className     e.g. "recruiterInquiry.js"
 *   @param {string} meta.transactionId UUID per /api request — correlation key
 *   @param {boolean} meta.skipLogging  set by integrationLog to break recursion
 */
function sfRequest(method, instanceUrl, accessToken, sobjectPath, payload, meta) {
  const body = payload ? JSON.stringify(payload) : '';
  const fullPath = `/services/data/${config.salesforce.apiVersion}/sobjects/${sobjectPath}`;
  const url  = new URL(fullPath, instanceUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method,
        headers:  {
          'Authorization':  `Bearer ${accessToken}`,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          // 204 No Content → upsert updated existing record, no body
          const status = res.statusCode;
          let data = {};
          let parseErr = null;
          if (raw) {
            try { data = JSON.parse(raw); }
            catch (e) { parseErr = e; }
          }

          // Fire-and-forget audit log. Recursion guard:
          //   - skipLogging:true → caller (integrationLog) opted out
          //   - sobjectPath starts with Integration_Log__c → defence-in-depth
          const skip = (meta && meta.skipLogging)
            || sobjectPath.startsWith('Integration_Log__c');
          if (!skip) {
            // Lazy require breaks the integrationLog ⇄ httpClient cycle —
            // by the time this fires, both modules have finished loading.
            const { writeLog } = require('./integrationLog');
            // Detach from the caller's await chain so audit latency never
            // affects the response. .catch is for belt-and-braces; writeLog
            // already swallows errors internally.
            Promise.resolve().then(() => writeLog({
              apiName:        (meta && meta.apiName)   || `${method} ${sobjectPath}`,
              className:      (meta && meta.className) || 'httpClient',
              transactionId:  (meta && meta.transactionId) || '',
              endpoint:       fullPath,
              requestBody:    body,
              responseStatus: String(status),
              responseBody:   raw,
            })).catch(() => {});
          }

          if (parseErr) {
            return reject(new SalesforceError(`Failed to parse SF API response: ${parseErr.message}`));
          }
          resolve({ status, data });
        });
      }
    );
    req.on('error', (e) => reject(new SalesforceError(`SF network error: ${e.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

const sfPost  = (instanceUrl, accessToken, path, payload, meta) =>
  sfRequest('POST',  instanceUrl, accessToken, path, payload, meta);
const sfPatch = (instanceUrl, accessToken, path, payload, meta) =>
  sfRequest('PATCH', instanceUrl, accessToken, path, payload, meta);

module.exports = { sfRequest, sfPost, sfPatch };
