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

const crypto                         = require('crypto');
const express                        = require('express');
const firestore                      = require('../services/firestore');
const billing                        = require('../services/billing');
const salesforce                     = require('../services/salesforce');
const googleAuth                     = require('../services/googleAuth');
const contactPolicy                  = require('../services/contactPolicy');
const config                         = require('../config');
const { ValidationError }            = require('../errors');

const router = express.Router();

function isSafeLocalDevRuntime() {
  return (config.server.env || 'development') !== 'production' && !process.env.K_SERVICE;
}

function isLocalhostRequest(req) {
  const hostRaw = req.headers['x-forwarded-host'] || req.headers.host || '';
  const host = String(Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(',')[0].trim().toLowerCase();
  return host.startsWith('localhost') || host.startsWith('127.0.0.1');
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

    // Localhost dev token for CMS work without Google OAuth setup.
    if (isSafeLocalDevRuntime() && isLocalhostRequest(req) && credential === 'local-admin-preview') {
      return res.status(200).json({
        success: true,
        isReturning: true,
        sub: 'local-admin-preview',
        name: 'Local Admin Preview',
        email: 'local-admin@localhost',
        picture: null,
        tier: 'free',
        visitCount: 1,
        firstSeenAt: null,
        lastSeenAt: null,
        contact: { canSeePhone: false, phone: null, matchedDomain: null },
        subscription: { active: false, status: 'guest', currentPeriodEnd: null, cancelAtPeriodEnd: false },
      });
    }

    // 1. Verify the ID token (signature + audience + expiry)
    const { uid, email, name, picture } = await googleAuth.verifyIdToken(credential);

    // 2. Upsert the user document — degrade gracefully if Firestore is down
    let visit = { isReturning: false, visitCount: 1, firstSeenAt: null, lastSeenAt: null, tier: 'free' };
    try {
      visit = await firestore.upsertUserVisit({ uid, email, name, picture });
    } catch (fsErr) {
      console.error('[session] Firestore upsert failed (continuing without persistence):', fsErr.message);
    }

    // 3. Mirror the visitor into Salesforce as a Site_Visitor__c record so
    //    visits show up alongside Recruiter_Inquiry__c in SF reports. We
    //    fire-and-forget so SF latency / availability never affects sign-in.
    //
    //    firstSeenAt:
    //      - null on returning visits → SF leaves the existing value alone
    //        (Salesforce upsert semantics: omitted fields aren't touched)
    //      - now() on first visit → SF stamps a new record
    const transactionId = crypto.randomUUID();
    Promise.resolve()
      .then(() => salesforce.upsertSiteVisitor({
        uid,
        email,
        name,
        firstSeenAt: visit.isReturning ? null : Date.now(),
        lastSeenAt:  Date.now(),
        visitCount:  visit.visitCount,
        transactionId,
      }))
      .catch((sfErr) => {
        console.error('[session] Salesforce Site_Visitor upsert failed (non-fatal):', sfErr.message);
      });

    // 4. Apply the contact-reveal policy. The phone number lives only on
    //    the server; it's returned to the client only when the verified
    //    email is in an allow-listed domain.
    const contact = await contactPolicy.resolveContactViewAsync({ email });

    // 4.5 Subscription entitlement (best-effort; never blocks sign-in UX).
    let subscription = { active: false, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false };
    try {
      subscription = await billing.getUserSubscriptionEntitlement(uid);
    } catch (_) {}

    // 5. Respond with the bits the frontend needs to greet the user.
    //    firstSeenAt/lastSeenAt come back as Firestore Timestamps — convert.
    return res.status(200).json({
      success:     true,
      isReturning: visit.isReturning,
      sub:         uid,
      name:        name || '',
      email,
      picture:     picture || null,
      tier:        String(visit && visit.tier ? visit.tier : 'free'),
      visitCount:  visit.visitCount,
      firstSeenAt: visit.firstSeenAt && visit.firstSeenAt.toMillis ? visit.firstSeenAt.toMillis() : null,
      lastSeenAt:  visit.lastSeenAt  && visit.lastSeenAt.toMillis  ? visit.lastSeenAt.toMillis()  : null,
      // Server-side decision — frontend never has to ask "should I show this?",
      // it just renders whatever the server gave it.
      contact,
      subscription,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
