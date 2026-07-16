'use strict';

/**
 * Express middleware that requires a valid Google ID token in the
 * Authorization header. Attaches { uid, email, name, picture } to req.user.
 *
 *   Authorization: Bearer <google-id-token>
 *
 * On failure: responds with 401 via the global error handler.
 */

const googleAuth = require('../services/auth/google');
const config = require('../config');
const { AppError } = require('../errors');

function localPreviewUser() {
  return {
    uid: 'local-admin-preview',
    email: 'local-admin@localhost',
    name: 'Local Admin Preview',
    picture: '',
  };
}

function isSafeLocalDevRuntime() {
  // Cloud Run sets K_SERVICE; treat that as production-like even if NODE_ENV is wrong.
  return (config.server.env || 'development') !== 'production' && !process.env.K_SERVICE;
}

function isLocalhostRequest(req) {
  const hostRaw = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(',')[0].trim().toLowerCase();
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
}

function shouldAllowLocalAdminToken(req, token) {
  return isSafeLocalDevRuntime() && isLocalhostRequest(req) && token === 'local-admin-preview';
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? String(m[1] || '').trim() : '';
}

async function requireAuth(req, res, next) {
  try {
    if (config.admin.localPreview) {
      // Local UX work should not require Google auth setup.
      req.user = localPreviewUser();
      return next();
    }
    const token = extractBearerToken(req);
    if (!token) throw new AppError('Missing Authorization header.', 401, 'UNAUTHORIZED');

    if (shouldAllowLocalAdminToken(req, token)) {
      req.user = localPreviewUser();
      return next();
    }

    req.user = await googleAuth.verifyIdToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional auth: if Authorization header is present, validate it and attach
 * req.user. If header is missing, continue as guest.
 */
async function optionalAuth(req, _res, next) {
  try {
    if (config.admin.localPreview) {
      req.user = localPreviewUser();
      return next();
    }
    const token = extractBearerToken(req);
    if (!token) return next();

    if (shouldAllowLocalAdminToken(req, token)) {
      req.user = localPreviewUser();
      return next();
    }

    req.user = await googleAuth.verifyIdToken(token);
    return next();
  } catch (_err) {
    // Optional auth must never break public endpoints. Treat invalid/expired
    // tokens as "guest" and continue.
    req.user = null;
    return next();
  }
}

async function requireAdmin(req, res, next) {
  if (config.admin.localPreview) {
    req.user = localPreviewUser();
    return next();
  }

  // Localhost dev escape hatch for CMS work without Google OAuth setup.
  // Only enabled on localhost and never on Cloud Run.
  try {
    const token = extractBearerToken(req);
    if (token && shouldAllowLocalAdminToken(req, token)) {
      req.user = localPreviewUser();
      return next();
    }
  } catch (_) {}

  await requireAuth(req, res, (err) => {
    if (err) return next(err);

    const email = String(req.user?.email || '').toLowerCase();
    if (!config.admin.allowedEmails.length || !config.admin.allowedEmails.includes(email)) {
      return next(new AppError('Admin access is not allowed for this account.', 403, 'FORBIDDEN'));
    }
    return next();
  });
}

async function verifyAdminAccess(req, {
  allowQueryToken = false,
  allowHeaderToken = true,
} = {}) {
  if (config.admin.localPreview) {
    req.user = localPreviewUser();
    return req.user;
  }

  const headerToken = allowHeaderToken ? extractBearerToken(req) : '';
  const queryToken = allowQueryToken ? String(req.query?.token || '').trim() : '';
  const token = headerToken || queryToken;

  if (!token) {
    throw new AppError('Missing token.', 401, 'UNAUTHORIZED');
  }

  if (shouldAllowLocalAdminToken(req, token)) {
    req.user = localPreviewUser();
    return req.user;
  }

  try {
    req.user = await googleAuth.verifyIdToken(token);
  } catch (_) {
    throw new AppError('Invalid or expired token.', 401, 'UNAUTHORIZED');
  }

  const email = String(req.user?.email || '').toLowerCase();
  if (config.admin.allowedEmails.length && !config.admin.allowedEmails.includes(email)) {
    throw new AppError('Admin access not allowed.', 403, 'FORBIDDEN');
  }

  return req.user;
}

function requireAdminAccess(options = {}) {
  return async function adminAccessMiddleware(req, _res, next) {
    try {
      await verifyAdminAccess(req, options);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireAuth, optionalAuth, requireAdmin, verifyAdminAccess, requireAdminAccess };
