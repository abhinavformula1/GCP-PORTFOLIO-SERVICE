'use strict';

/**
 * Atlas response orchestrator.
 *
 * One job: given a conversation history and the current user message,
 * call the configured LLM provider with the persona system prompt and return a clean
 * answer. Sandwiches the LLM call with:
 *   - Input normalisation (trim, length cap, role validation)
 *   - History truncation (keep the last N turns to bound prompt size)
 *   - Output sanitisation (strip stray system-prompt leaks)
 *
 * The route layer (src/routes/atlas.js) handles auth, rate limiting,
 * and HTTP shaping. This module is pure orchestration.
 */

const {
  generateChatResponse,
  generateChatResponseStream,
  LLM_MODELS,
  DEFAULT_LLM_MODEL_KEY,
} = require('../llm');
const { SYSTEM_PROMPT } = require('./persona');
const {
  traceIfEnabled,
  previewText,
  summarizeGenerationConfig,
  summarizeUsage,
  summarizeStreamEvents,
  shouldCapturePrompts,
} = require('../observability/langsmith');
const { AppError } = require('../../errors');

const MAX_USER_MSG_CHARS  = 1000;
const MAX_HISTORY_TURNS   = 10;
const MAX_REPLY_CHARS     = 4000;

/**
 * Trim history to the last N turns, ensuring the first kept turn is a
 * 'user' message (the current provider requires the conversation to start with a user
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

function normaliseModel(model) {
  if (!model) return DEFAULT_LLM_MODEL_KEY;
  return LLM_MODELS[model] ? model : DEFAULT_LLM_MODEL_KEY;
}


function isQuotaError(err) {
  if (err && Number(err.upstreamStatus) === 429) return true;
  const text = String(err && (err.upstream || err.message) || '').toLowerCase();
  return text.includes('quota exceeded') || text.includes('resource_exhausted') || text.includes('error 429');
}

function parseRetryAfterSeconds(err) {
  const headerSec = Number(err && err.retryAfterSec);
  if (Number.isFinite(headerSec) && headerSec > 0) return Math.min(600, Math.max(5, Math.ceil(headerSec)));
  const text = String(err && (err.upstream || err.message) || '');
  // Gemini sometimes includes: "Please retry in 37.103293786s."
  const m = text.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!m) return 0;
  const sec = Number(m[1]);
  // Add a small floor so the UX doesn't immediately flash "00:00".
  return Number.isFinite(sec) && sec > 0 ? Math.min(600, Math.max(5, Math.ceil(sec))) : 0;
}

function normaliseFallbackModel(model, primaryModel) {
  const resolved = normaliseModel(model);
  if (!resolved || resolved === primaryModel) return '';
  return resolved;
}

function shouldRetryWithFallback(primaryModel, fallbackModel, err) {
  return !!(fallbackModel
    && fallbackModel !== primaryModel
    && err
    && err.code === 'UPSTREAM_ERROR'
    && isQuotaError(err));
}

function toFriendlyQuotaError(primaryModel, fallbackModel, err) {
  if (!err || !isQuotaError(err)) return err;

  const retrySec = parseRetryAfterSeconds(err);
  const retryHint = retrySec ? ` Please retry in ~${retrySec}s.` : ' Please retry in a moment.';

  const modelLabel = (LLM_MODELS && LLM_MODELS[primaryModel] && LLM_MODELS[primaryModel].label)
    ? LLM_MODELS[primaryModel].label
    : String(primaryModel || 'Gemini');

  const hasFallback = !!fallbackModel && fallbackModel !== primaryModel;
  const upstreamText = String(err && err.upstream || '');
  const freeTierQuotaHit = upstreamText.includes('generate_content_free_tier_requests');
  const message = hasFallback
    ? (freeTierQuotaHit
      ? `${modelLabel} hit the free-tier request limit.${retryHint} Switching models automatically…`
      : `${modelLabel} is rate-limited right now.${retryHint}`)
    : (freeTierQuotaHit
      ? `${modelLabel} hit the free-tier request limit.${retryHint} Enable billing / raise quota, or switch Atlas to Gemini Flash.`
      : `${modelLabel} is rate-limited right now.${retryHint} If this persists, ask the admin to check Gemini API quota/billing or switch Atlas to a different model.`);

  const friendly = new AppError(message, 429, 'MODEL_RATE_LIMITED');
  if (retrySec) friendly.retryAfterSec = retrySec;
  friendly.upstream = err.upstream;
  return friendly;
}

function routingReasonFromError(err) {
  const upstreamText = String(err && err.upstream || '');
  if (upstreamText.includes('generate_content_free_tier_requests')) return 'FREE_TIER_LIMIT';
  if (err && Number(err.upstreamStatus) === 429) return 'RATE_LIMIT';
  return 'RATE_LIMIT';
}

/**
 * Validate + normalise a request: trims the user message, enforces
 * length, builds a clean history. Throws on bad input. Both ask() and
 * askStream() are thin wrappers around this + an LLM call, so this
 * keeps the validation logic in one place.
 *
 * DIP note: callers may pass an optional `systemPrompt` override
 * (e.g. an RAG-augmented prompt built by the orchestrator).  When absent,
 * the default persona prompt is used.  This module never imports the RAG
 * layer — the dependency flows inward, not upward.
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
  // Accept an externally-supplied systemPrompt (e.g. RAG-augmented prompt).
  // Fall back to the static persona prompt when none is provided.
  const systemPrompt = (args && typeof args.systemPrompt === 'string' && args.systemPrompt.trim())
    ? args.systemPrompt
    : SYSTEM_PROMPT;
  // Accept a generationConfig override (temperature, topP, maxOutputTokens) from
  // the route layer, which reads them from the admin Firestore config.
  // Keeping this in prepareCall (not in ask/askStream) avoids duplicating the
  // pass-through logic and keeps both wrappers thin.
  const generationConfig = (args && args.generationConfig && typeof args.generationConfig === 'object')
    ? args.generationConfig
    : undefined;

  return {
    systemPrompt,
    history,
    userMessage: message,
    model: normaliseModel(args && args.model),
    generationConfig,
  };
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
  const fallbackModel = normaliseFallbackModel(args && args.fallbackModel, call.model);
  try {
    const result = await generateChatResponse(call);
    return { answer: sanitiseReply(result.text), usage: result.usage, routing: null };
  } catch (err) {
    if (!shouldRetryWithFallback(call.model, fallbackModel, err)) {
      throw toFriendlyQuotaError(call.model, fallbackModel, err);
    }
    const fallbackResult = await generateChatResponse(Object.assign({}, call, { model: fallbackModel }));
    return {
      answer: sanitiseReply(fallbackResult.text),
      usage: fallbackResult.usage,
      routing: {
        usedFallback: true,
        fromModel: call.model,
        toModel: fallbackModel,
        reason: routingReasonFromError(err),
      },
    };
  }
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
  const fallbackModel = normaliseFallbackModel(args && args.fallbackModel, call.model);
  let acc = '';
  let usage = null;
  let routing = null;

  const streamWithModel = async function* (modelKey) {
    for await (const evt of generateChatResponseStream(Object.assign({}, call, { model: modelKey }))) {
      if (evt.kind === 'chunk') {
        acc += evt.text;
        yield { kind: 'chunk', text: evt.text };
      } else if (evt.kind === 'usage') {
        usage = evt.usage;
      }
    }
  };

  try {
    yield* streamWithModel(call.model);
  } catch (err) {
    if (!shouldRetryWithFallback(call.model, fallbackModel, err)) {
      throw toFriendlyQuotaError(call.model, fallbackModel, err);
    }
    routing = {
      usedFallback: true,
      fromModel: call.model,
      toModel: fallbackModel,
      reason: routingReasonFromError(err),
    };
    acc = '';
    usage = null;
    yield* streamWithModel(fallbackModel);
  }

  yield { kind: 'done', text: sanitiseReply(acc), usage, routing };
}

module.exports = {
  ask: traceIfEnabled(ask, {
    name: 'atlas.ask',
    run_type: 'chain',
    processInputs(inputs) {
      return {
        model: String(inputs.model || ''),
        messagePreview: previewText(inputs.message),
        messageChars: String(inputs.message || '').trim().length,
        historyTurns: Array.isArray(inputs.history) ? inputs.history.length : 0,
        historyPreview: Array.isArray(inputs.history)
          ? inputs.history.slice(-2).map(function (turn) {
            return {
              role: turn && turn.role ? turn.role : '',
              textPreview: previewText(turn && turn.text ? turn.text : ''),
            };
          })
          : [],
        hasSystemPrompt: !!inputs.systemPrompt,
        systemPromptChars: inputs.systemPrompt ? String(inputs.systemPrompt).length : 0,
        generationConfig: summarizeGenerationConfig(inputs.generationConfig),
      };
    },
    processOutputs(outputs) {
      const full = String(outputs.answer || '');
      return {
        answerPreview: previewText(full, 600),
        answer: shouldCapturePrompts() ? full : '',
        answerChars: full.length,
        usage: summarizeUsage(outputs.usage),
      };
    },
  }),
  askStream: traceIfEnabled(askStream, {
    name: 'atlas.ask_stream',
    run_type: 'chain',
    processInputs(inputs) {
      return {
        model: String(inputs.model || ''),
        messagePreview: previewText(inputs.message),
        messageChars: String(inputs.message || '').trim().length,
        historyTurns: Array.isArray(inputs.history) ? inputs.history.length : 0,
        hasSystemPrompt: !!inputs.systemPrompt,
        systemPromptChars: inputs.systemPrompt ? String(inputs.systemPrompt).length : 0,
        generationConfig: summarizeGenerationConfig(inputs.generationConfig),
      };
    },
    processOutputs(outputs) {
      return summarizeStreamEvents(outputs.outputs);
    },
  }),
  LLM_MODELS,
  DEFAULT_LLM_MODEL_KEY,
  // Exported for tests / external observers.
  MAX_USER_MSG_CHARS,
  MAX_HISTORY_TURNS,
};
