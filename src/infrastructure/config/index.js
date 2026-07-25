'use strict';

/**
 * Centralised application configuration.
 *
 * All env reads happen here — nowhere else in the codebase.
 * This means:
 *   - One place to audit what env vars the app needs
 *   - Easy to mock in tests
 *   - Fails fast at startup if a required var is missing
 */

function requireEnv(env, name) {
  const value = env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = 'MISSING_ENV';
    err.isOperational = true;
    err.statusCode = 503;
    throw err;
  }
  return value;
}

function readEnv(env, name) {
  const direct = env[name];
  if (direct != null && String(direct).trim() !== '') return direct;
  // Tolerate accidental whitespace in .env keys (e.g. "FOO = bar").
  // Some dotenv injectors preserve the key verbatim; we fall back to the trimmed match.
  try {
    const match = Object.keys(env).find((k) => k && k.trim() === name);
    if (match) return env[match] || '';
  } catch (_) {}
  return '';
}

function normalizeHttpUrl(value, fallback, name, { originOnly = false, optional = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return optional ? '' : fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
    if (parsed.username || parsed.password) throw new Error('credentials are not allowed in URLs');
    return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, '');
  } catch (_) {
    throw configError(name || 'URL', 'must be an absolute HTTP(S) URL without embedded credentials');
  }
}

function configError(name, message) {
  const error = new Error(`Invalid configuration for ${name}: ${message}`);
  error.code = 'INVALID_CONFIG';
  return error;
}

function parseBoolean(value, fallback, name) {
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw configError(name, 'expected true or false');
}

function parsePort(value) {
  const raw = String(value == null || value === '' ? '8080' : value).trim();
  if (!/^\d+$/.test(raw)) throw configError('PORT', 'expected an integer from 0 to 65535');
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw configError('PORT', 'expected an integer from 0 to 65535');
  return port;
}

function parseNodeEnv(value) {
  const normalized = String(value || 'development').trim().toLowerCase();
  if (!['development', 'test', 'production'].includes(normalized)) {
    throw configError('NODE_ENV', 'expected development, test, or production');
  }
  return normalized;
}

function parseSalesforceApiVersion(value) {
  const normalized = String(value || 'v60.0').trim();
  if (!/^v\d{1,3}\.\d{1,2}$/.test(normalized)) {
    throw configError('SF_API_VERSION', 'expected syntax like v60.0');
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      deepFreeze(descriptor.value);
    }
  }
  return Object.freeze(value);
}

function validateConfig(config) {
  if (config.server.env === 'production') {
    const sf = config.salesforce;
    const sfCount = [sf.clientIdOptional, sf.usernameOptional, sf.privateKeyOptional].filter(Boolean).length;
    if (sfCount > 0 && sfCount < 3) throw configError('Salesforce credentials', 'must be configured as a complete set');
    const stripe = config.stripe;
    if (stripe.secretKey && !stripe.webhookSecret) throw configError('STRIPE_WEBHOOK_SECRET', 'required when STRIPE_SECRET_KEY is configured in production');
    if (!stripe.secretKey && [
      stripe.publishableKey,
      stripe.webhookSecret,
      stripe.priceMonthly,
      stripe.priceYearly,
    ].some(Boolean)) {
      throw configError('Stripe credentials', 'STRIPE_SECRET_KEY is required when other Stripe settings are configured');
    }
    if (config.langsmith.tracingEnabled && !config.langsmith.apiKey) {
      throw configError('LANGSMITH_API_KEY', 'required when LANGSMITH_TRACING is enabled');
    }
    if (config.meilisearch.apiKey && !config.meilisearch.host) {
      throw configError('MEILI_HOST', 'required when MEILI_API_KEY is configured');
    }
    if (config.admin.allowedEmails.length && !config.google.clientId) {
      throw configError('GOOGLE_CLIENT_ID', 'required when ADMIN_ALLOWED_EMAILS is configured');
    }
    if (!config.internal.requestSecret) {
      throw configError('INTERNAL_REQUEST_SECRET', 'required in production');
    }
  }
  return config;
}

function loadConfig(inputEnv = process.env) {
  const env = Object.assign({}, inputEnv);
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const isCloudRuntime = String(env.K_SERVICE || '').trim() !== '';
  const localPreviewRequested = parseBoolean(env.ADMIN_LOCAL_PREVIEW, false, 'ADMIN_LOCAL_PREVIEW');
  const localPreview = localPreviewRequested && nodeEnv !== 'production' && !isCloudRuntime;

  const config = {
  server: {
    port: parsePort(env.PORT),
    env: nodeEnv,
  },

  salesforce: {
    clientIdOptional: String(env.SF_CLIENT_ID || '').trim(),
    usernameOptional: String(env.SF_USERNAME || '').trim(),
    privateKeyOptional: String(env.SF_PRIVATE_KEY || '').trim(),
    get clientId()   { return requireEnv(env, 'SF_CLIENT_ID'); },
    get username()   { return requireEnv(env, 'SF_USERNAME'); },
    get privateKey() { return requireEnv(env, 'SF_PRIVATE_KEY').replace(/\\n/g, '\n'); },
    loginUrl: normalizeHttpUrl(env.SF_LOGIN_URL, 'https://login.salesforce.com', 'SF_LOGIN_URL', { originOnly: true }),
    apiVersion: parseSalesforceApiVersion(env.SF_API_VERSION),
  },

  rateLimit: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max:      10,
  },

  gemini: {
    apiKey: String(env.GEMINI_API_KEY || '').trim(),
  },

  tavily: {
    apiKey: String(readEnv(env, 'TAVILY_API_KEY') || '').trim(),
    baseUrl: normalizeHttpUrl(env.TAVILY_BASE_URL, 'https://api.tavily.com', 'TAVILY_BASE_URL'),
  },

  // ── Keyword search (BM25) backend ────────────────────────────────────────────
  // Optional. When configured, Atlas can run hybrid retrieval:
  //   vector (Firestore) + keyword (Meilisearch BM25) fused with RRF.
  meilisearch: {
    host: normalizeHttpUrl(env.MEILI_HOST, '', 'MEILI_HOST', { optional: true }),
    apiKey: String(env.MEILI_API_KEY || '').trim(),
    index: String(env.MEILI_INDEX || 'rag_chunks').trim(),
  },

  // ── Reranker backend (cross-encoder) ────────────────────────────────────────
  // Optional. Used when rerankerEnabled=true and rerankerProvider='cohere'.
  cohere: {
    apiKey: String(env.COHERE_API_KEY || '').trim(),
    baseUrl: normalizeHttpUrl(env.COHERE_BASE_URL, 'https://api.cohere.com', 'COHERE_BASE_URL'),
  },

  langsmith: {
    apiKey: String(env.LANGSMITH_API_KEY || '').trim(),
    endpoint: normalizeHttpUrl(env.LANGSMITH_ENDPOINT, 'https://api.smith.langchain.com', 'LANGSMITH_ENDPOINT'),
    project: String(env.LANGSMITH_PROJECT || 'atlas').trim(),
    tracingEnabled: parseBoolean(env.LANGSMITH_TRACING, false, 'LANGSMITH_TRACING'),
  },

  google: {
    // Required to verify Google ID tokens server-side. Must match the
    // OAuth Client ID used by the frontend's Google Sign-In button.
    clientId: String(env.GOOGLE_CLIENT_ID || '').trim(),
  },

  admin: {
    // Comma-separated list of Google-authenticated editor emails allowed to
    // publish System Design content. Empty means locked down by default.
    allowedEmails: (env.ADMIN_ALLOWED_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    // Local-only CMS preview mode for UX work. This is ignored in production
    // and on Cloud Run even if the env var is accidentally set there.
    localPreview,
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
    allowedDomains: (env.CONTACT_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Personal/public domains are blocked by default. Add exact email
    // exceptions below for trusted people using personal accounts.
    personalDomains: (env.CONTACT_PERSONAL_DOMAINS ?? 'gmail.com,yahoo.com,outlook.com,hotmail.com,icloud.com,proton.me,aol.com,live.com,msn.com')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    allowedEmails: (env.CONTACT_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    blockedDomains: (env.CONTACT_BLOCKED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Real phone number — never inlined in HTML. Falls back to a sentinel
    // so the policy remains testable in dev without leaking real PII.
    privatePhone: env.PRIVATE_PHONE || '+91 XXXX XXX XXX',
  },

  firestore: {
    // Optional override — defaults to Firestore Native in the GCP project
    // tied to the runtime service account.
    projectId:  env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '',
    databaseId: env.FIRESTORE_DATABASE_ID || '(default)',
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
    secret: String(env.SF_CALLBACK_SECRET || '').trim(),
  },

  // ── Billing / Subscriptions (Stripe) ─────────────────────────────────────────
  // Optional in dev. In production, set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
  stripe: {
    secretKey: String(env.STRIPE_SECRET_KEY || '').trim(),
    // Public key used by Stripe.js (Embedded Checkout / Payment Element).
    publishableKey: String(env.STRIPE_PUBLISHABLE_KEY || '').trim(),
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim(),
    // Price IDs created in Stripe Dashboard (Products → Prices).
    // Used by /api/billing/checkout-session when priceId isn't provided.
    priceMonthly: String(env.STRIPE_PRICE_MONTHLY || '').trim(),
    priceYearly: String(env.STRIPE_PRICE_YEARLY || '').trim(),
    // Public URL of the site (used for success/cancel redirects).
    siteUrl: normalizeHttpUrl(env.SITE_URL, 'http://localhost:8080', 'SITE_URL', { originOnly: true }),
  },

  internal: {
    // Used to sign internal-only URLs (e.g. premium PDF print pages for Puppeteer).
    // In production, set INTERNAL_REQUEST_SECRET.
    requestSecret: String(env.INTERNAL_REQUEST_SECRET
      || (localPreview ? 'local-dev-internal-secret' : ''),
    ).trim(),
  },
};

  config.runtime = {
    isCloudRuntime,
    nodeEnv,
    mediaBucket: String(env.MEDIA_BUCKET || '').trim(),
    adminLocalPreview: localPreview,
    chromePath: String(env.CHROME_PATH || '').trim(),
    sfApiKey: String(env.SF_API_KEY || '').trim(),
    siteUrl: config.stripe.siteUrl,
  };

  return deepFreeze(validateConfig(config));
}

const loaded = loadConfig(process.env);
module.exports = Object.freeze(Object.assign({}, loaded, { loadConfig, validateConfig }));
