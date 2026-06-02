'use strict';

const express                    = require('express');
const { body, validationResult } = require('express-validator');
const { hireLimiter }            = require('../middleware/rateLimiter');
const salesforce                 = require('../services/salesforce');
const { ValidationError }        = require('../errors');

const router = express.Router();

// ── Validation rules ──────────────────────────────────────────────────────────
const validateHire = [
  body('name')
    .trim()
    .notEmpty().withMessage('Full name is required.')
    .isLength({ max: 255 }).withMessage('Name must be 255 characters or fewer.'),

  body('email')
    .trim()
    .notEmpty().withMessage('Work email is required.')
    .isEmail().withMessage('Enter a valid email address.')
    .normalizeEmail(),

  body('company')
    .trim()
    .notEmpty().withMessage('Company name is required.')
    .isLength({ max: 255 }).withMessage('Company must be 255 characters or fewer.'),

  // Free-form recruiter message — lands in Recruiter_Inquiry__c.Description__c
  // Salesforce field is Text(255), so the cap matches the storage limit.
  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 }).withMessage('Message must be 255 characters or fewer.'),

  // Guided assistant fields (optional — not sent by legacy modal)
  body('role').optional().trim().isLength({ max: 100 }),
  body('contractType').optional().trim().isLength({ max: 50 }),
  body('urgency').optional().trim().isLength({ max: 50 }),
  body('slot').optional().trim().isLength({ max: 100 }),
];

// ── POST /api/hire ────────────────────────────────────────────────────────────
router.post('/hire', hireLimiter, validateHire, async (req, res, next) => {
  // 1. Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ValidationError(
      errors.array()[0].msg,
      errors.array().map((e) => ({ field: e.path, message: e.msg }))
    ));
  }

  const { name, email, company, description, role, contractType, urgency, slot } = req.body;

  // Build the Description__c payload. The form's free-form "Message" field
  // (description) is the primary content; structured guided-assistant fields,
  // when present, are appended below a separator so a single SF text-area
  // surface holds both. Result is the same Description__c everyone reads.
  const guided = [
    role         && `Role: ${role}`,
    contractType && `Type: ${contractType}`,
    urgency      && `Urgency: ${urgency}`,
    slot         && `Requested slot: ${slot}`,
  ].filter(Boolean).join('\n');

  // Description__c is Text(255) in Salesforce. Per-field validation already
  // caps `description` at 255, but combining it with guided-assistant fields
  // could overflow — so we hard-truncate the merged string here as a final
  // safety net (avoids STRING_TOO_LONG errors at the SF API).
  const SF_DESCRIPTION_MAX = 255;
  const notes = [description, guided].filter(Boolean).join('\n\n—\n').slice(0, SF_DESCRIPTION_MAX);

  try {
    // 2. Create Salesforce record (skip gracefully if SF not configured yet)
    const sfConfigured = !!(process.env.SF_CLIENT_ID && process.env.SF_USERNAME && process.env.SF_PRIVATE_KEY);

    let recordId = null;
    let alreadySubmitted = false;
    if (sfConfigured) {
      const result = await salesforce.createInquiry({ name, email, company, notes });
      recordId         = result.id;
      alreadySubmitted = !!result.duplicate;
    } else {
      console.log('[hire] Salesforce not configured — logging inquiry:', { name, email, company, notes });
    }

    return res.status(200).json({
      success:          true,
      alreadySubmitted,
      message:          alreadySubmitted
        ? "Looks like you've already reached out — thanks! I'll get back to you within 1–2 business days."
        : 'Inquiry submitted successfully.',
      recordId,
    });
  } catch (err) {
    // 3. Pass to global error handler
    return next(err);
  }
});

module.exports = router;
