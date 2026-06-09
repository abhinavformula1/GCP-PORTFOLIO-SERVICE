'use strict';

/**
 * Atlas response orchestrator.
 *
 * One job: given a conversation history and the current user message,
 * call Gemini Flash with the persona system prompt and return a clean
 * answer. Sandwiches the LLM call with:
 *   - Input normalisation (trim, length cap, role validation)
 *   - History truncation (keep the last N turns to bound prompt size)
 *   - Output sanitisation (strip stray system-prompt leaks)
 *
 * The route layer (src/routes/atlas.js) handles auth, rate limiting,
 * and HTTP shaping. This module is pure orchestration.
 */

const { generateChatResponse, generateChatResponseStream } = require('../gemini');
const { SYSTEM_PROMPT }                                     = require('./persona');

const MAX_USER_MSG_CHARS  = 1000;
const MAX_HISTORY_TURNS   = 10;
const MAX_REPLY_CHARS     = 4000;

/**
 * Trim history to the last N turns, ensuring the first kept turn is a
 * 'user' message (Gemini requires the conversation to start with a user
 * turn after the system instruction).
 */
function truncateHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  const tail = history.slice(-MAX_HISTORY_TURNS);
  // Drop any leading 'model' turns so the first item is 'user'.
  while (tail.length && tail[0].role !== 'user') {
    tail.shift();
  }
  return tail;
}

/**
 * Normalise + validate a single message. Returns null if invalid.
 */
function normaliseTurn(turn) {
  if (!turn || typeof turn !== 'object') return null;
  const role = turn.role === 'model' || turn.role === 'user' ? turn.role : null;
  const text = typeof turn.text === 'string' ? turn.text.trim() : '';
  if (!role || !text) return null;
  return { role, text: text.slice(0, MAX_USER_MSG_CHARS) };
}

/**
 * Strip a few rough edges from the model's reply:
 *   - Lead/trailing whitespace
 *   - Stray "Atlas:" prefix the model occasionally adds
 *   - Cap at MAX_REPLY_CHARS so a runaway response can't blow past UI limits
 */
function sanitiseReply(text) {
  let out = (text || '').trim();
  out = out.replace(/^Atlas[:\s-]+/i, '').trim();
  if (out.length > MAX_REPLY_CHARS) {
    out = out.slice(0, MAX_REPLY_CHARS - 1) + '…';
  }
  return out;
}

/**
 * Tag-and-throw helper for the validation errors thrown from below.
 * Centralised so we get consistent shape (code/statusCode/isOperational)
 * and avoid open-coding the same error envelope twice.
 */
function inputError(message) {
  const err = new Error(message);
  err.code = 'INVALID_INPUT';
  err.statusCode = 400;
  err.isOperational = true;
  return err;
}

/**
 * Validate + normalise a request: trims the user message, enforces
 * length, builds a clean history. Throws on bad input. Both ask() and
 * askStream() are thin wrappers around this + a Gemini call, so this
 * keeps the validation logic in one place.
 */
function prepareCall(args) {
  const message = (args && typeof args.message === 'string') ? args.message.trim() : '';
  if (!message) {
    throw inputError('Message is empty.');
  }
  if (message.length > MAX_USER_MSG_CHARS) {
    throw inputError(`Message must be ${MAX_USER_MSG_CHARS} characters or fewer.`);
  }
  const history = truncateHistory(
    ((args && args.history) || []).map(normaliseTurn).filter(Boolean)
  );
  return { systemPrompt: SYSTEM_PROMPT, history, userMessage: message };
}

/**
 * Generate Atlas's reply (single-shot).
 *
 * @param {object} args
 * @param {string} args.message    User's current message (required, ≤1000 chars after trim).
 * @param {Array<{role:'user'|'model', text:string}>} [args.history=[]]
 * @returns {Promise<{answer:string}>}
 */
async function ask(args) {
  const call = prepareCall(args);
  const text = await generateChatResponse(call);
  return { answer: sanitiseReply(text) };
}

/**
 * Streaming variant of ask(). Yields:
 *   { kind: 'chunk', text: string }   for each delta
 *   { kind: 'done',  text: string }   once at the end with the final
 *                                     sanitised reply (so callers don't
 *                                     have to concat themselves).
 *
 * @returns {AsyncGenerator<{kind:'chunk'|'done', text:string}>}
 */
async function* askStream(args) {
  const call = prepareCall(args);
  let acc = '';
  for await (const delta of generateChatResponseStream(call)) {
    acc += delta;
    yield { kind: 'chunk', text: delta };
  }
  yield { kind: 'done', text: sanitiseReply(acc) };
}

module.exports = {
  ask,
  askStream,
  // Exported for tests / external observers.
  MAX_USER_MSG_CHARS,
  MAX_HISTORY_TURNS,
};
