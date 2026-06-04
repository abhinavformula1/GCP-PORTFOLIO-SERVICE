'use strict';

/**
 * Salesforce HTTP transport — STABLE layer.
 *
 * Generic JSON request to a Salesforce REST endpoint. Two URL families
 * are supported, both routed through the same logged transport:
 *
 *   sObject REST  → /services/data/<ver>/sobjects/<Object>     (sfPost / sfPatch)
 *   Apex  REST    → /services/apexrest/<your-path>             (sfApexPost)
 *
 * Layer above (auth.js) provides the access token and instance URL.
 * Layer below is plain Node's https module.
 *
 * This file rarely changes — it implements the Salesforce REST envelope
 * (Bearer header, JSON body, fire-and-forget audit log) and would only
 * be edited if Salesforce changed its REST conventions or we added a
 * new URL family (e.g. /services/data/<ver>/composite).
 */

const https  = require('https');
const config = require('../../config');
const { SalesforceError } = require('../../errors');

/**
 * Internal: send `body` to `fullPath` on `instanceUrl`, parse the response,
 * fire-and-forget an Integration_Log__c row, and resolve with { status, data }.
 *
 * `fullPath` is the absolute Salesforce path including `/services/...`.
 * The two public helper families (sObject + Apex REST) build it before
 * calling here, so this function is URL-family-agnostic.
 *
 * Side-effect: writes to Integration_Log__c via `integrationLog.writeLog`
 * after every response, unless:
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
 * @param {string} fullPath       Absolute path, e.g. "/services/data/v60.0/sobjects/Foo"
 * @param {object} [payload]      Optional JSON body
 * @param {object} [meta]         Optional audit-log metadata
 *   @param {string} meta.apiName       e.g. "Recruiter_Inquiry__c.create"
 *   @param {string} meta.className     e.g. "recruiterInquiry.js"
 *   @param {string} meta.transactionId UUID per /api request — correlation key
 *   @param {boolean} meta.skipLogging  set by integrationLog to break recursion
 */
function sfRawRequest(method, instanceUrl, accessToken, fullPath, payload, meta) {
  const body = payload ? JSON.stringify(payload) : '';
  const url  = new URL(fullPath, instanceUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        // Preserve the query string. Most sObject / Apex callers use
        // path-only URLs, but some (notably DELETE on /apexrest, where
        // the resource id is conventionally a query param rather than a
        // body field) need ?key=value to reach the org. `url.pathname`
        // alone drops it.
        path:     url.pathname + url.search,
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
          //   - fullPath contains Integration_Log__c → defence-in-depth
          const skip = (meta && meta.skipLogging)
            || fullPath.indexOf('/Integration_Log__c') !== -1;
          if (!skip) {
            // Lazy require breaks the integrationLog ⇄ httpClient cycle —
            // by the time this fires, both modules have finished loading.
            const { writeLog } = require('./integrationLog');
            // Detach from the caller's await chain so audit latency never
            // affects the response. .catch is for belt-and-braces; writeLog
            // already swallows errors internally.
            Promise.resolve().then(() => writeLog({
              apiName:        (meta && meta.apiName)   || `${method} ${fullPath}`,
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

// ── sObject REST family ──────────────────────────────────────────────────────
// /services/data/<ver>/sobjects/<sobjectPath>
//
// `sobjectPath` examples:
//   "Recruiter_Inquiry__c"
//   "Site_Visitor__c/Google_UID__c/<external-id>"
function sfRequest(method, instanceUrl, accessToken, sobjectPath, payload, meta) {
  const fullPath = `/services/data/${config.salesforce.apiVersion}/sobjects/${sobjectPath}`;
  return sfRawRequest(method, instanceUrl, accessToken, fullPath, payload, meta);
}

const sfPost  = (instanceUrl, accessToken, path, payload, meta) =>
  sfRequest('POST',  instanceUrl, accessToken, path, payload, meta);
const sfPatch = (instanceUrl, accessToken, path, payload, meta) =>
  sfRequest('PATCH', instanceUrl, accessToken, path, payload, meta);

// ── Apex REST family ─────────────────────────────────────────────────────────
// /services/apexrest/<apexPath>
//
// Used to call custom @RestResource(urlMapping='/...') Apex classes — gives
// us atomic multi-object writes and stable contracts independent of sObject
// schema. Same auth, same JSON envelope, same audit-log pipeline as sObject
// REST — only the URL prefix differs.
//
// `apexPath` example: "inquiry"  →  /services/apexrest/inquiry
function sfApexRequest(method, instanceUrl, accessToken, apexPath, payload, meta) {
  const trimmed  = String(apexPath || '').replace(/^\/+/, '');
  const fullPath = `/services/apexrest/${trimmed}`;
  return sfRawRequest(method, instanceUrl, accessToken, fullPath, payload, meta);
}

const sfApexPost = (instanceUrl, accessToken, path, payload, meta) =>
  sfApexRequest('POST', instanceUrl, accessToken, path, payload, meta);

// Apex DELETE — for resources where the operation is a soft/hard delete
// keyed by an external id passed as a query param (no body). Mirrors
// sfApexPost in shape so callers stay symmetrical.
const sfApexDelete = (instanceUrl, accessToken, path, meta) =>
  sfApexRequest('DELETE', instanceUrl, accessToken, path, null, meta);

module.exports = {
  sfRequest, sfPost, sfPatch,
  sfApexRequest, sfApexPost, sfApexDelete,
};
