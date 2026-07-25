'use strict';

const { assertDependencies } = require('../../ports/assert');

function createSupervisorRouter(dependencies) {
  assertDependencies(dependencies, 'application.atlasSupervisor', {
    hasTavilyApiKey: 'function',
    looksLikeWebIntent: 'function',
    shouldUseWebSearch: 'function',
    classify: 'function',
  });
  const { hasTavilyApiKey, looksLikeWebIntent, shouldUseWebSearch, classify } = dependencies;


const CLASSIFIER_TIMEOUT_MS = 5_000;
const PORTFOLIO_PATTERN = /\b(abhinav|atlas|portfolio|resume|cv|experience|certification|skills|background|system design|architecture|case study|article|firestore|cloud run|gcp|salesforce|rag|retrieval|embedding|vector)\b/i;
const DIRECT_PATTERN = /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|bye)[!. ]*$/i;

function hasPortfolioIntent(userMessage) {
  return PORTFOLIO_PATTERN.test(String(userMessage || '').trim());
}

function routeToSpecialists(route, capabilities) {
  const caps = capabilities || {};
  const wantsWeb = route === 'web' || route === 'web-and-rag';
  const wantsRag = route === 'rag' || route === 'web-and-rag';
  const specialists = [];
  if (wantsWeb && caps.webSearchAvailable) specialists.push('search-agent');
  if (wantsRag && caps.ragAvailable) specialists.push('portfolio-agent');
  return specialists;
}

function buildPreliminaryPlan(userMessage, atlasCfg) {
  const cfg = atlasCfg && typeof atlasCfg === 'object' ? atlasCfg : {};
  const executionMode = ['pure-model', 'single-agent', 'multiagent'].includes(cfg.executionMode)
    ? cfg.executionMode
    : 'multiagent';
  const webIntent = looksLikeWebIntent(userMessage);
  const portfolioIntent = hasPortfolioIntent(userMessage);
  const webSearchAvailable = hasTavilyApiKey() && cfg.webSearchEnabled !== false;
  const ragAvailable = cfg.ragEnabled === true;
  const useWebSearch = executionMode !== 'pure-model' && shouldUseWebSearch(userMessage, cfg);
  const useRag = executionMode !== 'pure-model'
    && ragAvailable
    && portfolioIntent
    && !(useWebSearch && !portfolioIntent);
  const clearDirect = DIRECT_PATTERN.test(String(userMessage || '').trim());
  const forceClassifier = executionMode === 'multiagent' && cfg.routingStrategy === 'classifier';
  const deterministic = executionMode !== 'multiagent'
    || (!forceClassifier && (
      executionMode === 'pure-model'
      || webIntent
      || portfolioIntent
      || clearDirect
      || cfg.routingStrategy === 'rule-based'
    ));
  const specialists = [];
  if (useWebSearch) specialists.push('search-agent');
  if (useRag) specialists.push('portfolio-agent');

  return {
    executionMode,
    strategy: executionMode === 'multiagent' ? 'langgraph-supervisor' : (
      executionMode === 'pure-model' ? 'direct-llm' : 'single-agent-orchestrator'
    ),
    useWebSearch,
    useRag,
    specialists,
    ragTopK: cfg.ragTopK || 5,
    webSearchExecutionMode: String(cfg.webSearchExecutionMode || 'agent').toLowerCase() === 'direct'
      ? 'direct'
      : 'agent',
    webSearchMaxResults: cfg.webSearchMaxResults,
    webSearchTopic: cfg.webSearchTopic,
    supervisorDecisionSource: deterministic ? 'deterministic' : 'pending-classifier',
    supervisorConfidence: deterministic ? 1 : 0,
    supervisorReason: deterministic ? (
      webIntent ? 'current-web-intent'
        : portfolioIntent ? 'portfolio-intent'
          : clearDirect ? 'direct-conversation'
            : 'configured-routing-mode'
    ) : 'ambiguous-intent',
    requiresSupervisorClassification: !deterministic,
    webSearchAvailable,
    ragAvailable,
  };
}

async function classifyRequest(userMessage, preliminaryPlan, atlasCfg, options) {
  const opts = options || {};
  const classifier = typeof opts.classify === 'function' ? opts.classify : classify;
  if (typeof classifier !== 'function') {
    throw Object.assign(new Error('Supervisor classifier is not configured.'), {
      code: 'SUPERVISOR_MODEL_NOT_CONFIGURED',
    });
  }
  return classifier(userMessage, preliminaryPlan, atlasCfg, opts);
}

async function resolveSupervisorPlan(userMessage, atlasCfg, preliminaryPlan, options) {
  const initial = Object.assign({}, preliminaryPlan || buildPreliminaryPlan(userMessage, atlasCfg));
  if (!initial.requiresSupervisorClassification) return initial;

  try {
    const decision = await classifyRequest(userMessage, initial, atlasCfg, options);
    const route = String(decision && decision.route || 'direct');
    const specialists = routeToSpecialists(route, initial);
    return Object.assign(initial, {
      useWebSearch: specialists.includes('search-agent'),
      useRag: specialists.includes('portfolio-agent'),
      specialists,
      supervisorDecisionSource: 'gemini-classifier',
      supervisorConfidence: Number(decision && decision.confidence || 0),
      supervisorReason: String(decision && decision.reason || 'classified').slice(0, 180),
      requiresSupervisorClassification: false,
    });
  } catch (err) {
    return Object.assign(initial, {
      useWebSearch: false,
      useRag: false,
      specialists: [],
      supervisorDecisionSource: 'classifier-fallback',
      supervisorConfidence: 0,
      supervisorReason: String(err && err.code || 'SUPERVISOR_CLASSIFIER_ERROR'),
      requiresSupervisorClassification: false,
    });
  }
}

  return {
  CLASSIFIER_TIMEOUT_MS,
  hasPortfolioIntent,
  routeToSpecialists,
  buildPreliminaryPlan,
  resolveSupervisorPlan,
};
}

module.exports = { createSupervisorRouter };
