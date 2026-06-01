'use strict';

/**
 * Chat-history API — Firestore-backed, per-user.
 *
 *   GET    /api/chat/active     → returns the user's active chat or null
 *   POST   /api/chat/active     → upsert active chat (step, answers, message)
 *   DELETE /api/chat/active     → clears the active chat ("start over")
 *   POST   /api/chat/complete   → moves active chat → inquiries history
 *
 * All endpoints require a valid Google ID token in the Authorization header.
 * The user is identified by `req.user.uid` (the Google `sub` claim).
 *
 * Designed to be **best-effort** from the client's perspective: failures are
 * surfaced as errors but never block the in-memory UX flow (the frontend
 * fires-and-forgets on each turn).
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const firestore       = require('../services/firestore');
const { ValidationError } = require('../errors');

const router = express.Router();

// All chat routes require auth
router.use('/chat', requireAuth);

// ── GET /api/chat/active ─────────────────────────────────────────────────────
router.get('/chat/active', async (req, res, next) => {
  try {
    const chat = await firestore.getActiveChat(req.user.uid);
    return res.status(200).json({ success: true, chat });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/chat/active ────────────────────────────────────────────────────
// Body: { step?, answers?, message?: { role, text }, locale? }
router.post('/chat/active', async (req, res, next) => {
  try {
    const { step, answers, message, locale } = req.body || {};

    if (message && (typeof message !== 'object' || typeof message.text !== 'string')) {
      throw new ValidationError('Invalid message payload.');
    }
    if (step !== undefined && (typeof step !== 'number' || step < 0 || step > 50)) {
      throw new ValidationError('Invalid step.');
    }
    if (answers !== undefined && (typeof answers !== 'object' || answers === null)) {
      throw new ValidationError('Invalid answers payload.');
    }

    await firestore.upsertActiveChat(req.user.uid, { step, answers, message, locale });
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// ── DELETE /api/chat/active ──────────────────────────────────────────────────
router.delete('/chat/active', async (req, res, next) => {
  try {
    await firestore.clearActiveChat(req.user.uid);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/chat/complete ──────────────────────────────────────────────────
// Body: { salesforceId?: string, alreadySubmitted?: boolean }
router.post('/chat/complete', async (req, res, next) => {
  try {
    const { salesforceId, alreadySubmitted } = req.body || {};
    await firestore.completeActiveChat(req.user.uid, { salesforceId, alreadySubmitted });
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
