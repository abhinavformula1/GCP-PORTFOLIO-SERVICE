'use strict';

const config = require('../../config');
const { traceable } = require('langsmith/traceable');
const warnedTraceFallbacks = new Set();

let _runtimeTracingEnabled = false;
let _runtimeCapturePrompts = false;
let _runtimeCaptureChunks = false;
let _runtimeCaptureTokens = true;

function setLangSmithRuntimeEnabled(enabled) {
  _runtimeTracingEnabled = enabled === true;
}

function setLangSmithCapturePolicy({ capturePrompts, captureChunks, captureTokens } = {}) {
  if (capturePrompts != null) _runtimeCapturePrompts = capturePrompts === true;
  if (captureChunks != null)  _runtimeCaptureChunks  = captureChunks === true;
  if (captureTokens != null)  _runtimeCaptureTokens  = captureTokens !== false;
}

function shouldCapturePrompts() { return _runtimeCapturePrompts === true; }
function shouldCaptureChunks()  { return _runtimeCaptureChunks === true; }
function shouldCaptureTokens()  { return _runtimeCaptureTokens !== false; }

function isLangSmithEnabled() {
  const envReady = !!(config.langsmith.apiKey && config.langsmith.tracingEnabled);
  return envReady && _runtimeTracingEnabled;
}

function previewText(value, maxLen = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function maskIdentifier(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 10) return text;
  return text.slice(0, 4) + '…' + text.slice(-4);
}

function summarizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    model: usage.model || '',
    modelLabel: usage.modelLabel || '',
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.totalTokens || 0),
    estimatedUsd: Number(usage.estimatedUsd || 0),
    estimatedInr: Number(usage.estimatedInr || 0),
    cached: usage.cached === true,
  };
}

function summarizeGenerationConfig(generationConfig) {
  if (!generationConfig || typeof generationConfig !== 'object') return {};
  const summary = {};
  if (typeof generationConfig.temperature === 'number') summary.temperature = generationConfig.temperature;
  if (typeof generationConfig.topP === 'number') summary.topP = generationConfig.topP;
  if (typeof generationConfig.maxOutputTokens === 'number') summary.maxOutputTokens = generationConfig.maxOutputTokens;
  return summary;
}

function summarizeExecutionPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  return {
    strategy: String(plan.strategy || ''),
    executionMode: String(plan.executionMode || ''),
    useRag: !!plan.useRag,
    useWebSearch: !!plan.useWebSearch,
    ragTopK: typeof plan.ragTopK === 'number' ? plan.ragTopK : null,
    webSearchMaxResults: typeof plan.webSearchMaxResults === 'number' ? plan.webSearchMaxResults : null,
    webSearchTopic: typeof plan.webSearchTopic === 'string' ? plan.webSearchTopic : '',
    specialists: Array.isArray(plan.specialists) ? plan.specialists.slice(0, 8) : [],
  };
}

function summarizeWebSearchMeta(webSearch) {
  if (!webSearch || typeof webSearch !== 'object') return null;
  return {
    provider: String(webSearch.provider || ''),
    queryPreview: previewText(webSearch.query || ''),
    requestId: maskIdentifier(webSearch.requestId || ''),
    responseTime: typeof webSearch.responseTime === 'number' ? webSearch.responseTime : null,
    sourceCount: Array.isArray(webSearch.sources) ? webSearch.sources.length : 0,
  };
}

function summarizeStreamEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return { chunkCount: 0, usage: null, finalAnswerChars: 0, finalAnswerPreview: '', finalAnswer: '' };
  }
  let chunkCount = 0;
  let usage = null;
  let finalAnswerChars = 0;
  let finalText = '';
  events.forEach(function (evt) {
    if (!evt || typeof evt !== 'object') return;
    if (evt.kind === 'chunk' && typeof evt.text === 'string') chunkCount += 1;
    if (evt.kind === 'usage' && evt.usage) usage = summarizeUsage(evt.usage);
    if (evt.kind === 'done' && typeof evt.text === 'string') {
      finalAnswerChars = evt.text.length;
      finalText = evt.text;
    }
  });
  return {
    chunkCount,
    usage,
    finalAnswerChars,
    finalAnswerPreview: previewText(finalText, 600),
    finalAnswer: shouldCapturePrompts() ? String(finalText || '') : '',
  };
}

function isPromiseLike(value) {
  return !!value && typeof value.then === 'function';
}

function isAsyncIterable(value) {
  return !!value && typeof value[Symbol.asyncIterator] === 'function';
}

function isLangSmithTransportError(err) {
  const message = String(err && err.message ? err.message : '').toLowerCase();
  const stack = String(err && err.stack ? err.stack : '').toLowerCase();
  return message.includes('langsmith')
    || message.includes('fetch failed')
    || message.includes('unsupported protocol')
    || stack.includes('langsmith');
}

function warnTraceFallback(name, err) {
  const key = String(name || 'langsmith');
  if (warnedTraceFallbacks.has(key)) return;
  warnedTraceFallbacks.add(key);
  console.warn('[langsmith] tracing degraded for ' + key + ':', err.message);
}

async function* withAsyncIterableFallback(iterator, fn, ctx, args, traceName) {
  let yielded = false;
  try {
    for await (const item of iterator) {
      yielded = true;
      yield item;
    }
  } catch (err) {
    if (!isLangSmithTransportError(err) || yielded) throw err;
    warnTraceFallback(traceName, err);
    const fallback = fn.apply(ctx, args);
    if (!isAsyncIterable(fallback)) throw err;
    for await (const item of fallback) {
      yield item;
    }
  }
}

function traceIfEnabled(fn, traceConfig) {
  const traceName = traceConfig && traceConfig.name ? traceConfig.name : fn.name;
  let traced = null;
  let tracedInitFailed = false;

  function getTraced() {
    if (traced) return traced;
    if (tracedInitFailed) return null;
    try {
      traced = traceable(fn, Object.assign({
        project_name: config.langsmith.project,
        tracingEnabled: true,
        metadata: {
          service: 'atlas',
          env: config.server.env,
        },
      }, traceConfig || {}));
      return traced;
    } catch (err) {
      tracedInitFailed = true;
      if (err && err.message) warnTraceFallback(traceName, err);
      return null;
    }
  }

  return function tracedWithFallback(...args) {
    if (!isLangSmithEnabled()) {
      return fn.apply(this, args);
    }

    const tracedFn = getTraced();
    if (!tracedFn) {
      return fn.apply(this, args);
    }

    let result;
    try {
      result = tracedFn.apply(this, args);
    } catch (err) {
      if (!isLangSmithTransportError(err)) throw err;
      warnTraceFallback(traceName, err);
      return fn.apply(this, args);
    }
    if (isAsyncIterable(result)) {
      return withAsyncIterableFallback(result, fn, this, args, traceName);
    }
    if (isPromiseLike(result)) {
      return result.catch((err) => {
        if (!isLangSmithTransportError(err)) throw err;
        warnTraceFallback(traceName, err);
        return fn.apply(this, args);
      });
    }
    return result;
  };
}

module.exports = {
  isLangSmithEnabled,
  setLangSmithRuntimeEnabled,
  setLangSmithCapturePolicy,
  shouldCapturePrompts,
  shouldCaptureChunks,
  shouldCaptureTokens,
  previewText,
  maskIdentifier,
  summarizeUsage,
  summarizeGenerationConfig,
  summarizeExecutionPlan,
  summarizeWebSearchMeta,
  summarizeStreamEvents,
  traceIfEnabled,
};
