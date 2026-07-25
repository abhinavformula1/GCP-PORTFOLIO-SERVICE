'use strict';

function createProviderRegistry({ geminiProvider }) {
if (!geminiProvider
  || typeof geminiProvider.generateChatResponse !== 'function'
  || typeof geminiProvider.generateChatResponseStream !== 'function'
  || typeof geminiProvider.summariseConversation !== 'function') {
  throw new TypeError('providerRegistry.geminiProvider requires chat, stream, and summarise methods');
}
const PROVIDERS = Object.freeze({
  gemini: geminiProvider,
});

function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (provider) return provider;
  const err = new Error(`Unsupported LLM provider: ${providerName}`);
  err.code = 'UNSUPPORTED_LLM_PROVIDER';
  err.statusCode = 500;
  throw err;
}

  return Object.freeze({ getProvider });
}

module.exports = { createProviderRegistry };
