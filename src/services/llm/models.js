'use strict';

/**
 * Provider-agnostic model catalog.
 *
 * The rest of the app should refer to stable internal model keys like
 * `flash-lite`, not raw vendor model ids. This keeps routing decisions and
 * vendor metadata in one place.
 */

const LLM_MODELS = Object.freeze({
  'flash-lite': Object.freeze({
    key: 'flash-lite',
    provider: 'gemini',
    providerModelId: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    pricing: Object.freeze({
      inputUsdPerMillion: 0.10,
      outputUsdPerMillion: 0.40,
    }),
  }),
  flash: Object.freeze({
    key: 'flash',
    provider: 'gemini',
    providerModelId: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    pricing: Object.freeze({
      inputUsdPerMillion: 0.30,
      outputUsdPerMillion: 2.50,
    }),
  }),
});

const DEFAULT_LLM_MODEL_KEY = 'flash-lite';

function resolveModel(modelKey) {
  return LLM_MODELS[modelKey] || LLM_MODELS[DEFAULT_LLM_MODEL_KEY];
}

module.exports = {
  LLM_MODELS,
  DEFAULT_LLM_MODEL_KEY,
  resolveModel,
};
