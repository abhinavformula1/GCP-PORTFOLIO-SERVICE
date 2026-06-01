'use strict';

/**
 * Google ID-token verification (shared by /api/session/start and the
 * Bearer-token middleware used for chat APIs).
 *
 * Uses google-auth-library's OAuth2Client.verifyIdToken which handles:
 *   - signature verification against Google's published keys
 *   - audience check against our GOOGLE_CLIENT_ID
 *   - expiry check (ID tokens are valid for 1 hour)
 *   - issuer check (https://accounts.google.com)
 */

const { OAuth2Client } = require('google-auth-library');
const config = require('../config');
const { AppError } = require('../errors');

let _oauth = null;
function getClient() {
  if (_oauth) return _oauth;
  if (!config.google.clientId) {
    throw new AppError(
      'Google Sign-In is not configured on the server.',
      503,
      'GOOGLE_NOT_CONFIGURED'
    );
  }
  _oauth = new OAuth2Client(config.google.clientId);
  return _oauth;
}

/**
 * Verifies a Google ID token and returns the payload {sub, email, name, picture}.
 * Throws AppError(401) on any verification failure.
 */
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new AppError('Missing Google credential.', 401, 'UNAUTHORIZED');
  }
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload() || {};
    if (!payload.sub || !payload.email) {
      throw new AppError('Invalid Google credential.', 401, 'UNAUTHORIZED');
    }
    return {
      uid:     payload.sub,
      email:   payload.email,
      name:    payload.name || '',
      picture: payload.picture || null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid Google credential.', 401, 'UNAUTHORIZED');
  }
}

module.exports = { verifyIdToken };
