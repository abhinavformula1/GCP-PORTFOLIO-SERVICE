'use strict';

const https  = require('https');
const config = require('../config');
const { SalesforceError, SalesforceAuthError } = require('../errors');

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
  const sign = require('crypto').createSign('RSA-SHA256');
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

// ── Salesforce REST POST ──────────────────────────────────────────────────────
function sfPost(instanceUrl, accessToken, sobjectPath, payload) {
  const body = JSON.stringify(payload);
  const url  = new URL(
    `/services/data/${config.salesforce.apiVersion}/sobjects/${sobjectPath}`,
    instanceUrl
  );

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path:     url.pathname,
        method:   'POST',
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
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw) });
          } catch (e) {
            reject(new SalesforceError(`Failed to parse SF API response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(new SalesforceError(`SF network error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Creates a Recruiter_Inquiry__c record in Salesforce.
 * Retries once on 401 (expired token).
 *
 * Fields on Recruiter_Inquiry__c:
 *   Full_Name__c       Text(255)  required
 *   Work_Email__c      Email      required
 *   Company_Name__c    Text(255)
 *   Description__c     Text Area  (role, contract type, urgency, slot notes)
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
    _tokenCache = null;
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
