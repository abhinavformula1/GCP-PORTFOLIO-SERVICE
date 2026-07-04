'use strict';

/**
 * Embedding service.
 *
 * SOLID:
 *   S — One job: convert a string into a dense float vector.
 *   O — Swap the model or endpoint by injecting a different embedder function;
 *       nothing here needs to change.
 *   L — Contract: (text: string) => Promise<number[]>.  Any function satisfying
 *       this signature is a valid drop-in replacement.
 *
 * Uses Google's text-embedding-004 model via the Gemini v1beta endpoint.
 * The returned vector has 768 dimensions and is suitable for cosine similarity.
 */

const config = require('../../config');

const EMBED_API_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBED_MODEL      = 'gemini-embedding-001';
const EMBED_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS   = 8_000; // stay well within the 2 048-token model limit

/**
 * Convert a string into a dense vector embedding.
 *
 * @param {string} text  Plain text to embed (will be trimmed + capped).
 * @returns {Promise<number[]>}  768-dimensional float vector.
 * @throws {Error}  If the API key is absent or the upstream call fails.
 */
async function embedText(text) {
  if (!config.gemini.apiKey) {
    const err = new Error('Gemini API key missing — embedText is disabled.');
    err.code          = 'EMBED_DISABLED';
    err.statusCode    = 503;
    err.isOperational = true;
    throw err;
  }

  const safeText = String(text || '').trim().slice(0, MAX_TEXT_CHARS);
  if (!safeText) {
    throw Object.assign(new Error('embedText: text must not be empty.'), {
      code: 'EMBED_EMPTY_TEXT', statusCode: 400, isOperational: true,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(
      `${EMBED_API_BASE}/${EMBED_MODEL}:embedContent?key=${config.gemini.apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model:             `models/${EMBED_MODEL}`,
          content:           { parts: [{ text: safeText }] },
          // Reduce from 3072 → 768 dims — stays well within Firestore's
          // 2048-dimension limit while retaining high semantic quality.
          outputDimensionality: 768,
        }),
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const upstream = await res.text().catch(() => '');
    const err = new Error(`Gemini embed API error ${res.status}.`);
    err.code       = 'EMBED_UPSTREAM_ERROR';
    err.statusCode = 502;
    err.upstream   = upstream.slice(0, 500);
    throw err;
  }

  const data   = await res.json();
  const values = data?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Embed API returned an empty or malformed vector.');
  }

  return values;
}

module.exports = { embedText };
