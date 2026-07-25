'use strict';

const express                    = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError }        = require('../../../domain/errors');

function createRouter(dependencies) {
  const {
    hireLimiter,
    submitHire,
  } = dependencies;

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

  try {
    return res.status(200).json(await submitHire(req.body));
  } catch (err) {
    // 3. Pass to global error handler
    return next(err);
  }
});

  return router;
}

module.exports = { createRouter };
