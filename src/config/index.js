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

function normalizeOriginUrl(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    return new URL(raw).origin;
  } catch (_) {
    return fallback;
  }
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

  admin: {
    // Comma-separated list of Google-authenticated editor emails allowed to
    // publish System Design content. Empty means locked down by default.
    allowedEmails: (process.env.ADMIN_ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    // Local-only CMS preview mode for UX work. This is ignored in production
    // and on Cloud Run even if the env var is accidentally set there.
    localPreview: process.env.ADMIN_LOCAL_PREVIEW === 'true'
      && (process.env.NODE_ENV || 'development') !== 'production'
      && !process.env.K_SERVICE,
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
    // Optional strategic company domains. The policy already allows company
    // email domains by default; this list is kept for explicit tracking.
    allowedDomains: (process.env.CONTACT_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Personal/public domains are blocked by default. Add exact email
    // exceptions below for trusted people using personal accounts.
    personalDomains: (process.env.CONTACT_PERSONAL_DOMAINS ?? 'gmail.com,yahoo.com,outlook.com,hotmail.com,icloud.com,proton.me,aol.com,live.com,msn.com')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    allowedEmails: (process.env.CONTACT_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    blockedDomains: (process.env.CONTACT_BLOCKED_DOMAINS ?? '')
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
  // the SF Named Credential `Portfolio_Service` when I post a reply. The
  // linked External Credential `GCP` sends the secret in the X-API-Key
  // header on every callout — Cloud Run authenticates by constant-time
  // compare against this value.
  //
  // Setup:
  //   1. Copy the existing X-API-Key value off the SF External
  //      Credential `GCP` → Custom Headers → X-API-Key.
  //   2. Set it on Cloud Run as SF_CALLBACK_SECRET.
  //   (Both sides MUST hold the exact same hex string.)
  //
  // If unset → the callback handler refuses every request (locked by default).
  sfCallback: {
    secret: process.env.SF_CALLBACK_SECRET || '',
  },

  // ── Billing / Subscriptions (Stripe) ─────────────────────────────────────────
  // Optional in dev. In production, set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
  stripe: {
    secretKey:     process.env.STRIPE_SECRET_KEY || '',
    // Public key used by Stripe.js (Embedded Checkout / Payment Element).
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    // Price IDs created in Stripe Dashboard (Products → Prices).
    // Used by /api/billing/checkout-session when priceId isn't provided.
    priceMonthly:  process.env.STRIPE_PRICE_MONTHLY || '',
    priceYearly:   process.env.STRIPE_PRICE_YEARLY || '',
    // Public URL of the site (used for success/cancel redirects).
    siteUrl:       normalizeOriginUrl(process.env.SITE_URL, 'http://localhost:8080'),
  },

  internal: {
    // Used to sign internal-only URLs (e.g. premium PDF print pages for Puppeteer).
    // In production, set INTERNAL_REQUEST_SECRET.
    requestSecret: process.env.INTERNAL_REQUEST_SECRET
      || (process.env.ADMIN_LOCAL_PREVIEW === 'true' ? 'local-dev-internal-secret' : ''),
  },
};

module.exports = config;
