'use strict';

/**
 * Stable LLM service boundary.
 *
 * The rest of the application should depend on this module rather than a raw
 * provider SDK. This module owns:
 *   - model alias resolution
 *   - provider routing
 *   - stable app-facing method names
 */

const { getProvider } = require('./providers');
const { LLM_MODELS, DEFAULT_LLM_MODEL_KEY, resolveModel } = require('./models');

function getProviderForModel(modelKey) {
  const model = resolveModel(modelKey);
  return {
    model,
    provider: getProvider(model.provider),
  };
}

async function generateChatResponse(args) {
  const { model, provider } = getProviderForModel(args && args.model);
  return provider.generateChatResponse(Object.assign({}, args, { model }));
}

async function* generateChatResponseStream(args, opts) {
  const { model, provider } = getProviderForModel(args && args.model);
  yield* provider.generateChatResponseStream(Object.assign({}, args, { model }), opts);
}

async function summariseConversation(answers) {
  // Summaries currently route through the default provider. If this becomes
  // task-dependent later, add an explicit task router here rather than pushing
  // that concern into routes.
  const { provider } = getProviderForModel(DEFAULT_LLM_MODEL_KEY);
  return provider.summariseConversation(answers);
}

module.exports = {
  generateChatResponse,
  generateChatResponseStream,
  summariseConversation,
  LLM_MODELS,
  DEFAULT_LLM_MODEL_KEY,
  resolveModel,
};
