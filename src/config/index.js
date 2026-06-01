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

  firestore: {
    // Optional override — defaults to Firestore Native in the GCP project
    // tied to the runtime service account.
    projectId:  process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '',
    databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
  },
};

module.exports = config;
