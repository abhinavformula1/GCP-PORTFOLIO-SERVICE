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

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);

    const email = String(req.user && req.user.email || '').toLowerCase();
    if (!config.admin.allowedEmails.length || !config.admin.allowedEmails.includes(email)) {
      return next(new AppError('Admin access is not allowed for this account.', 403, 'FORBIDDEN'));
    }
    return next();
  });
}

module.exports = { requireAuth, requireAdmin };
