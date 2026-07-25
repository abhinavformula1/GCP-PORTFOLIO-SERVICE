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

function createRouter(dependencies) {
  const {
    startSession,
  } = dependencies;

  const router = express.Router();

// POST /api/session/start
// Body:    { credential: "<google id token>" }
// Response: { isReturning, name, picture, visitCount, firstSeenAt, lastSeenAt }
router.post('/session/start', async (req, res, next) => {
  try {
    const hostRaw = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(',')[0].trim();
    const result = await startSession({
      credential: (req.body && req.body.credential) || '',
      host,
    });
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

  return router;
}

module.exports = { createRouter };
