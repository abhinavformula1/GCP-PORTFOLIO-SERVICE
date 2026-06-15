'use strict';

const config = require('../config');

// Gemini API version: `/v1beta/`.
//
// We were on `/v1/` and it broke in production with:
//   "Invalid JSON payload received. Unknown name \"systemInstruction\":
//    Cannot find field."
//
// The `systemInstruction` field on the gemini-2.5-flash family is only
// supported by the `/v1beta/` endpoint — the stable `/v1/` predates the
// system-prompt feature. Google's official docs and quickstarts for
// gemini-2.5-flash all use `/v1beta/`, so we mirror that here for both
// the single-shot and streaming endpoints (consistent error surface).
const GEMINI_FLASH_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_FLASH_STREAM_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent';

/* ── Shared helpers (used by both single-shot and streaming paths) ─────── */

function requireApiKey() {
  if (!config.gemini.apiKey) {
    const err = new Error('Gemini is not configured (GEMINI_API_KEY missing).');
    err.code = 'GEMINI_DISABLED';
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
}

/** Build the Gemini request body shared by both endpoints. */
function buildChatBody({ systemPrompt, history = [], userMessage, generationConfig }) {
  if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    throw new Error('systemPrompt is required.');
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    throw new Error('userMessage is required.');
  }
  const contents = history
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  return {
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: Object.assign(
      { temperature: 0.6, topP: 0.9, maxOutputTokens: 600 },
      generationConfig || {}
    ),
  };
}

/**
 * Inspect a candidate's finishReason and throw a typed error for the
 * blocking ones. Non-fatal reasons (MAX_TOKENS / RECITATION / null /
 * STOP) fall through silently so callers can use any partial text.
 */
function checkFinishReason(candidate) {
  if (!candidate || !candidate.finishReason || candidate.finishReason === 'STOP') return;
  const reason = candidate.finishReason;
  if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') {
    const err = new Error('Response was blocked by safety filters.');
    err.code = 'SAFETY_BLOCKED';
    err.statusCode = 422;
    err.isOperational = true;
    throw err;
  }
}

/** POST to Gemini with a timeout. Returns the raw `Response`. */
async function fetchGemini(url, body, timeoutMs) {
  requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}?key=${config.gemini.apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Low-level non-streaming Gemini call. URL + key + body + error handling
 * + candidate unwrapping.
 *
 * @param {object} body
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]
 * @returns {Promise<string>}  Trimmed text. May be ''.
 */
async function callGemini(body, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 15000;
  const res = await fetchGemini(GEMINI_FLASH_URL, body, timeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // The full upstream body is preserved in `err.upstream` for server
    // logs, but `err.message` stays generic so the route layer can show
    // a clean user-facing string. `isOperational` remains false for
    // upstream 5xx-style failures — see the route for how that's
    // distinguished from user-input errors (which set isOperational=true).
    const err = new Error(`Gemini API upstream error ${res.status}.`);
    err.statusCode = 502;
    err.code = 'UPSTREAM_ERROR';
    err.upstream = text.slice(0, 500);
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  checkFinishReason(candidate);
  return (candidate?.content?.parts?.[0]?.text || '').trim();
}

/**
 * Calls Gemini Flash to generate a 2-sentence professional meeting summary.
 * @param {object} answers - { name, company, role, contractType, urgency, slot }
 * @returns {Promise<string>} summary text
 */
async function summariseConversation(answers) {
  const { name, company, role, contractType, urgency, slot } = answers;

  const prompt = `You are writing a professional meeting confirmation summary.
Given the following hiring inquiry details:
- Name: ${name}
- Company: ${company}
- Role: ${role}
- Position type: ${contractType}
- Hiring urgency: ${urgency}
- Scheduled slot: ${slot}

Write exactly 2 concise professional sentences confirming the meeting and summarising the hiring intent.
No filler phrases, no emojis, no bullet points. Plain text only.`;

  return callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
  });
}

/**
 * Multi-turn chat completion against Gemini Flash.
 *
 * Maps a (systemPrompt, history[], userMessage) tuple to Gemini's
 * `systemInstruction` + `contents` format. History is the prior turns
 * (oldest→newest); the latest user message is appended last.
 *
 * @param {object}   args
 * @param {string}   args.systemPrompt   Fixed persona / knowledge-base prompt.
 * @param {Array<{role:'user'|'model', text:string}>} [args.history=[]]
 *                                       Prior turns. Roles must alternate.
 * @param {string}   args.userMessage    The current user turn.
 * @param {object}   [args.generationConfig]  Override defaults (temperature etc.)
 * @returns {Promise<string>}            Trimmed model reply.
 */
async function generateChatResponse(args) {
  return callGemini(buildChatBody(args || {}));
}

/**
 * Streaming variant of generateChatResponse(). Returns an async generator
 * that yields text chunks (delta tokens) as they arrive from Gemini.
 *
 * Usage:
 *   for await (const chunk of generateChatResponseStream({...})) {
 *     // chunk is a (small) string of new tokens; concat to build the reply
 *   }
 *
 * The HTTP layer (route) is expected to forward each chunk to the client
 * over Server-Sent Events. Aborting the consumer (early return / break)
 * will cancel the upstream fetch via AbortController.
 *
 * @param {object}   args              same shape as generateChatResponse()
 * @param {number}   [opts.timeoutMs=30000]  total wall-clock cap (default 30s)
 * @returns {AsyncGenerator<string>}
 */
async function* generateChatResponseStream(args, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 30000;
  const body = buildChatBody(args || {});

  // streamGenerateContent uses the same endpoint shape as generateContent
  // but with `?alt=sse` for SSE-formatted output. We can't reuse fetchGemini
  // here because it doesn't expose the alt= param, so the call is open-coded
  // — but key validation, timer, and abort wiring all match.
  requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${GEMINI_FLASH_STREAM_URL}?alt=sse&key=${config.gemini.apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    const e = new Error(`Gemini stream upstream error ${res.status}.`);
    e.statusCode = 502;
    e.code = 'UPSTREAM_ERROR';
    e.upstream = text.slice(0, 500);
    throw e;
  }

  // Gemini's SSE format is `data: {json}\n\n` per chunk. We consume the
  // ReadableStream byte-by-byte, split on `\n\n`, parse each `data:` line.
  // Done is signalled by the upstream closing the connection.
  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);

        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

        const candidate = parsed.candidates && parsed.candidates[0];
        checkFinishReason(candidate);

        const delta = candidate?.content?.parts?.[0]?.text;
        if (delta) yield delta;
      }
    }
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch (_) { /* already released */ }
  }
}

module.exports = { summariseConversation, generateChatResponse, generateChatResponseStream };
