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

function localPreviewRecommendations() {
  const now = Date.now();
  return [
    {
      id: 'local-reco-1',
      name: 'Maya Chen',
      company: 'Salesforce',
      avatarUrl: '',
      text: 'Abhinav brings the rare mix of Salesforce depth, integration discipline, and product-minded execution. He can turn ambiguous enterprise requirements into clean, reviewable architecture.',
      reply: 'Thank you, Maya. This is exactly the kind of enterprise engineering standard I try to bring to every project.',
      submittedAt: now - 4 * 24 * 60 * 60 * 1000,
      updatedAt: now - 4 * 24 * 60 * 60 * 1000,
      repliedAt: now - 3 * 24 * 60 * 60 * 1000,
    },
    {
      id: 'local-reco-2',
      name: 'Rahul Mehta',
      company: 'Google Cloud',
      avatarUrl: '',
      text: 'The portfolio feels like a working product, not a static resume. The GCP, Firestore, Cloud Run, and AI assistant story is strong for senior application engineering roles.',
      submittedAt: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 2 * 24 * 60 * 60 * 1000,
    },
  ];
}

// ── GET /api/recommendations ─────────────────────────────────────────────────
//
// Public, unauthenticated. Reads from Firestore only (no SF calls per page
// load). Used by the homepage to render the "Recommendations" section.
//
// Response shape is intentionally PII-light: name + company + avatar are
// public (the recruiter consented when they submitted), email is NOT.
router.get('/recommendations', async (_req, res, _next) => {
  if (config.admin.localPreview) {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      recommendations: localPreviewRecommendations(),
      source: 'local-preview',
    });
  }

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
    // 1. Verify Google identity. Unlike POST, we don't accept a body
    //    fallback — DELETE has no body by HTTP convention, and we want
    //    a single auth path here so no edge case lets the uid come from
    //    anywhere except a verified token.
    const auth = req.get('Authorization') || '';
    const bearer = auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';

    if (!bearer) {
      throw new AppError(
        'Sign in with Google to delete your recommendation.',
        401, 'UNAUTHORIZED'
      );
    }

    const { uid } = await googleAuth.verifyIdToken(bearer);
    const transactionId = crypto.randomUUID();

    // 2. Firestore HARD delete first. This is the public read model —
    //    once it's gone here, the card stops appearing on every page
    //    load globally. We do this before SF so the user-visible effect
    //    happens immediately even if the SF callout is slow.
    const fsResult = await firestore.deleteRecommendation(uid);

    // 3. Salesforce SOFT delete. Best-effort: if it fails after retries
    //    the recruiter still got the visible deletion they asked for,
    //    and a future reconcile cleans up the SF side.
    let sfResult = { skipped: true, deleted: false };
    try {
      sfResult = await salesforce.deleteRecommendation(
        { googleUid: uid },
        { transactionId }
      );
    } catch (sfErr) {
      console.error(
        `[recommendation] SF soft-delete FAILED after retries (uid=${uid} txId=${transactionId}): ${sfErr.message}`
      );
    }

    return res.status(200).json({
      success:          true,
      uid,
      firestoreDeleted: fsResult.deleted,
      salesforceSynced: !sfResult.skipped && !!sfResult.deleted,
      transactionId,
      message: fsResult.deleted
        ? 'Your recommendation has been removed.'
        : "There was nothing to delete — you didn't have an active recommendation.",
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
    // 1. Authenticate the caller. If we never set a secret, refuse — that's
    //    the safest default for a public-internet-facing callback.
    // Trim BOTH sides defensively. A naive `openssl rand -hex 32 |
    // gcloud secrets create ... --data-file=-` leaves a trailing \n in the
    // stored secret, which makes `expected` one byte longer than anything
    // a sane HTTP client would send and the constant-time compare always
    // fails. Trimming both sides means the route is correct regardless of
    // whether the operator stored the secret cleanly.
    const expected = (config.sfCallback.secret || '').trim();
    if (!expected) {
      throw new AppError(
        'Salesforce callback is not configured on this environment.',
        503, 'SF_CALLBACK_NOT_CONFIGURED'
      );
    }
    const provided = (req.get('X-API-Key') || '').trim();
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
