'use strict';

const config = require('../config');

const GEMINI_FLASH_URL =
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent';
const GEMINI_FLASH_STREAM_URL =
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:streamGenerateContent';

/**
 * Low-level Gemini call. Centralises:
 *   - URL + API-key handling
 *   - HTTP error → thrown Error with body
 *   - response shape unwrapping (candidates[0].content.parts[0].text)
 *
 * @param {object} body            Gemini request body (contents, systemInstruction, generationConfig)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000]  Abort the request after this many ms.
 * @returns {Promise<string>}      The model's text reply (trimmed). May be ''.
 */
async function callGemini(body, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 15000;

  if (!config.gemini.apiKey) {
    const err = new Error('Gemini is not configured (GEMINI_API_KEY missing).');
    err.code = 'GEMINI_DISABLED';
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${GEMINI_FLASH_URL}?key=${config.gemini.apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini API error ${res.status}: ${text.slice(0, 500)}`);
    err.statusCode = 502;
    err.isOperational = true;
    throw err;
  }

  const data = await res.json();
  // The block reasons live at candidates[0].finishReason — surface them as
  // a clean, user-safe error so callers can show a helpful message instead
  // of falling through to an empty response.
  const candidate = data.candidates && data.candidates[0];
  if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
    const reason = candidate.finishReason;
    if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') {
      const err = new Error('Response was blocked by safety filters.');
      err.code = 'SAFETY_BLOCKED';
      err.statusCode = 422;
      err.isOperational = true;
      throw err;
    }
    // MAX_TOKENS / RECITATION etc. are non-fatal — fall through to the
    // partial text below.
  }
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
  const { systemPrompt, history = [], userMessage, generationConfig } = args;

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

  return callGemini({
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: Object.assign(
      {
        temperature:     0.6,
        topP:            0.9,
        maxOutputTokens: 600,
      },
      generationConfig || {}
    ),
  });
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
  const { systemPrompt, history = [], userMessage, generationConfig } = args || {};
  const timeoutMs = (opts && opts.timeoutMs) || 30000;

  if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
    throw new Error('systemPrompt is required.');
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    throw new Error('userMessage is required.');
  }
  if (!config.gemini.apiKey) {
    const err = new Error('Gemini is not configured (GEMINI_API_KEY missing).');
    err.code = 'GEMINI_DISABLED';
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }

  const contents = history
    .filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const body = {
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: Object.assign(
      { temperature: 0.6, topP: 0.9, maxOutputTokens: 600 },
      generationConfig || {}
    ),
  };

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
    const e = new Error(`Gemini stream error ${res.status}: ${text.slice(0, 500)}`);
    e.statusCode = 502;
    e.isOperational = true;
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

      // Process complete events delimited by blank line (\n\n).
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

        // Block reasons → stop early with a typed error so the route
        // can show a safe message.
        const candidate = parsed.candidates && parsed.candidates[0];
        if (candidate && candidate.finishReason && candidate.finishReason !== 'STOP') {
          const reason = candidate.finishReason;
          if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') {
            const err = new Error('Response was blocked by safety filters.');
            err.code = 'SAFETY_BLOCKED';
            err.statusCode = 422;
            err.isOperational = true;
            throw err;
          }
          // MAX_TOKENS / RECITATION etc. — yield any partial text and stop.
        }

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
