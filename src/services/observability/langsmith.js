'use strict';

const config = require('../../config');
const { traceable } = require('langsmith/traceable');
const warnedTraceFallbacks = new Set();

function isLangSmithEnabled() {
  return !!(config.langsmith.apiKey && config.langsmith.tracingEnabled);
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
    return { chunkCount: 0, usage: null, finalAnswerChars: 0 };
  }
  let chunkCount = 0;
  let usage = null;
  let finalAnswerChars = 0;
  events.forEach(function (evt) {
    if (!evt || typeof evt !== 'object') return;
    if (evt.kind === 'chunk' && typeof evt.text === 'string') chunkCount += 1;
    if (evt.kind === 'usage' && evt.usage) usage = summarizeUsage(evt.usage);
    if (evt.kind === 'done' && typeof evt.text === 'string') finalAnswerChars = evt.text.length;
  });
  return { chunkCount, usage, finalAnswerChars };
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
  if (!isLangSmithEnabled()) return fn;
  const traced = traceable(fn, Object.assign({
    project_name: config.langsmith.project,
    tracingEnabled: true,
    metadata: {
      service: 'atlas',
      env: config.server.env,
    },
  }, traceConfig || {}));
  const traceName = traceConfig && traceConfig.name ? traceConfig.name : fn.name;
  return function tracedWithFallback(...args) {
    let result;
    try {
      result = traced.apply(this, args);
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
  previewText,
  maskIdentifier,
  summarizeUsage,
  summarizeGenerationConfig,
  summarizeExecutionPlan,
  summarizeWebSearchMeta,
  summarizeStreamEvents,
  traceIfEnabled,
};
