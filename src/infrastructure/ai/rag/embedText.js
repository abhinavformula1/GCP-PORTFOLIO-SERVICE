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
 * Uses Google's embedding models via the Gemini v1beta endpoint.
 * Model + output dimensionality are provided at runtime from Atlas config.
 */

const config = require('../../config');

const EMBED_API_BASE   = 'https://generativelanguage.googleapis.com/v1beta/models';
const EMBED_TIMEOUT_MS = 10_000;
const MAX_TEXT_CHARS   = 8_000; // stay well within the 2 048-token model limit

const DEFAULT_MODEL  = 'gemini-embedding-2';
const FALLBACK_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMS  = 768;

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.trunc(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeModel(model) {
  const raw = String(model || '').trim();
  if (!raw) return '';
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

async function callEmbed({ model, dims, text, signal }) {
  return await fetch(
    `${EMBED_API_BASE}/${encodeURIComponent(model)}:embedContent?key=${config.gemini.apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        model:               `models/${model}`,
        content:             { parts: [{ text }] },
        // Firestore vector fields cap at 2048 dimensions.
        outputDimensionality: dims,
      }),
      signal,
    }
  );
}

/**
 * Convert a string into a dense vector embedding.
 *
 * @param {string} text  Plain text to embed (will be trimmed + capped).
 * @param {{ model?: string, outputDimensionality?: number }} [opts]
 * @returns {Promise<number[]>}  Dense float vector (dims depend on model/options).
 * @throws {Error}  If the API key is absent or the upstream call fails.
 */
async function embedText(text, opts) {
  if (!config.gemini.apiKey) {
    const err = new Error('Gemini API key missing — embedText is disabled.');
    err.code          = 'EMBED_DISABLED';
    err.statusCode    = 503;
    err.isOperational = true;
    throw err;
  }

  const model = normalizeModel(opts && opts.model ? opts.model : DEFAULT_MODEL) || DEFAULT_MODEL;
  const dims  = clampInt(opts && opts.outputDimensionality != null ? opts.outputDimensionality : DEFAULT_DIMS, 1, 2048) || DEFAULT_DIMS;

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
    res = await callEmbed({ model, dims, text: safeText, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const upstream = await res.text().catch(() => '');

    // Some API keys don't have access to older model names (e.g. text-embedding-004).
    // If the chosen model 404s, transparently fall back to a known-good embedding model.
    if (res.status === 404 && model !== FALLBACK_MODEL) {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), EMBED_TIMEOUT_MS);
      try {
        const retry = await callEmbed({ model: FALLBACK_MODEL, dims, text: safeText, signal: controller2.signal });
        if (retry.ok) {
          const data2 = await retry.json();
          const values2 = data2?.embedding?.values;
          if (Array.isArray(values2) && values2.length) return values2;
        }
      } finally {
        clearTimeout(timer2);
      }
    }

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
