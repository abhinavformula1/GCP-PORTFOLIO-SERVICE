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
 *     synchronously after a successful LLM call. Failures to persist
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
const config                     = require('../config');
const {
  ask, askStream, MAX_USER_MSG_CHARS, MAX_HISTORY_TURNS, LLM_MODELS,
  DEFAULT_LLM_MODEL_KEY,
} = require('../services/atlas/respond');
const atlasRepository     = require('../repositories/atlasRepository');
const adminConfig         = require('../services/adminConfig');
const {
  buildExecutionPlan,
  loadRuntimeConfig,
  buildCallConfig,
} = require('../services/atlas/orchestrator');
const {
  setLangSmithRuntimeEnabled,
  setLangSmithCapturePolicy,
} = require('../services/observability/langsmith');
const { ValidationError } = require('../errors');

const router = express.Router();
const MODEL_KEYS = Object.keys(LLM_MODELS);
const ATLAS_PERSONA_VERSION = '2026-06-15';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHEABLE_QUESTIONS = new Set([
  'is abhinav available for a senior staff salesforce role',
  'tell me about his most recent project at salesforce',
  'which industries has he delivered to',
  'how many years of cpq experience does he have',
  'how can i get in touch',
  'how can i reach him',
  'how does this portfolio integrate salesforce with gcp',
  'what design patterns does abhinav use for apex callouts',
  'whats his experience with omnistudio',
  'has he worked on event driven architectures',
  'which gcp services does he use day to day',
  'give me a 30 second pitch on abhinav',
  'whats his strongest area',
  'what certifications does he hold',
  'what kind of role is he looking for next',
  'does he know lwc',
]);

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
    const conv = await atlasRepository.getActiveConversation(uid);
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
async function persistTurns(uid, userText, botText, usage) {
  try {
    await atlasRepository.appendTurn(uid, { role: 'user',  text: userText });
    await atlasRepository.appendTurn(uid, { role: 'model', text: botText, usage });
    if (!usage || !usage.cached) await atlasRepository.appendUsageEvent(uid, usage);
  } catch (err) {
    console.warn('[atlas] persistTurns failed:', err.message);
  }
}

function normaliseCacheQuestion(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cacheKeyFor({ message, model, history }) {
  if (Array.isArray(history) && history.length > 0) return null;
  const normalizedQuestion = normaliseCacheQuestion(message);
  if (!CACHEABLE_QUESTIONS.has(normalizedQuestion)) return null;
  const raw = [ATLAS_PERSONA_VERSION, model, normalizedQuestion].join('|');
  return {
    key: crypto.createHash('sha256').update(raw).digest('hex'),
    normalizedQuestion,
  };
}

function cachedUsage(model) {
  const modelInfo = LLM_MODELS[model] || LLM_MODELS[DEFAULT_LLM_MODEL_KEY];
  return {
    model:        modelInfo.providerModelId || modelInfo.key,
    modelLabel:   modelInfo.label,
    inputTokens:  0,
    outputTokens: 0,
    totalTokens:  0,
    estimatedUsd: 0,
    estimatedInr: 0,
    cached:       true,
  };
}

async function readCachedAnswer(cacheRef) {
  if (!cacheRef) return null;
  try {
    return await atlasRepository.getCacheEntry(cacheRef.key);
  } catch (err) {
    console.warn('[atlas] cache read failed:', err.message);
    return null;
  }
}

async function saveCachedAnswer(cacheRef, { model, answer }) {
  if (!cacheRef || !answer) return;
  try {
    await atlasRepository.saveCacheEntry(cacheRef.key, {
      normalizedQuestion: cacheRef.normalizedQuestion,
      model,
      personaVersion: ATLAS_PERSONA_VERSION,
      answer,
      expiresAtMs: Date.now() + CACHE_TTL_MS,
    });
  } catch (err) {
    console.warn('[atlas] cache write failed:', err.message);
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

function atlasEnabledModels(atlasCfg) {
  const models = Array.isArray(atlasCfg && atlasCfg.enabledModels)
    ? atlasCfg.enabledModels.filter(function (key) { return !!LLM_MODELS[key]; })
    : [];
  return models.length ? models : [DEFAULT_LLM_MODEL_KEY];
}

function resolveAtlasModel(requestedModel, atlasCfg) {
  const enabledModels = atlasEnabledModels(atlasCfg);
  const configuredDefault = enabledModels.includes(atlasCfg && atlasCfg.defaultModel)
    ? atlasCfg.defaultModel
    : (enabledModels[0] || DEFAULT_LLM_MODEL_KEY);
  if (atlasCfg && atlasCfg.modelSelectorVisible === false) return configuredDefault;
  if (requestedModel && enabledModels.includes(requestedModel)) return requestedModel;
  return configuredDefault;
}

function resolveAtlasFallbackModel(primaryModel, atlasCfg) {
  const candidates = [
    atlasCfg && atlasCfg.routingFallbackModel,
    atlasCfg && atlasCfg.fallbackModel,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate !== primaryModel && LLM_MODELS[candidate]) {
      return candidate;
    }
  }
  return '';
}

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
    model:         req.body.model || DEFAULT_LLM_MODEL_KEY,
    uid:           req.user.uid,
  };
}

function sourceDomain(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function titleCaseWords(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function publisherLabelFromSource(source) {
  const title = String(source && source.title || '').trim();
  const url = String(source && source.url || '').trim();
  const host = sourceDomain(url).toLowerCase();

  // Prefer a publisher label over platform domains (e.g., YouTube).
  if (/\btoday show\b/i.test(title)) return 'TODAY Show';
  if (/\beuronews\b/i.test(title) || host.includes('euronews.com')) return 'Euronews';
  if (/\babc news\b/i.test(title) || host.includes('abcnews.go.com')) return 'ABC News';
  if (/\bcbs news\b/i.test(title) || host.includes('cbsnews.com')) return 'CBS News';
  if (/\bap news\b/i.test(title)  || host.includes('apnews.com')) return 'AP News';
  if (/\b(pbs news hour|pbs newshour)\b/i.test(title) || host.includes('pbs.org')) return 'PBS News Hour';
  if (/\bal jazeera\b/i.test(title)) return 'Al Jazeera';
  if (/\bwashington post\b/i.test(title) || host.includes('washingtonpost.com')) return 'The Washington Post';

  // Domain-derived fallback.
  const base = host.split('.').filter(Boolean);
  const guess = base.length >= 2 ? base[base.length - 2] : host;
  return titleCaseWords(guess || 'Source') || 'Source';
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .filter((w) => w.length >= 4);
}

function bestSourceForLine(line, sources) {
  const words = new Set(tokenize(line));
  if (!words.size) return null;
  let best = null;
  let bestScore = -1;

  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    const titleWords = tokenize(s.title);
    let overlap = 0;
    for (const w of titleWords) if (words.has(w)) overlap++;
    const score = overlap * 10 + (typeof s.score === 'number' ? s.score : 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function looksLikeSourceCitation(textInsideParens) {
  const raw = String(textInsideParens || '').trim();
  if (!raw) return false;
  // Avoid stripping legitimate content like "(2019)" / "(₹500)".
  if (/\d/.test(raw)) return false;
  const t = raw.toLowerCase();
  if (t.includes(',')) return true;
  if (t.includes('http')) return true;
  if (/(instagram|facebook|youtube|twitter|x\.com)/i.test(t)) return true;
  // Single hostname-ish token (e.g. independent.co.uk)
  if (/^[a-z0-9.-]+$/i.test(raw) && raw.includes('.') && !raw.includes(' ')) return true;
  // Short publisher-style label (e.g. "AP News", "Euronews")
  if (raw.length <= 28 && /^[A-Za-z][A-Za-z\s.&-]{2,}$/.test(raw)) return true;
  return false;
}

function stripTrailingSourceCitation(text) {
  const s = String(text || '');
  const m = s.match(/\s*\(([^)]+)\)\s*[.!?]?\s*$/);
  if (!m) return s;
  return looksLikeSourceCitation(m[1])
    ? s.replace(/\s*\([^)]+\)\s*[.!?]?\s*$/, '').trim()
    : s;
}

function stripInlineSourceCitations(text) {
  let out = String(text || '');
  if (!out || out.indexOf('(') === -1) return out;

  out = out.replace(/\(([^)]+)\)/g, function (m, inside) {
    return looksLikeSourceCitation(inside) ? '' : m;
  });

  // Clean up spacing/punctuation left behind by removals.
  out = out
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\s*\./g, '$1')
    .replace(/\s+[·•]\s+$/g, '')
    .trim();
  return out;
}

function isPlatformSource(source) {
  const url = String(source && source.url || '').trim();
  const host = sourceDomain(url).toLowerCase();
  if (!host) return false;
  return (
    host.includes('youtube.com')
    || host.includes('youtu.be')
    || host.includes('instagram.com')
    || host.includes('facebook.com')
    || host === 'x.com'
    || host.endsWith('.x.com')
    || host.includes('twitter.com')
    || host.includes('news.google.com')
  );
}

function preferPublisherSources(sources) {
  const arr = Array.isArray(sources) ? sources : [];
  const nonPlatform = arr.filter((s) => !isPlatformSource(s));
  return nonPlatform.length ? nonPlatform : arr;
}

function isLikelyHeadlinesQuery(userMessage) {
  const t = String(userMessage || '').toLowerCase();
  if (!t) return false;
  return /\b(today|todays|latest|top)\b/.test(t) && /\b(news|headlines)\b/.test(t);
}

function formatIstTimestamp(now) {
  try {
    const d = now instanceof Date ? now : new Date();
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
    return date + ', ' + time + ' IST';
  } catch (_) {
    return '';
  }
}

function prependHeadlinesHeadingIfNeeded(answer, userMessage, webSearch) {
  const base = String(answer || '').trim();
  const hasWeb = !!(webSearch && Array.isArray(webSearch.sources) && webSearch.sources.length);
  if (!base || !hasWeb) return base;

  const lines = base.split('\n').map((l) => String(l || ''));
  const bulletCount = lines.filter((l) => /^\s*[-*•]\s+/.test(l)).length;
  if (bulletCount < 2) return base;
  if (!isLikelyHeadlinesQuery(userMessage)) return base;

  // Remove any existing generic heading line like "Here's some of the latest news…"
  let startIdx = 0;
  while (startIdx < lines.length && !lines[startIdx].trim()) startIdx++;
  if (startIdx < lines.length && !/^\s*[-*•]\s+/.test(lines[startIdx])) {
    // Drop the first non-bullet line if it looks like a heading.
    startIdx++;
    while (startIdx < lines.length && !lines[startIdx].trim()) startIdx++;
  }
  const rest = lines.slice(startIdx).join('\n').trim();

  const ts = formatIstTimestamp(new Date());
  const heading = "Here are today's top headlines" + (ts ? ' (' + ts + '):' : ':');
  return heading + '\n\n' + rest;
}

function appendSourcesPerBullet(answer, webSearch) {
  const base = String(answer || '').trim();
  const sources = webSearch && Array.isArray(webSearch.sources) ? webSearch.sources : [];
  if (!base || !sources.length) return base;

  const preferredSources = preferPublisherSources(sources);
  const lines = base.split('\n');
  let srcIdx = 0;

  const out = lines.map(function (ln) {
    const line = String(ln || '');
    const m = line.match(/^(\s*[-*•]\s+)(.+)$/);
    if (!m) return line;
    const prefix = m[1];
    const body0 = m[2];
    // Always prefer exactly one source label per bullet.
    const body1 = stripInlineSourceCitations(body0);
    const body = stripTrailingSourceCitation(body1) || stripTrailingSourceCitation(body0);

    // Try to pick the best matching source by title overlap; fall back to round-robin.
    const picked = bestSourceForLine(body, preferredSources) || preferredSources[srcIdx++ % preferredSources.length];
    const label = publisherLabelFromSource(picked);
    return prefix + body.trim() + ' (' + label + ')';
  });

  return out.join('\n');
}

function toPublicPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    executionMode: String(plan.executionMode || ''),
    strategy:      String(plan.strategy || ''),
    useRag:        !!plan.useRag,
    useWebSearch:  !!plan.useWebSearch,
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
      const atlasCfg = await loadRuntimeConfig();
      setLangSmithRuntimeEnabled(!!(atlasCfg && atlasCfg.langsmithTracingEnabled));
      setLangSmithCapturePolicy({
        capturePrompts: atlasCfg && atlasCfg.capturePrompts,
        captureChunks:  atlasCfg && atlasCfg.captureChunks,
        captureTokens:  atlasCfg && atlasCfg.captureTokens,
      });
      const resolvedModel = resolveAtlasModel(model, atlasCfg);
      const fallbackModel = resolveAtlasFallbackModel(resolvedModel, atlasCfg);
      const executionPlan = buildExecutionPlan(message, atlasCfg);
      const cacheRef = executionPlan.useWebSearch
        ? null
        : cacheKeyFor({ message, model: resolvedModel, history });
      const cached = await readCachedAnswer(cacheRef);
      if (cached && cached.answer) {
        const usage = cachedUsage(resolvedModel);
        persistTurns(uid, message, cached.answer, usage);
        console.log('[atlas/cache]', { transactionId, uid, model: usage.model });
        return res.status(200).json({
          success: true,
          answer: cached.answer,
          usage,
          cached: true,
          transactionId,
          webSearch: null,
          plan: toPublicPlan(executionPlan),
        });
      }

      const { systemPrompt, generationConfig, webSearch } = await buildCallConfig(message, atlasCfg, executionPlan);
      const { answer, usage, routing } = await ask({ message, history, model: resolvedModel, fallbackModel, systemPrompt, generationConfig });
      const withSources = appendSourcesPerBullet(answer, webSearch);
      const finalAnswer = prependHeadlinesHeadingIfNeeded(withSources, message, webSearch);

      // Fire-and-forget persistence — we already have the answer; the
      // user shouldn't wait on Firestore to see it.
      persistTurns(uid, message, finalAnswer, usage);
      saveCachedAnswer(cacheRef, { model: resolvedModel, answer });

      console.log('[atlas]', {
        transactionId, uid,
        msgLen:        message.length,
        historyTurns:  history.length,
        answerLen:     finalAnswer.length,
        model:         usage && usage.model,
        usage,
        webSearchUsed: !!webSearch,
      });

      return res.status(200).json({
        success: true,
        answer: finalAnswer,
        usage,
        cached: false,
        transactionId,
        webSearch,
        routing,
        plan: toPublicPlan(executionPlan),
      });
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
      const atlasCfg = await loadRuntimeConfig();
      setLangSmithRuntimeEnabled(!!(atlasCfg && atlasCfg.langsmithTracingEnabled));
      setLangSmithCapturePolicy({
        capturePrompts: atlasCfg && atlasCfg.capturePrompts,
        captureChunks:  atlasCfg && atlasCfg.captureChunks,
        captureTokens:  atlasCfg && atlasCfg.captureTokens,
      });
      const resolvedModel = resolveAtlasModel(model, atlasCfg);
      const fallbackModel = resolveAtlasFallbackModel(resolvedModel, atlasCfg);
      const executionPlan = buildExecutionPlan(message, atlasCfg);
      const cacheRef = executionPlan.useWebSearch
        ? null
        : cacheKeyFor({ message, model: resolvedModel, history });
      const cached = await readCachedAnswer(cacheRef);
      if (cached && cached.answer) {
        finalAnswer = cached.answer;
        usage = cachedUsage(resolvedModel);
        send({ done: finalAnswer, usage, cached: true, transactionId, webSearch: null, plan: toPublicPlan(executionPlan) });
        persistTurns(uid, message, finalAnswer, usage);
        console.log('[atlas/stream/cache]', { transactionId, uid, model: usage.model });
        return undefined;
      }

      const { systemPrompt, generationConfig, webSearch } = await buildCallConfig(message, atlasCfg, executionPlan);
      for await (const evt of askStream({ message, history, model: resolvedModel, fallbackModel, systemPrompt, generationConfig })) {
        if (aborted) break;
        if (evt.kind === 'chunk') {
          send({ chunk: evt.text });
        } else if (evt.kind === 'done') {
          const withSources = appendSourcesPerBullet(evt.text, webSearch);
          finalAnswer = prependHeadlinesHeadingIfNeeded(withSources, message, webSearch);
          usage = evt.usage;
          send({ done: finalAnswer, usage, routing: evt.routing || null, transactionId, webSearch, plan: toPublicPlan(executionPlan) });
        }
      }

      if (!aborted && finalAnswer) persistTurns(uid, message, finalAnswer, usage);
      if (!aborted && finalAnswer) saveCachedAnswer(cacheRef, { model: resolvedModel, answer: finalAnswer });

      console.log('[atlas/stream]', {
        transactionId, uid,
        msgLen:    message.length,
        answerLen: finalAnswer.length,
        model:     usage && usage.model,
        usage,
        aborted,
        webSearchUsed: !!webSearch,
      });
    } catch (err) {
      // User-input errors (400/422) carry isOperational=true and a clean
      // user-facing message. Upstream / internal errors get a generic
      // bubble — never surface raw provider JSON or stack traces to the
      // visitor; log them server-side for debugging.
      const code        = err.code || 'INTERNAL_ERROR';
      const isUserError = err.isOperational && err.statusCode && err.statusCode < 500;
      const safeMessage = isUserError
        ? err.message
        : 'Atlas is having trouble responding right now. Please try again in a moment.';
      const retryAfterSec = Number(err && err.retryAfterSec);
      send({
        error: safeMessage,
        code,
        transactionId,
        ...(Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? { retryAfterSec: Math.ceil(retryAfterSec) } : {}),
      });
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
      const conv = await atlasRepository.getActiveConversation(req.user.uid);
      return res.status(200).json({
        success:      true,
        conversation: conv,
      });
    } catch (err) {
      return next(err);
    }
  }
);

// ── GET /api/atlas/usage ─────────────────────────────────────────────────────
router.get('/atlas/usage',
  requireAuth,
  async (req, res, next) => {
    try {
      const usage = await atlasRepository.getUsageSummary(req.user.uid);
      return res.status(200).json({ success: true, usage });
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
      await atlasRepository.clearActiveConversation(req.user.uid);
      return res.status(200).json({ success: true });
    } catch (err) {
      return next(err);
    }
  }
);

// ── GET /api/atlas/config  (public — returns only fields the chat UI needs) ──
router.get('/atlas/config',
  async (req, res, next) => {
    try {
      const cfg = await adminConfig.getAtlasConfig();
      // Filter enabledModels to only those that exist in LLM_MODELS
      const enabledModels = cfg.enabledModels.filter(function (k) { return !!LLM_MODELS[k]; });
      // Ensure defaultModel is in the enabled set; fall back to first enabled.
      const defaultModel = enabledModels.includes(cfg.defaultModel)
        ? cfg.defaultModel
        : (enabledModels[0] || DEFAULT_LLM_MODEL_KEY);
      return res.json({
        enabledModels,
        defaultModel,
        modelOptions: cfg.modelOptions || {},
        // Public chat UX: keep model choice admin-controlled (no user picker).
        modelSelectorVisible: false,
      });
    } catch (err) {
      // Local preview mode is used for admin UX work without requiring GCP
      // credentials. If Firestore isn't configured locally, fall back to a
      // safe default config so the chat UI can still boot.
      if (config.admin.localPreview) {
        const fallbackEnabled = ['flash-lite', 'flash'].filter(function (k) { return !!LLM_MODELS[k]; });
        return res.json({
          enabledModels: fallbackEnabled.length ? fallbackEnabled : [DEFAULT_LLM_MODEL_KEY],
          defaultModel: fallbackEnabled.includes('flash-lite')
            ? 'flash-lite'
            : (fallbackEnabled[0] || DEFAULT_LLM_MODEL_KEY),
          modelOptions: {
            'flash-lite': { label: 'Fast & economical', detail: 'Default' },
            flash: { label: 'More detailed', detail: 'Higher cost' },
          },
          modelSelectorVisible: false,
          degraded: true,
          degradedReason: 'FIRESTORE_NOT_CONFIGURED',
        });
      }
      return next(err);
    }
  }
);

module.exports = router;
