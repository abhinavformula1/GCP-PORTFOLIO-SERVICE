'use strict';

/**
 * Session routes — recognise returning Google-authenticated visitors and
 * persist their lightweight profile in Firestore.
 *
 * Flow:
 *   1. Frontend signs the user in with Google Identity Services
 *      → receives a JWT credential (the ID token).
 *   2. Frontend POSTs that token to /api/session/start.
 *   3. We verify the token server-side using google-auth-library
 *      (signature + audience + expiry).
 *   4. We upsert /users/{sub} in Firestore — first-visit -> create,
 *      otherwise increment visitCount and refresh lastSeenAt.
 *   5. Response tells the frontend whether to greet "Welcome" or
 *      "Welcome back".
 *
 * Designed for graceful degradation:
 *   - If GOOGLE_CLIENT_ID is unset → 503 with a clear message.
 *   - If Firestore is unreachable → still acknowledge the user (we log
 *     and return isReturning=false so the UI does not break).
 */

const express                        = require('express');
const { OAuth2Client }                = require('google-auth-library');
const config                         = require('../config');
const firestore                      = require('../services/firestore');
const { ValidationError, AppError }  = require('../errors');

const router = express.Router();

// Cached verifier — initialised on first request, reused after.
let _oauth = null;
function getOauth() {
  if (_oauth) return _oauth;
  if (!config.google.clientId) {
    const err = new AppError(
      'Google Sign-In is not configured on the server.',
      503,
      'GOOGLE_NOT_CONFIGURED'
    );
    throw err;
  }
  _oauth = new OAuth2Client(config.google.clientId);
  return _oauth;
}

// POST /api/session/start
// Body:    { credential: "<google id token>" }
// Response: { isReturning, name, picture, visitCount, firstSeenAt, lastSeenAt }
router.post('/session/start', async (req, res, next) => {
  try {
    const credential = (req.body && req.body.credential) || '';
    if (!credential || typeof credential !== 'string') {
      throw new ValidationError('Missing Google credential.');
    }

    // 1. Verify the ID token (signature + audience + expiry)
    const ticket = await getOauth().verifyIdToken({
      idToken:  credential,
      audience: config.google.clientId,
    });
    const payload = ticket.getPayload() || {};
    const { sub: uid, email, name, picture } = payload;

    if (!uid || !email) {
      throw new ValidationError('Invalid Google credential — missing sub or email.');
    }

    // 2. Upsert the user document — degrade gracefully if Firestore is down
    let visit = { isReturning: false, visitCount: 1, firstSeenAt: null, lastSeenAt: null };
    try {
      visit = await firestore.upsertUserVisit({ uid, email, name, picture });
    } catch (fsErr) {
      console.error('[session] Firestore upsert failed (continuing without persistence):', fsErr.message);
    }

    // 3. Respond with the bits the frontend needs to greet the user
    return res.status(200).json({
      success:     true,
      isReturning: visit.isReturning,
      name:        name || '',
      email,
      picture:     picture || null,
      visitCount:  visit.visitCount,
      firstSeenAt: visit.firstSeenAt && visit.firstSeenAt.toMillis ? visit.firstSeenAt.toMillis() : null,
      lastSeenAt:  visit.lastSeenAt  && visit.lastSeenAt.toMillis  ? visit.lastSeenAt.toMillis()  : null,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err && err.message && err.message.toLowerCase().includes('token')) {
      return next(new AppError('Invalid Google credential.', 401, 'INVALID_GOOGLE_TOKEN'));
    }
    return next(err);
  }
});

module.exports = router;
