'use strict';

const geminiProvider = require('./gemini');

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

module.exports = {
  getProvider,
};
