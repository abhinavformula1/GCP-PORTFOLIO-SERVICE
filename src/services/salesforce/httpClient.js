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
 * @param {'GET'|'POST'|'PATCH'|'DELETE'} method
 * @param {string} instanceUrl    e.g. https://orgfarm-xxx.my.salesforce.com
 * @param {string} accessToken    Bearer token from auth.js
 * @param {string} sobjectPath    e.g. "Site_Visitor__c/Google_UID__c/abc"
 * @param {object} [payload]      Optional JSON body
 */
function sfRequest(method, instanceUrl, accessToken, sobjectPath, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const url  = new URL(
    `/services/data/${config.salesforce.apiVersion}/sobjects/${sobjectPath}`,
    instanceUrl
  );

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
          if (!raw) return resolve({ status: res.statusCode, data: {} });
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch (e) {
            reject(new SalesforceError(`Failed to parse SF API response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new SalesforceError(`SF network error: ${e.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

const sfPost  = (instanceUrl, accessToken, path, payload) =>
  sfRequest('POST',  instanceUrl, accessToken, path, payload);
const sfPatch = (instanceUrl, accessToken, path, payload) =>
  sfRequest('PATCH', instanceUrl, accessToken, path, payload);

module.exports = { sfRequest, sfPost, sfPatch };
