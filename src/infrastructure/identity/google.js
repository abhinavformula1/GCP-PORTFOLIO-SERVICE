'use strict';

/**
 * Google ID-token verification (shared by /api/session/start and the
 * Bearer-token middleware used for chat APIs).
 */

const { OAuth2Client } = require('google-auth-library');
const { AppError } = require('../../domain/errors');

function createGoogleIdentityVerifier({ config, createClient = (clientId) => new OAuth2Client(clientId) }) {
if (!config || !config.google) {
  throw new TypeError('googleIdentity.config.google is required');
}
if (typeof createClient !== 'function') {
  throw new TypeError('googleIdentity.createClient must be a function');
}
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
  _oauth = createClient(config.google.clientId);
  return _oauth;
}

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
      uid: payload.sub,
      email: payload.email,
      name: payload.name || '',
      picture: payload.picture || null,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid Google credential.', 401, 'UNAUTHORIZED');
  }
}

  return Object.freeze({ verifyIdToken });
}

module.exports = { createGoogleIdentityVerifier };
