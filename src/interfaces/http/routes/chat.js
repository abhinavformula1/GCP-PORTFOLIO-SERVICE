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

function createRouter(dependencies) {
  const {
    requireAuth,
    chat,
  } = dependencies;

  const router = express.Router();

// All chat routes require auth
router.use('/chat', requireAuth);

// ── GET /api/chat/active ─────────────────────────────────────────────────────
router.get('/chat/active', async (req, res, next) => {
  try {
    const activeChat = await chat.getActive(req.user.uid);
    return res.status(200).json({ success: true, chat: activeChat });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/chat/active ────────────────────────────────────────────────────
// Body: { step?, answers?, message?: { role, text }, locale? }
router.post('/chat/active', async (req, res, next) => {
  try {
    await chat.saveActive(req.user.uid, req.body);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// ── DELETE /api/chat/active ──────────────────────────────────────────────────
router.delete('/chat/active', async (req, res, next) => {
  try {
    await chat.clearActive(req.user.uid);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

// ── POST /api/chat/complete ──────────────────────────────────────────────────
// Body: { salesforceId?: string, alreadySubmitted?: boolean }
router.post('/chat/complete', async (req, res, next) => {
  try {
    await chat.completeActive(req.user.uid, req.body);
    return res.status(200).json({ success: true });
  } catch (err) {
    return next(err);
  }
});

  return router;
}

module.exports = { createRouter };
