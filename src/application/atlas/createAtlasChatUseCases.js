'use strict';

const { ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createAtlasChatUseCases(dependencies) {
  assertDependencies(dependencies, 'application.atlasChat', {
    persistence: ['getActiveConversation', 'appendTurn', 'appendUsageEvent', 'getCacheEntry', 'saveCacheEntry', 'getUsageSummary', 'clearActiveConversation'],
    responder: ['ask', 'askStream'],
    orchestrator: ['buildExecutionPlan', 'isPlanCacheSafe', 'loadRuntimeConfig', 'buildCallConfig'],
    tracing: ['setLangSmithRuntimeEnabled', 'setLangSmithCapturePolicy'],
    randomUUID: 'function',
    hashText: 'function',
    logger: 'value',
    settings: 'value',
    getAtlasConfig: 'function',
  });
  assertDependencies(dependencies.responder, 'application.atlasChat.responder', {
    LLM_MODELS: 'value',
    DEFAULT_LLM_MODEL_KEY: 'value',
    MAX_USER_MSG_CHARS: 'value',
    MAX_HISTORY_TURNS: 'value',
  });
  const { persistence, responder, orchestrator, tracing, randomUUID, hashText, logger, settings } = dependencies;
  const { ask, askStream, LLM_MODELS, DEFAULT_LLM_MODEL_KEY, MAX_USER_MSG_CHARS, MAX_HISTORY_TURNS } = responder;
  const { buildExecutionPlan, isPlanCacheSafe, loadRuntimeConfig, buildCallConfig } = orchestrator;
  const { setLangSmithRuntimeEnabled, setLangSmithCapturePolicy } = tracing;
  const atlasRepository = persistence;
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
    key: hashText(raw),
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
    webSearchExecution: String(plan.webSearchExecution || ''),
    webSearchFallbackCode: String(plan.webSearchFallbackCode || ''),
    supervisorDecisionSource: String(plan.supervisorDecisionSource || ''),
    supervisorConfidence: typeof plan.supervisorConfidence === 'number' ? plan.supervisorConfidence : null,
    specialists: Array.isArray(plan.specialists) ? plan.specialists.slice(0, 8) : [],
  };
}


  function requestContext(input, user) {
    const message = String(input?.message || '').trim();
    const model = String(input?.model || '').trim();
    if (!message) throw new ValidationError('Message is required.');
    if (message.length > MAX_USER_MSG_CHARS) throw new ValidationError(`Message must be ${MAX_USER_MSG_CHARS} characters or fewer.`);
    if (model && !LLM_MODELS[model]) throw new ValidationError('Invalid model selection.');
    return { transactionId: randomUUID(), message, model, uid: user.uid };
  }

  function applyTracing(config) {
    setLangSmithRuntimeEnabled(!!config?.langsmithTracingEnabled);
    setLangSmithCapturePolicy({
      capturePrompts: config?.capturePrompts,
      captureChunks: config?.captureChunks,
      captureTokens: config?.captureTokens,
    });
  }

  async function submit(input, user) {
    const { transactionId, message, model, uid } = requestContext(input, user);
    const history = await loadServerHistory(uid);
    const atlasConfig = await loadRuntimeConfig();
    applyTracing(atlasConfig);
    const resolvedModel = resolveAtlasModel(model, atlasConfig);
    const fallbackModel = resolveAtlasFallbackModel(resolvedModel, atlasConfig);
    const executionPlan = buildExecutionPlan(message, atlasConfig);
    const cacheRef = isPlanCacheSafe(executionPlan) ? cacheKeyFor({ message, model: resolvedModel, history }) : null;
    const cached = await readCachedAnswer(cacheRef);
    if (cached?.answer) {
      const usage = cachedUsage(resolvedModel);
      void persistTurns(uid, message, cached.answer, usage);
      logger.log('[atlas/cache]', { transactionId, uid, model: usage.model });
      return { success: true, answer: cached.answer, usage, cached: true, transactionId, webSearch: null, plan: toPublicPlan(executionPlan) };
    }
    const call = await buildCallConfig(message, atlasConfig, executionPlan);
    const result = await ask({
      message, history, model: resolvedModel, fallbackModel,
      systemPrompt: call.systemPrompt, generationConfig: call.generationConfig,
    });
    const answer = prependHeadlinesHeadingIfNeeded(appendSourcesPerBullet(result.answer, call.webSearch), message, call.webSearch);
    void persistTurns(uid, message, answer, result.usage);
    void saveCachedAnswer(cacheRef, { model: resolvedModel, answer });
    logger.log('[atlas]', { transactionId, uid, msgLen: message.length, historyTurns: history.length, answerLen: answer.length, model: result.usage?.model, usage: result.usage, webSearchUsed: !!call.webSearch, supervisorDecisionSource: call.plan?.supervisorDecisionSource, specialists: call.plan?.specialists });
    return { success: true, answer, usage: result.usage, cached: false, transactionId, webSearch: call.webSearch, routing: result.routing, plan: toPublicPlan(call.plan) };
  }

  async function *stream(input, user, isAborted) {
    const { transactionId, message, model, uid } = requestContext(input, user);
    let finalAnswer = '';
    let usage = null;
    try {
      const history = await loadServerHistory(uid);
      const atlasConfig = await loadRuntimeConfig();
      applyTracing(atlasConfig);
      const resolvedModel = resolveAtlasModel(model, atlasConfig);
      const fallbackModel = resolveAtlasFallbackModel(resolvedModel, atlasConfig);
      const executionPlan = buildExecutionPlan(message, atlasConfig);
      const cacheRef = isPlanCacheSafe(executionPlan) ? cacheKeyFor({ message, model: resolvedModel, history }) : null;
      const cached = await readCachedAnswer(cacheRef);
      if (cached?.answer) {
        finalAnswer = cached.answer;
        usage = cachedUsage(resolvedModel);
        yield { done: finalAnswer, usage, cached: true, transactionId, webSearch: null, plan: toPublicPlan(executionPlan) };
        void persistTurns(uid, message, finalAnswer, usage);
        return;
      }
      const call = await buildCallConfig(message, atlasConfig, executionPlan);
      for await (const event of askStream({ message, history, model: resolvedModel, fallbackModel, systemPrompt: call.systemPrompt, generationConfig: call.generationConfig })) {
        if (isAborted()) break;
        if (event.kind === 'chunk') yield { chunk: event.text };
        if (event.kind === 'done') {
          finalAnswer = prependHeadlinesHeadingIfNeeded(appendSourcesPerBullet(event.text, call.webSearch), message, call.webSearch);
          usage = event.usage;
          yield { done: finalAnswer, usage, routing: event.routing || null, transactionId, webSearch: call.webSearch, plan: toPublicPlan(call.plan) };
        }
      }
      if (!isAborted() && finalAnswer) {
        void persistTurns(uid, message, finalAnswer, usage);
        void saveCachedAnswer(cacheRef, { model: resolvedModel, answer: finalAnswer });
      }
    } catch (error) {
      const retryAfterSec = Number(error?.retryAfterSec);
      yield {
        error: error.isOperational && error.statusCode < 500 ? error.message : 'Atlas is having trouble responding right now. Please try again in a moment.',
        code: error.code || 'INTERNAL_ERROR',
        transactionId,
        ...(Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? { retryAfterSec: Math.ceil(retryAfterSec) } : {}),
      };
      logger.error('[atlas/stream] error:', { transactionId, code: error.code, statusCode: error.statusCode, message: error.message, upstream: error.upstream });
    }
  }

  async function activeConversation(uid) {
    return { success: true, conversation: await persistence.getActiveConversation(uid) };
  }
  async function usage(uid) {
    return { success: true, usage: await persistence.getUsageSummary(uid) };
  }
  async function clearConversation(uid) {
    await persistence.clearActiveConversation(uid);
    return { success: true };
  }
  async function publicConfig() {
    try {
      const config = await dependencies.getAtlasConfig();
      const enabledModels = config.enabledModels.filter((key) => !!LLM_MODELS[key]);
      return {
        enabledModels,
        defaultModel: enabledModels.includes(config.defaultModel) ? config.defaultModel : (enabledModels[0] || DEFAULT_LLM_MODEL_KEY),
        modelOptions: config.modelOptions || {},
        modelSelectorVisible: false,
      };
    } catch (error) {
      if (!settings.localPreview) throw error;
      const enabledModels = ['flash-lite', 'flash'].filter((key) => !!LLM_MODELS[key]);
      return {
        enabledModels: enabledModels.length ? enabledModels : [DEFAULT_LLM_MODEL_KEY],
        defaultModel: enabledModels.includes('flash-lite') ? 'flash-lite' : (enabledModels[0] || DEFAULT_LLM_MODEL_KEY),
        modelOptions: { 'flash-lite': { label: 'Fast & economical', detail: 'Default' }, flash: { label: 'More detailed', detail: 'Higher cost' } },
        modelSelectorVisible: false,
        degraded: true,
        degradedReason: 'FIRESTORE_NOT_CONFIGURED',
      };
    }
  }

  return Object.freeze({
    maxUserMessageChars: MAX_USER_MSG_CHARS,
    maxHistoryTurns: MAX_HISTORY_TURNS,
    modelKeys: Object.freeze(Object.keys(LLM_MODELS)),
    submit, stream, activeConversation, usage, clearConversation, publicConfig,
  });
}

module.exports = { createAtlasChatUseCases };
