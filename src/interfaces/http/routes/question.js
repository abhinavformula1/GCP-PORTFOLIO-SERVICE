'use strict';

/**
 * POST /api/question — recruiter "Ask a Question" endpoint.
 *
 * Demonstrates four production patterns in one path:
 *
 *   1. Idempotency
 *      The client supplies an Idempotency-Key (UUID) generated when the
 *      modal opens. We pass it through to Salesforce as the External ID
 *      on Recruiter_Question__c, and the Apex endpoint UPSERTs by that
 *      key. Result: a flaky network or a panicked double-click cannot
 *      create two rows. (See Stripe / GitHub idempotency-key conventions.)
 *
 *      The header is the source of truth. If the client also sends
 *      `gcpQuestionId` in the body, we cross-check; mismatch → 400.
 *      If neither is sent, the server mints one and echoes it back so
 *      the client can persist it for an eventual edit.
 *
 *   2. Rate limiting
 *      Per-endpoint limiter (questionLimiter — 5/hour/IP), independent
 *      of the hire-form limiter. A spam burst here can't lock recruiters
 *      out of the more important hire form.
 *
 *   3. Retry mechanism
 *      Implemented one layer down (recruiterQuestion.upsertQuestion uses
 *      exponential backoff for transient SF failures). The route stays
 *      thin — its job is validation + correlation, not transport policy.
 *
 *   4. Correlation IDs
 *      A fresh transactionId is generated per request and stamped on:
 *        - Integration_Log__c rows (via the Salesforce httpClient logger)
 *        - The Recruiter_Question__c.Transaction_Id__c field
 *      So any single inbound request can be traced end-to-end via SOQL:
 *        SELECT Id FROM Integration_Log__c WHERE Transaction_Id__c = :id
 *
 * Why a single endpoint for create + edit:
 *   The Apex side is already an idempotent UPSERT keyed on External ID,
 *   so a "POST" to `/api/question` with the SAME Idempotency-Key as a
 *   prior request is functionally an edit. We don't need a separate
 *   PUT route to express that — the contract is the External ID. Less
 *   surface area, fewer ways to introduce inconsistency.
 */

const express                    = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError }        = require('../../../domain/errors');

function createRouter(dependencies) {
  const {
    questionLimiter,
    submitQuestion,
  } = dependencies;

  const router = express.Router();

// Recruiter_Question__c.Question_Text__c is Long Text Area — we cap at 4K
// here for readable UI + to keep payloads small. Salesforce LTA can hold
// up to 131K so this is well within limits.
const QUESTION_MAX_LEN = 4000;

const validateQuestion = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required.')
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail(),

  body('question')
    .trim()
    .notEmpty().withMessage('Question text is required.')
    .isLength({ max: QUESTION_MAX_LEN })
    .withMessage(`Question must be ${QUESTION_MAX_LEN} characters or fewer.`),

  body('name').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),
  body('company').optional({ checkFalsy: true }).trim().isLength({ max: 255 }),

  // Optional in the body — primary source is the Idempotency-Key header.
  // Validated below so we can return a clear error if both are sent and
  // disagree (a class of bug that's awful to debug without an explicit check).
  body('gcpQuestionId').optional({ checkFalsy: true }).isString(),
];

router.post('/question', questionLimiter, validateQuestion, async (req, res, next) => {
  // 1. Field-level validation
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ValidationError(
      errors.array()[0].msg,
      errors.array().map((e) => ({ field: e.path, message: e.msg }))
    ));
  }

  try {
    const result = await submitQuestion(req.body, req.get('Idempotency-Key'));
    return res.status(result.statusCode).json(result.body);
  } catch (err) {
    return next(err);
  }
});

  return router;
}

module.exports = { createRouter };
