'use strict';

const config = require('../../../config');
const { resolveModel } = require('../models');
const {
  traceIfEnabled,
  previewText,
  summarizeGenerationConfig,
  summarizeUsage,
  summarizeStreamEvents,
} = require('../../observability/langsmith');

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
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const USD_TO_INR = 83;

function parseRetryAfterSecondsHeader(headers) {
  try {
    if (!headers || typeof headers.get !== 'function') return 0;
    const raw = String(headers.get('retry-after') || headers.get('Retry-After') || '').trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.ceil(n)) : 0;
  } catch (_) {
    return 0;
  }
}

function parseRetryHintFromBodySeconds(text) {
  const t = String(text || '');
  const m = t.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (!m) return 0;
  const sec = Number(m[1]);
  return Number.isFinite(sec) && sec > 0 ? Math.min(3600, Math.ceil(sec)) : 0;
}

function requireApiKey() {
  if (!config.gemini.apiKey) {
    const err = new Error('Gemini is not configured (GEMINI_API_KEY missing).');
    err.code = 'GEMINI_DISABLED';
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
}

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

async function fetchGemini(url, body, timeoutMs) {
  requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}?key=${config.gemini.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function resolveGeminiModel(modelKeyOrDescriptor) {
  const model = typeof modelKeyOrDescriptor === 'object' && modelKeyOrDescriptor
    ? modelKeyOrDescriptor
    : resolveModel(modelKeyOrDescriptor);
  if (model.provider !== 'gemini') {
    const err = new Error(`Gemini provider cannot serve model: ${model.key || 'unknown'}`);
    err.code = 'INVALID_PROVIDER_MODEL';
    err.statusCode = 500;
    throw err;
  }
  return model;
}

function modelUrl(model, action) {
  return `${GEMINI_API_BASE}/${model.providerModelId}:${action}`;
}

function estimateUsageCost(model, usageMetadata) {
  const inputTokens = Number(usageMetadata?.promptTokenCount || 0);
  const outputTokens = Number(usageMetadata?.candidatesTokenCount || 0);
  const totalTokens = Number(usageMetadata?.totalTokenCount || inputTokens + outputTokens);
  const inputUsd = (inputTokens / 1000000) * model.pricing.inputUsdPerMillion;
  const outputUsd = (outputTokens / 1000000) * model.pricing.outputUsdPerMillion;
  const totalUsd = inputUsd + outputUsd;
  return {
    model: model.providerModelId,
    modelLabel: model.label,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd: Number(totalUsd.toFixed(8)),
    estimatedInr: Number((totalUsd * USD_TO_INR).toFixed(4)),
  };
}

async function callGemini(body, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 15000;
  const model = resolveGeminiModel(opts && opts.model);
  const res = await fetchGemini(modelUrl(model, 'generateContent'), body, timeoutMs);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini API upstream error ${res.status}.`);
    err.statusCode = 502;
    err.code = 'UPSTREAM_ERROR';
    err.upstream = text.slice(0, 500);
    err.upstreamStatus = res.status;
    err.retryAfterSec = parseRetryAfterSecondsHeader(res.headers) || parseRetryHintFromBodySeconds(text);
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  checkFinishReason(candidate);
  return {
    text: (candidate?.content?.parts?.[0]?.text || '').trim(),
    usage: estimateUsageCost(model, data.usageMetadata),
  };
}

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
  }).then((r) => r.text);
}

async function generateChatResponse(args) {
  return callGemini(buildChatBody(args || {}), { model: args && args.model });
}

async function* generateChatResponseStream(args, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 30000;
  const body = buildChatBody(args || {});
  const model = resolveGeminiModel(args && args.model);

  requireApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${modelUrl(model, 'streamGenerateContent')}?alt=sse&key=${config.gemini.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
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
    e.upstreamStatus = res.status;
    e.retryAfterSec = parseRetryAfterSecondsHeader(res.headers) || parseRetryHintFromBodySeconds(text);
    throw e;
  }

  const reader = res.body.getReader();
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
        if (delta) yield { kind: 'chunk', text: delta };
        if (parsed.usageMetadata) {
          yield { kind: 'usage', usage: estimateUsageCost(model, parsed.usageMetadata) };
        }
      }
    }
  } finally {
    clearTimeout(timer);
    try { reader.releaseLock(); } catch (_) { /* already released */ }
  }
}

module.exports = {
  providerName: 'gemini',
  summariseConversation,
  generateChatResponse: traceIfEnabled(generateChatResponse, {
    name: 'llm.gemini.generate_chat_response',
    run_type: 'llm',
    getInvocationParams(args) {
      const model = resolveGeminiModel(args && args.model);
      return {
        provider: 'google-genai',
        model: model.providerModelId,
        temperature: args && args.generationConfig ? args.generationConfig.temperature : undefined,
        top_p: args && args.generationConfig ? args.generationConfig.topP : undefined,
        max_tokens: args && args.generationConfig ? args.generationConfig.maxOutputTokens : undefined,
      };
    },
    processInputs(inputs) {
      const model = resolveGeminiModel(inputs && inputs.model);
      return {
        provider: 'gemini',
        model: model.providerModelId,
        systemPromptPreview: previewText(inputs.systemPrompt),
        systemPromptChars: inputs.systemPrompt ? String(inputs.systemPrompt).length : 0,
        historyTurns: Array.isArray(inputs.history) ? inputs.history.length : 0,
        userMessagePreview: previewText(inputs.userMessage),
        userMessageChars: String(inputs.userMessage || '').trim().length,
        generationConfig: summarizeGenerationConfig(inputs.generationConfig),
      };
    },
    processOutputs(outputs) {
      return {
        textPreview: previewText(outputs.text),
        textChars: String(outputs.text || '').length,
        usage: summarizeUsage(outputs.usage),
      };
    },
  }),
  generateChatResponseStream: traceIfEnabled(generateChatResponseStream, {
    name: 'llm.gemini.generate_chat_response_stream',
    run_type: 'llm',
    getInvocationParams(args) {
      const model = resolveGeminiModel(args && args.model);
      return {
        provider: 'google-genai',
        model: model.providerModelId,
        temperature: args && args.generationConfig ? args.generationConfig.temperature : undefined,
        top_p: args && args.generationConfig ? args.generationConfig.topP : undefined,
        max_tokens: args && args.generationConfig ? args.generationConfig.maxOutputTokens : undefined,
      };
    },
    processInputs(inputs) {
      const model = resolveGeminiModel(inputs && inputs.model);
      return {
        provider: 'gemini',
        model: model.providerModelId,
        historyTurns: Array.isArray(inputs.history) ? inputs.history.length : 0,
        userMessagePreview: previewText(inputs.userMessage),
        userMessageChars: String(inputs.userMessage || '').trim().length,
        generationConfig: summarizeGenerationConfig(inputs.generationConfig),
      };
    },
    processOutputs(outputs) {
      return summarizeStreamEvents(outputs.outputs);
    },
  }),
};
