'use strict';

/**
 * Salesforce auth — STABLE layer.
 *
 * Owns the JWT Bearer Token flow and the in-memory access-token cache.
 * This module almost never changes — it implements a fixed Salesforce
 * OAuth protocol (RFC 7523) and rarely needs edits unless the auth
 * mechanism itself is being changed.
 *
 * Public surface:
 *   getToken()         → { accessToken, instanceUrl, expiresAt }
 *   invalidateToken()  → drop the cached token (call on 401 retry)
 *   isConfigured()     → true if all required SF env vars are present
 */

const https  = require('https');
const crypto = require('crypto');
const { SalesforceError, SalesforceAuthError } = require('../../../domain/errors');

function createSalesforceAuth({ config }) {
if (!config || !config.salesforce) {
  throw new TypeError('salesforceAuth.config.salesforce is required');
}
// ── Token cache (in-memory, reused across requests) ───────────────────────────
let _tokenCache = null; // { accessToken, instanceUrl, expiresAt }
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ── JWT Bearer Token flow ─────────────────────────────────────────────────────
function buildJwt() {
  const { clientId, username, privateKey, loginUrl } = config.salesforce;
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: clientId,
    sub: username,
    aud: loginUrl,
    exp: now + 300,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  return `${signingInput}.${sign.sign(privateKey, 'base64url')}`;
}

function fetchAccessToken() {
  const { loginUrl } = config.salesforce;
  const jwt  = buildJwt();

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:  jwt,
  }).toString();

  const url = new URL('/services/oauth2/token', loginUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode !== 200 || data.error) {
              return reject(new SalesforceAuthError(
                `SF token error: ${data.error} — ${data.error_description}`
              ));
            }
            resolve({
              accessToken: data.access_token,
              instanceUrl: data.instance_url,
              expiresAt:   Date.now() + 60 * 60 * 1000,
            });
          } catch (e) {
            reject(new SalesforceError(`Failed to parse SF token response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new SalesforceError(`SF network error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// ── Token Cache ───────────────────────────────────────────────────────────────
async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt - Date.now() > TOKEN_BUFFER_MS) {
    return _tokenCache;
  }
  _tokenCache = await fetchAccessToken();
  return _tokenCache;
}

/**
 * Drop the cached token. Called by ops modules when Salesforce returns
 * 401 so the next call refetches a fresh token.
 */
function invalidateToken() {
  _tokenCache = null;
}

// ── Configuration check ───────────────────────────────────────────────────────
//
// Lightweight env-presence check used by routes (and ops modules) to
// decide whether to even try Salesforce. Reads raw env directly — does
// NOT go through the config getters (which throw on missing values).
function isConfigured() {
  return !!(config.salesforce.clientIdOptional
    && config.salesforce.usernameOptional
    && config.salesforce.privateKeyOptional);
}

  return Object.freeze({ getToken, invalidateToken, isConfigured });
}

module.exports = { createSalesforceAuth };
