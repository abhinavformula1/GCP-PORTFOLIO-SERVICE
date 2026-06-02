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

// ── Salesforce REST helper ────────────────────────────────────────────────────
//
// Generic JSON request to a /sobjects/... endpoint. Used for both POST (create)
// and PATCH (External-ID upsert). Returns { status, data } where data is the
// parsed JSON body (or {} for empty 204 responses).
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

/**
 * Upserts a Site_Visitor__c record keyed by the Google `sub` (uid).
 *
 *   PATCH /sobjects/Site_Visitor__c/Google_UID__c/{uid}
 *
 * The External-ID upsert pattern is idempotent — Salesforce creates the
 * record if no match is found, otherwise updates the existing one. Same
 * uid signing in 50 times → still exactly one record.
 *
 * Inputs:
 *   uid          (string)  Google sub claim — partition key
 *   email        (string)
 *   name         (string)
 *   firstSeenAt  (number, epoch-ms or null)
 *   lastSeenAt   (number, epoch-ms or null)
 *   visitCount   (number)
 *
 * Returns: { id, created } or { skipped: true } when SF auth isn't
 * configured locally. Never throws — Cloud Run sign-in must not fail
 * just because Salesforce is unreachable.
 */
async function upsertSiteVisitor({ uid, email, name, firstSeenAt, lastSeenAt, visitCount }, retry = true) {
  if (!isConfigured()) {
    console.log('[salesforce] SF not configured — skipping Site_Visitor upsert');
    return { skipped: true };
  }
  if (!uid) {
    throw new SalesforceError('upsertSiteVisitor requires a uid');
  }

  const { accessToken, instanceUrl } = await getToken();

  const payload = {
    Email__c:        email || null,
    Name__c:         name  || null,
    Last_Seen__c:    lastSeenAt  ? new Date(lastSeenAt).toISOString()  : new Date().toISOString(),
    Visit_Count__c:  typeof visitCount === 'number' ? visitCount : 1,
  };
  // Only set First_Seen__c on first sight — never overwrite it on later upserts.
  // Salesforce upsert semantics: omitted fields are left untouched, so we send
  // it only when we know this is the first visit.
  if (firstSeenAt) {
    payload.First_Seen__c = new Date(firstSeenAt).toISOString();
  }

  const path = `Site_Visitor__c/Google_UID__c/${encodeURIComponent(uid)}`;
  const { status, data: result } = await sfPatch(instanceUrl, accessToken, path, payload);

  if (status === 401 && retry) {
    _tokenCache = null;
    return upsertSiteVisitor(
      { uid, email, name, firstSeenAt, lastSeenAt, visitCount },
      false
    );
  }

  // 201 Created (new) or 204 No Content (updated existing) are both success.
  if (status === 201) {
    console.log(`[salesforce] Site_Visitor__c created for uid=${uid} (id=${result.id})`);
    return { id: result.id, created: true };
  }
  if (status === 204 || status === 200) {
    console.log(`[salesforce] Site_Visitor__c updated for uid=${uid}`);
    return { id: null, created: false };
  }

  const msg = Array.isArray(result) ? result[0]?.message : JSON.stringify(result);
  throw new SalesforceError(`Site_Visitor upsert failed (HTTP ${status})`, msg);
}

// Lightweight check — used by routes to decide whether to even try SF.
// Reads raw env (not the config getters, which throw on missing values).
function isConfigured() {
  return !!(
    process.env.SF_CLIENT_ID &&
    process.env.SF_USERNAME &&
    process.env.SF_PRIVATE_KEY
  );
}

module.exports = { createInquiry, upsertSiteVisitor, isConfigured };
