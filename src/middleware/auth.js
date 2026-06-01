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

module.exports = { requireAuth };
