'use strict';

const express                    = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit                  = require('express-rate-limit');
const { summariseConversation }  = require('../services/llm');

const router = express.Router();

const summariseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const validateSummarise = [
  body('name').trim().notEmpty().isLength({ max: 255 }),
  body('company').trim().notEmpty().isLength({ max: 255 }),
  body('role').trim().notEmpty().isLength({ max: 100 }),
  body('contractType').trim().notEmpty().isLength({ max: 50 }),
  body('urgency').trim().notEmpty().isLength({ max: 50 }),
  body('slot').trim().notEmpty().isLength({ max: 100 }),
];

router.post('/summarise', summariseLimiter, validateSummarise, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  try {
    const summary = await summariseConversation(req.body);
    return res.status(200).json({ success: true, summary });
  } catch (err) {
    console.error('LLM summarise error:', err.message);
    return res.status(502).json({ error: 'Summary generation failed. Please try again.' });
  }
});

module.exports = router;
