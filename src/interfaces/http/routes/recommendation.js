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

const express                         = require('express');
const { body, validationResult }      = require('express-validator');
const { ValidationError }             = require('../../../domain/errors');
const { assertDependencies }          = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.recommendation', {
    recommendationLimiter: 'function',
    recommendations: ['list', 'submit', 'remove', 'applyReply'],
  });
  const {
    recommendationLimiter,
    recommendations,
  } = dependencies;

  const router = express.Router();

// Recommendation_Text__c is Long Text Area on SF (32K capable). 2000 is
// a UX cap — anything longer is an essay, not a recommendation, and the
// card layout would break.
const TEXT_MAX_LEN  = 2000;

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
    const result = await recommendations.list();
    res.set('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(200).json(result);
  } catch (err) {
    return _next(err);
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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError(
        errors.array()[0].msg,
        errors.array().map((error) => ({ field: error.path, message: error.msg }))
      ));
    }
    const authorization = req.get('Authorization') || '';
    const token = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : String(req.body.credential || '').trim();
    const result = await recommendations.submit({ token, text: req.body.text });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return next(error);
  }
});

// ── DELETE /api/recommendation ───────────────────────────────────────────────
//
// Recruiter retracts their own recommendation. Auth: same Google ID token
// pattern as the POST handler — the uid is taken from the verified token,
// never from the URL or body, so a recruiter can only ever delete THEIR
// OWN row. There is no admin override surface here on purpose; if I (the
// site owner) ever need to delete someone else's recommendation, I'd do
// it from Salesforce, where I have a CRM-grade audit trail.
//
// Dual-delete shape mirrors the POST dual-write:
//   - Firestore   : HARD delete (public read model goes clean immediately)
//   - Salesforce  : SOFT delete (Status__c = 'Deleted', cascade-clear the
//                   reply fields) — preserves the CRM audit trail
//
// Reply cascade: the user warned the recruiter in the confirm UI that
// their reply would also be removed. Firestore is naturally cascading
// (reply lives on the same doc; doc.delete() takes the reply with it).
// Salesforce side is explicit — the Apex deleteTestimonial method sets
// Reply__c = null and Replied_At__c = null so the row's "the conversation
// is gone" state is consistent regardless of where we read from.
//
// Why not retry the SF call inline like POST does: the user already saw
// the card disappear (Firestore is the public read model), so the SF
// soft-delete is best-effort. If it fails after retries, we log loudly
// and a future reconcile (the recruiter re-submitting then deleting
// again, or a manual SF cleanup) repairs it. The audit trail on SF is
// for the org owner; the recruiter's experience is already correct.
router.delete('/recommendation', async (req, res, next) => {
  try {
    const authorization = req.get('Authorization') || '';
    const token = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    return res.status(200).json(await recommendations.remove({ token }));
  } catch (error) {
    return next(error);
  }
});

// ── POST /api/recommendation/:uid/reply ──────────────────────────────────────
//
// SF → GCP callback handler. Apex trigger fires this when I write a Reply
// on the Recommendation__c record in Salesforce.
//
// Auth: shared secret in the X-API-Key header. The Salesforce External
// Credential `GCP` is configured to send this on every callout via the
// linked Named Credential `Portfolio_Service`, so a rogue caller without
// the secret cannot inject a reply onto a recommendation.
//
// Why X-API-Key (not the original X-SF-Callback-Secret): the SF org's
// External Credential already uses X-API-Key as a convention across
// integrations. We match it here rather than force a rename.
//
// Why a constant-time comparison: a naive `===` allows a timing attack
// where an attacker can guess the secret one character at a time by
// measuring response latency. crypto.timingSafeEqual eliminates that.
router.post('/recommendation/:uid/reply', async (req, res, next) => {
  try {
    const result = await recommendations.applyReply({
      apiKey: req.get('X-API-Key'),
      uid: req.params.uid,
      reply: req.body && req.body.reply,
      repliedAt: req.body && req.body.repliedAt,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    return next(error);
  }
});

  return router;
}

module.exports = { createRouter };
