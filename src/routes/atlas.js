'use strict';

/**
 * Atlas — free-form Q&A endpoints.
 *
 *   POST   /api/atlas/ask                  → JSON, single-shot reply
 *   POST   /api/atlas/stream               → text/event-stream, progressive reply
 *   GET    /api/atlas/conversations/active → user's saved conversation
 *   DELETE /api/atlas/conversations/active → "Start over" — wipe saved conversation
 *
 * All routes require Google ID token auth (req.user.uid).
 *
 * Conversation persistence:
 *   - Server is the source of truth. The route reads prior turns from
 *     Firestore (NOT from the request body) so a tampered/stale client
 *     can't poison the model's context.
 *   - Both turns (user message + bot reply) are appended to Firestore
 *     synchronously after a successful Gemini call. Failures to persist
 *     are logged but do NOT fail the request — the visitor still sees
 *     the answer; we just lose resume-on-refresh for that turn.
 *
 * Streaming:
 *   - The /stream endpoint emits SSE-formatted events so the client can
 *     render the reply progressively. Three event types:
 *         data: {"chunk":"...partial..."}
 *         data: {"done":"...final sanitised text...","transactionId":"..."}
 *         data: {"error":"...message...","code":"..."}
 *   - The final `done` event is what the client should treat as the
 *     authoritative reply. It's the one we persist.
 */

const crypto                     = require('crypto');
const express                    = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth }            = require('../middleware/auth');
const { atlasLimiter }           = require('../middleware/rateLimiter');
const {
  ask, askStream, MAX_USER_MSG_CHARS, MAX_HISTORY_TURNS, GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL_KEY,
} = require('../services/atlas/respond');
const firestore           = require('../services/firestore');
const { ValidationError } = require('../errors');

const router = express.Router();
const MODEL_KEYS = Object.keys(GEMINI_MODELS);

const validateAsk = [
  body('message')
    .trim()
    .notEmpty().withMessage('Message is required.')
    .isLength({ max: MAX_USER_MSG_CHARS })
    .withMessage(`Message must be ${MAX_USER_MSG_CHARS} characters or fewer.`),

  // history is allowed for backwards compat / dev tooling, but ignored —
  // server reads its own truth from Firestore. We still validate the
  // shape so a malformed body fails fast.
  body('history')
    .optional()
    .isArray({ max: MAX_HISTORY_TURNS * 2 })
    .withMessage(`History must be an array of at most ${MAX_HISTORY_TURNS * 2} turns.`),

  body('model')
    .optional()
    .isIn(MODEL_KEYS)
    .withMessage(`Model must be one of: ${MODEL_KEYS.join(', ')}.`),
];

/**
 * Pull the user's prior turns out of Firestore (best-effort). Returns []
 * on any error so a transient Firestore blip doesn't break the chat.
 */
async function loadServerHistory(uid) {
  try {
    const conv = await firestore.getActiveAtlasConversation(uid);
    return (conv && Array.isArray(conv.turns)) ? conv.turns : [];
  } catch (err) {
    console.warn('[atlas] loadServerHistory failed:', err.message);
    return [];
  }
}

/**
 * Append both turns to Firestore. Best-effort — never throws into the
 * caller. Logged and swallowed on failure.
 */
async function persistTurns(uid, userText, botText) {
  try {
    await firestore.appendAtlasTurn(uid, { role: 'user',  text: userText });
    await firestore.appendAtlasTurn(uid, { role: 'model', text: botText });
  } catch (err) {
    console.warn('[atlas] persistTurns failed:', err.message);
  }
}

/**
 * Shared "validate body + extract message/uid + mint transactionId" prelude.
 * Returns null on validation failure (after delegating to next() with a
 * ValidationError), or `{ transactionId, message, uid }` on success.
 *
 * Both POST handlers begin with this same dance, so centralising avoids
 * the duplication that SonarQube flags on the route module.
 */
function prepareAtlasRequest(req, _res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new ValidationError(
      errors.array()[0].msg,
      errors.array().map((e) => ({ field: e.path, message: e.msg }))
    ));
    return null;
  }
  return {
    transactionId: crypto.randomUUID(),
    message:       req.body.message,
    model:         req.body.model || DEFAULT_GEMINI_MODEL_KEY,
    uid:           req.user.uid,
  };
}

// ── POST /api/atlas/ask ──────────────────────────────────────────────────────
router.post('/atlas/ask',
  requireAuth,
  atlasLimiter,
  validateAsk,
  async (req, res, next) => {
    const ctx = prepareAtlasRequest(req, res, next);
    if (!ctx) return undefined;
    const { transactionId, message, model, uid } = ctx;

    try {
      const history = await loadServerHistory(uid);
      const { answer, usage } = await ask({ message, history, model });

      // Fire-and-forget persistence — we already have the answer; the
      // user shouldn't wait on Firestore to see it.
      persistTurns(uid, message, answer);

      console.log('[atlas]', {
        transactionId, uid,
        msgLen:        message.length,
        historyTurns:  history.length,
        answerLen:     answer.length,
        model:         usage && usage.model,
        usage,
      });

      return res.status(200).json({ success: true, answer, usage, transactionId });
    } catch (err) {
      return next(err);
    }
  }
);

// ── POST /api/atlas/stream (SSE) ────────────────────────────────────────────
//
// SSE notes:
//   - We hand-write the format ("data: {json}\n\n") rather than using a
//     library — Express has no first-class SSE support and the protocol
//     is simple enough.
//   - `X-Accel-Buffering: no` tells any nginx/Cloud-Front-style proxy
//     not to buffer the response; chunks need to flush immediately.
//   - On error mid-stream we emit a final `error` event since HTTP status
//     codes are already locked in once we begin streaming.
//
router.post('/atlas/stream',
  requireAuth,
  atlasLimiter,
  validateAsk,
  async (req, res, next) => {
    const ctx = prepareAtlasRequest(req, res, next);
    if (!ctx) return undefined;
    const { transactionId, message, model, uid } = ctx;

    // Open the SSE stream.
    res.status(200).set({
      'Content-Type':       'text/event-stream; charset=utf-8',
      'Cache-Control':      'no-cache, no-transform',
      'Connection':         'keep-alive',
      'X-Accel-Buffering':  'no',
    });
    res.flushHeaders && res.flushHeaders();

    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

    let finalAnswer = '';
    let usage = null;
    let aborted = false;
    req.on('close', () => { aborted = true; });

    try {
      const history = await loadServerHistory(uid);
      for await (const evt of askStream({ message, history, model })) {
        if (aborted) break;
        if (evt.kind === 'chunk') {
          send({ chunk: evt.text });
        } else if (evt.kind === 'done') {
          finalAnswer = evt.text;
          usage = evt.usage;
          send({ done: finalAnswer, usage, transactionId });
        }
      }

      if (!aborted && finalAnswer) persistTurns(uid, message, finalAnswer);

      console.log('[atlas/stream]', {
        transactionId, uid,
        msgLen:    message.length,
        answerLen: finalAnswer.length,
        model:     usage && usage.model,
        usage,
        aborted,
      });
    } catch (err) {
      // User-input errors (400/422) carry isOperational=true and a clean
      // user-facing message. Upstream / internal errors get a generic
      // bubble — never surface raw Gemini JSON or stack traces to the
      // visitor; log them server-side for debugging.
      const code        = err.code || 'INTERNAL_ERROR';
      const isUserError = err.isOperational && err.statusCode && err.statusCode < 500;
      const safeMessage = isUserError
        ? err.message
        : 'Atlas is having trouble responding right now. Please try again in a moment.';
      send({ error: safeMessage, code, transactionId });
      console.error('[atlas/stream] error:', {
        transactionId,
        code,
        statusCode: err.statusCode,
        message:    err.message,
        upstream:   err.upstream,
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
    return undefined;
  }
);

// ── GET /api/atlas/conversations/active ─────────────────────────────────────
router.get('/atlas/conversations/active',
  requireAuth,
  async (req, res, next) => {
    try {
      const conv = await firestore.getActiveAtlasConversation(req.user.uid);
      return res.status(200).json({
        success:      true,
        conversation: conv,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ── DELETE /api/atlas/conversations/active ──────────────────────────────────
router.delete('/atlas/conversations/active',
  requireAuth,
  async (req, res, next) => {
    try {
      await firestore.clearActiveAtlasConversation(req.user.uid);
      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
