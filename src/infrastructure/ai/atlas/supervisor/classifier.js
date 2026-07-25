'use strict';

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { z } = require('zod');

const CLASSIFIER_TIMEOUT_MS = 5_000;
const SupervisorDecisionSchema = z.object({
  route: z.enum(['direct', 'web', 'rag', 'web-and-rag']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(180),
});

function createSupervisorClassifier({ config, resolveModel }) {
  return async function classify(userMessage, preliminaryPlan, atlasCfg, options = {}) {
    if (!config.gemini.apiKey) {
      throw Object.assign(new Error('Gemini is not configured for supervisor classification.'), {
        code: 'SUPERVISOR_MODEL_NOT_CONFIGURED',
      });
    }

    const available = ['direct'];
    if (preliminaryPlan.webSearchAvailable) available.push('web');
    if (preliminaryPlan.ragAvailable) available.push('rag');
    if (preliminaryPlan.webSearchAvailable && preliminaryPlan.ragAvailable) available.push('web-and-rag');
    const prompt = [
      'Classify this Atlas request for a routing supervisor.',
      'Available routes: ' + available.join(', ') + '.',
      'Use web for current/external facts. Use rag for Abhinav portfolio or indexed architecture content.',
      'Use web-and-rag only when both sources are genuinely necessary. Otherwise use direct.',
      'User request: ' + String(userMessage || '').trim(),
    ].join('\n');

    const controller = new AbortController();
    const externalSignal = options.signal;
    const onAbort = function () { controller.abort(); };
    if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(function () { controller.abort(); }, CLASSIFIER_TIMEOUT_MS);
    try {
      const modelInfo = resolveModel(atlasCfg && atlasCfg.defaultModel || 'flash-lite');
      const model = new ChatGoogleGenerativeAI({
        apiKey: config.gemini.apiKey,
        model: modelInfo.providerModelId,
        temperature: 0,
        maxOutputTokens: 160,
        maxRetries: 1,
      }).withStructuredOutput(SupervisorDecisionSchema, {
        name: 'atlas_supervisor_route',
      });
      return await model.invoke(prompt, {
        signal: controller.signal,
        tags: ['atlas', 'langgraph-supervisor', 'classifier'],
      });
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  };
}

module.exports = { createSupervisorClassifier, CLASSIFIER_TIMEOUT_MS };
