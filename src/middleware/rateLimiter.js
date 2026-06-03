'use strict';

const rateLimit = require('express-rate-limit');
const config    = require('../config');

// "Hire Me" submissions: 10/hour/IP.
const hireLimiter = rateLimit({
  windowMs:       config.rateLimit.windowMs,
  max:            config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:  false,
  message: {
    success: false,
    code:    'RATE_LIMIT_ERROR',
    error:   'Too many requests from this IP. Please try again in an hour.',
  },
  skip: () => config.server.env === 'test',
});

// "Ask a Question" submissions: tighter cap than hire because it's free-form
// long-text and a richer abuse vector. 5/hour/IP is enough for a real
// recruiter dialogue but blunts spam. Lives in its own bucket so a burst of
// questions can't lock the user out of the (more important) hire form.
//
// We also use draft-7 RateLimit-* headers so the client can show a precise
// "try again at HH:MM" countdown instead of guessing.
const questionLimiter = rateLimit({
  windowMs:       60 * 60 * 1000,  // 1 hour
  max:            5,
  standardHeaders: 'draft-7',
  legacyHeaders:  false,
  message: {
    success: false,
    code:    'RATE_LIMIT_ERROR',
    error:   "Thanks for the interest! You've sent the maximum questions for now — please try again in an hour.",
  },
  skip: () => config.server.env === 'test',
});

// "Leave a Recommendation": 3/hour/IP. Even with Google Sign-In gating
// the form, IP-level limit catches abuse from a script automating accounts.
// Per-Google-UID limit happens at the route level (the doc-id IS the uid,
// so SF/Firestore upserts collapse to in-place updates — there's no way
// to spam-create rows).
//
// Why tighter than questions: a recommendation is a public artefact; the
// damage radius of one bad write is wider than a private question.
const recommendationLimiter = rateLimit({
  windowMs:       60 * 60 * 1000,  // 1 hour
  max:            3,
  standardHeaders: 'draft-7',
  legacyHeaders:  false,
  message: {
    success: false,
    code:    'RATE_LIMIT_ERROR',
    error:   "You've sent the maximum recommendations from this network for now — please try again in an hour.",
  },
  skip: () => config.server.env === 'test',
});

module.exports = { hireLimiter, questionLimiter, recommendationLimiter };
