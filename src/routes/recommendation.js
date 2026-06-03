'use strict';

/**
 * Recommendation routes — three handlers serve the round-trip:
 *
 *   GET  /api/recommendations             ← public read (page render)
 *   POST /api/recommendation              ← Google-signed-in submit
 *   POST /api/recommendation/:uid/reply   ← Salesforce → Cloud Run callback
 *
 * Architectural shape (CQRS-lite):
 *
 *   ┌──────────┐   write   ┌────────────┐   write   ┌────────────┐
 *   │ Recruiter│──────────►│   Cloud    │──────────►│ Salesforce │
 *   │ (signed  │           │   Run      │           │ (system of │
 *   │  in via  │           │  POST /api │           │  record)   │
 *   │  Google) │           │  /recomm…  │           └─────┬──────┘
 *   └──────────┘           │            │                 │
 *                          │            │   write         │
 *                          │            ├────────────────►│
 *                          │            │  Firestore      │
 *                          │            │  (public read   │
 *                          │            │   model)        │
 *                          └────────────┘                 │
 *                                ▲                        │
 *                                │ callback (Named Cred + │
 *                                │ X-SF-Callback-Secret)  │
 *                                └────────────────────────┘
 *                                  POST /api/recommendation/<uid>/reply
 *                                  fires from Apex trigger when I write
 *                                  Reply__c on the SF record.
 *
 * Why both a public read store AND the system of record:
 *   - The page must render fast, public, no-auth — Firestore is built for that.
 *   - SF holds the canonical record + drives my workflow (assign tasks,
 *     report on, reply to). Built for that.
 *   - When the two diverge (rare), SF wins on next reconcile. The Apex
 *     trigger is the reconciliation channel.
 *
 * Identity model:
 *   - Submitter identity comes from the verified Google ID token (sub claim
 *     is the uid, email is verified, hd may carry the workspace domain).
 *   - The uid IS the Firestore doc id AND the SF External Id, so the same
 *     person re-submitting always lands on the same row in both stores.
 *     No client-side Idempotency-Key needed for this flow.
 */

const crypto                          = require('crypto');
const express                         = require('express');
const { body, validationResult }      = require('express-validator');
const { recommendationLimiter }       = require('../middleware/rateLimiter');
const firestore                       = require('../services/firestore');
const salesforce                      = require('../services/salesforce');
const googleAuth                      = require('../services/googleAuth');
const config                          = require('../config');
const { ValidationError, AppError }   = require('../errors');

const router = express.Router();

// Recommendation_Text__c is Long Text Area on SF (32K capable). 2000 is
// a UX cap — anything longer is an essay, not a recommendation, and the
// card layout would break.
const TEXT_MAX_LEN  = 2000;
const REPLY_MAX_LEN = 1000;

// ── GET /api/recommendations ─────────────────────────────────────────────────
//
// Public, unauthenticated. Reads from Firestore only (no SF calls per page
// load). Used by the homepage to render the "Recommendations" section.
//
// Response shape is intentionally PII-light: name + company + avatar are
// public (the recruiter consented when they submitted), email is NOT.
router.get('/recommendations', async (_req, res, _next) => {
  // Graceful degradation: if Firestore is unreachable (local dev with no
  // gcloud ADC; prod outage; quota exhausted), the public page should still
  // render. Returning an empty list with a 200 keeps the section rendering
  // clean (just shows the empty state). The error is logged so we notice.
  try {
    const items = await firestore.listActiveRecommendations();
    res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(200).json({ success: true, recommendations: items });
  } catch (err) {
    console.error('[recommendations] Firestore read failed (returning empty list):', err.message);
    return res.status(200).json({
      success:         true,
      recommendations: [],
      degraded:        true,
    });
  }
});

// ── POST /api/recommendation ─────────────────────────────────────────────────
//
// Submit a recommendation. Requires a Google ID token (Authorization: Bearer
// <token>). The submitter's name / email / avatar come from the verified
// token claims — we never trust those fields from the client body.
//
// Dual-write: Firestore first (synchronous, fast — recruiter sees their
// recommendation immediately), Salesforce second (sync but retried via
// withRetry). If SF transiently fails, the Firestore write is already
// visible — SF catches up on the next attempt. We fire-and-forget the
// SF write only as a last resort if it exhausts retries, so the recruiter
// never sees an error for a problem they can't fix.
const validateRecommendation = [
  body('text')
    .trim()
    .notEmpty().withMessage('Recommendation text is required.')
    .isLength({ max: TEXT_MAX_LEN })
    .withMessage(`Recommendation must be ${TEXT_MAX_LEN} characters or fewer.`),
];

router.post('/recommendation', recommendationLimiter, validateRecommendation, async (req, res, next) => {
  try {
    // 1. Validate body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError(
        errors.array()[0].msg,
        errors.array().map((e) => ({ field: e.path, message: e.msg }))
      ));
    }

    // 2. Verify Google identity. We accept the token in either the
    //    Authorization: Bearer header (preferred) or a body field
    //    (fallback for non-browser clients).
    const auth = req.get('Authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : (req.body.credential || '').trim();

    if (!bearer) {
      throw new AppError(
        'Sign in with Google to leave a recommendation.',
        401, 'UNAUTHORIZED'
      );
    }

    const { uid, email, name, picture } = await googleAuth.verifyIdToken(bearer);

    // Derive a user-facing "company" from the email domain. Apex / SF have
    // no way to do this cleanly without extra config, so we do it once here
    // and ship it through the dual-write. Edge cases are rare in practice
    // (most professional emails follow first.last@company.tld).
    const company = (email.split('@')[1] || '').replace(/\.[a-z]{2,}$/i, '').replace(/^./, (c) => c.toUpperCase());

    const text = String(req.body.text || '').trim();
    const transactionId = crypto.randomUUID();

    // 3. Firestore write — synchronous, fast, public read store.
    //    If this fails, the user gets a real error — they can retry.
    const fsResult = await firestore.upsertRecommendation({
      uid,
      email,
      emailVerified: true,
      hostedDomain:  email.split('@')[1] || '',
      name,
      company,
      avatarUrl:     picture,
      text,
    });

    // 4. Salesforce write — same uid as External Id, so this is idempotent
    //    too. We ATTEMPT to wait for it (so the response can carry the SF
    //    id), but if it fails after retries we still return success — the
    //    recommendation is already on the page. Operator alert via logs.
    let sfResult = { skipped: true, id: null };
    try {
      sfResult = await salesforce.upsertRecommendation(
        { googleUid: uid, name, email, company, avatarUrl: picture, text },
        { transactionId }
      );
    } catch (sfErr) {
      // The withRetry helper has already burned through the retry budget
      // by the time we land here. Log + continue — the recommendation is
      // visible to the recruiter, and a future write (next submission, or
      // a manual reconcile) will repair the SF side.
      console.error(
        `[recommendation] SF upsert FAILED after retries (uid=${uid} txId=${transactionId}): ${sfErr.message}`
      );
    }

    return res.status(fsResult.isNew ? 201 : 200).json({
      success:          true,
      isNew:            fsResult.isNew,
      uid,
      salesforceId:     sfResult.id,
      salesforceSynced: !sfResult.skipped && !!sfResult.id,
      transactionId,
      message: fsResult.isNew
        ? "Thanks for the recommendation — it's on the page now."
        : "Updated — your latest recommendation replaces the previous version.",
    });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/recommendation/:uid/reply ──────────────────────────────────────
//
// SF → GCP callback handler. Apex trigger fires this when I write a Reply
// on the Recommendation__c record in Salesforce.
//
// Auth: shared secret in the X-SF-Callback-Secret header. The Salesforce
// Named Credential is configured to send this on every callout, so a
// rogue caller without the secret cannot inject a reply onto a recommendation.
//
// Why a constant-time comparison: a naive `===` allows a timing attack
// where an attacker can guess the secret one character at a time by
// measuring response latency. crypto.timingSafeEqual eliminates that.
router.post('/recommendation/:uid/reply', async (req, res, next) => {
  try {
    // 1. Authenticate the caller. If we never set a secret, refuse — that's
    //    the safest default for a public-internet-facing callback.
    const expected = config.sfCallback.secret;
    if (!expected) {
      throw new AppError(
        'Salesforce callback is not configured on this environment.',
        503, 'SF_CALLBACK_NOT_CONFIGURED'
      );
    }
    const provided = (req.get('X-SF-Callback-Secret') || '').trim();
    const ok =
      provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) {
      throw new AppError('Invalid callback signature.', 401, 'UNAUTHORIZED');
    }

    // 2. Validate inputs
    const uid   = String(req.params.uid || '').trim();
    const reply = String((req.body && req.body.reply) || '').trim();
    const repliedAt = (req.body && req.body.repliedAt) || new Date().toISOString();
    if (!uid)   throw new ValidationError('uid path param is required.');
    if (!reply) throw new ValidationError('reply body field is required.');
    if (reply.length > REPLY_MAX_LEN) {
      throw new ValidationError(`reply must be ${REPLY_MAX_LEN} characters or fewer.`);
    }

    // 3. Apply to the Firestore document. Idempotent — replaying the same
    //    callback (Salesforce DOES retry callouts on failure) just re-writes
    //    the same reply, no harm done.
    const result = await firestore.writeRecommendationReply(uid, { reply, repliedAt });

    if (!result.applied) {
      // The Firestore doc might not exist if we get the reply callback
      // BEFORE the original recommendation arrived (race window). Tell
      // SF to back off — its trigger framework will retry later, by
      // which time the doc should exist.
      return res.status(409).json({
        success: false,
        code:    'RECOMMENDATION_NOT_FOUND',
        error:   `No recommendation found for uid=${uid}; SF should retry.`,
      });
    }

    return res.status(200).json({ success: true, uid });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
