'use strict';

/**
 * Express middleware that requires a valid Google ID token in the
 * Authorization header. Attaches { uid, email, name, picture } to req.user.
 *
 *   Authorization: Bearer <google-id-token>
 *
 * On failure: responds with 401 via the global error handler.
 */

const googleAuth = require('../services/googleAuth');
const config = require('../config');
const { AppError } = require('../errors');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) throw new AppError('Missing Authorization header.', 401, 'UNAUTHORIZED');

    req.user = await googleAuth.verifyIdToken(m[1]);
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
    const header = req.headers.authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return next();
    req.user = await googleAuth.verifyIdToken(m[1]);
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
    req.user = {
      uid: 'local-admin-preview',
      email: 'local-admin@localhost',
      name: 'Local Admin Preview',
      picture: '',
    };
    return next();
  }

  await requireAuth(req, res, (err) => {
    if (err) return next(err);

    const email = String(req.user?.email || '').toLowerCase();
    if (!config.admin.allowedEmails.length || !config.admin.allowedEmails.includes(email)) {
      return next(new AppError('Admin access is not allowed for this account.', 403, 'FORBIDDEN'));
    }
    return next();
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
