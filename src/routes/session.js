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
const firestore                      = require('../services/firestore');
const googleAuth                     = require('../services/googleAuth');
const { ValidationError, AppError }  = require('../errors');

const router = express.Router();

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
    const { uid, email, name, picture } = await googleAuth.verifyIdToken(credential);

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
    return next(err);
  }
});

module.exports = router;
