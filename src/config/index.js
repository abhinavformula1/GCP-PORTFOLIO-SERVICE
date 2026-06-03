'use strict';

/**
 * Centralised application configuration.
 *
 * All process.env reads happen here — nowhere else in the codebase.
 * This means:
 *   - One place to audit what env vars the app needs
 *   - Easy to mock in tests
 *   - Fails fast at startup if a required var is missing
 */

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = 'MISSING_ENV';
    err.isOperational = true;
    err.statusCode = 503;
    throw err;
  }
  return value;
}

const config = {
  server: {
    port: parseInt(process.env.PORT || '8080', 10),
    env:  process.env.NODE_ENV || 'development',
  },

  salesforce: {
    get clientId()   { return requireEnv('SF_CLIENT_ID'); },
    get username()   { return requireEnv('SF_USERNAME'); },
    get privateKey() { return requireEnv('SF_PRIVATE_KEY').replace(/\\n/g, '\n'); },
    loginUrl:        process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    apiVersion:      process.env.SF_API_VERSION || 'v60.0',
  },

  rateLimit: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max:      10,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
  },

  google: {
    // Required to verify Google ID tokens server-side. Must match the
    // OAuth Client ID used by the frontend's Google Sign-In button.
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  // ── Contact-reveal policy ──────────────────────────────────────────
  // The portfolio masks the phone number by default. When a viewer signs
  // in with Google, the server checks whether their verified email belongs
  // to an allow-listed organisation and, if so, returns the unmasked phone
  // number alongside the rest of the session payload.
  //
  // Trust model:
  //   - Email is read from a Google-signed ID token (we cannot forge it).
  //   - The phone number itself is never present in HTML source — clients
  //     that don't prove allow-listed identity never see it.
  //   - This is identity-aware authorisation, the same pattern used by
  //     Google IAP / Cloud Endpoints (audience claim → policy decision).
  contactPolicy: {
    // Comma-separated list of trusted email domains. Override via env in
    // production. Defaults are the only two orgs the portfolio targets.
    //
    // Nullish coalescing (??) — not || — so that explicitly setting the
    // env var to '' is honoured as a "deny all" override rather than
    // silently falling back to the defaults.
    allowedDomains: (process.env.CONTACT_ALLOWED_DOMAINS ?? 'google.com,salesforce.com')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Real phone number — never inlined in HTML. Falls back to a sentinel
    // so the policy remains testable in dev without leaking real PII.
    privatePhone: process.env.PRIVATE_PHONE || '+91 XXXX XXX XXX',
  },

  firestore: {
    // Optional override — defaults to Firestore Native in the GCP project
    // tied to the runtime service account.
    projectId:  process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  },

  // ── Salesforce → GCP callback secret ───────────────────────────────
  // The Apex trigger on Recommendation__c calls back into Cloud Run via
  // a Named Credential when I post a reply. Cloud Run authenticates that
  // call by comparing the X-SF-Callback-Secret header to this value.
  //
  // Setup:
  //   1. Generate once:   openssl rand -hex 32
  //   2. Set on Cloud Run as SF_CALLBACK_SECRET
  //   3. Set the SAME value on the Salesforce Named Credential's custom
  //      header. The trigger sends it on every callout.
  //
  // If unset → the callback handler refuses every request (locked by default).
  sfCallback: {
    secret: process.env.SF_CALLBACK_SECRET || '',
  },
};

module.exports = config;
