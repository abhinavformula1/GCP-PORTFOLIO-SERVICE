'use strict';

const { assertDependencies } = require('../ports/assert');

function createAtlasOrchestrator(dependencies) {
  assertDependencies(dependencies, 'application.atlasOrchestrator', { adminConfig: ['getAtlasConfig'], runWebSearchAgent: 'function', buildPreliminaryPlan: 'function', runAtlasSupervisor: 'function', buildRagContext: 'function', searchTavily: 'function', buildWebSearchContext: 'function', toPublicWebSearchMeta: 'function' });
  const { adminConfig, runWebSearchAgent, buildPreliminaryPlan, runAtlasSupervisor, buildRagContext, searchTavily, buildWebSearchContext, toPublicWebSearchMeta } = dependencies;

/**
 * Atlas orchestrator.
 *
 * Industry-standard boundary for source selection + context assembly.
 *
 * Multiagent mode delegates source selection and specialist execution to the
 * LangGraph supervisor. Single-agent and pure-model modes remain available as
 * rollback paths. This module adapts every mode back to the stable route
 * contract: plan + prompt + generation config + public source metadata.
 */

const { SYSTEM_PROMPT } = require('../../domain/atlas/persona');

function buildGenerationConfig(atlasCfg) {
  const cfg = atlasCfg && typeof atlasCfg === 'object' ? atlasCfg : {};
  const generationConfig = {};
  if (typeof cfg.temperature === 'number') generationConfig.temperature = cfg.temperature;
  if (typeof cfg.topP === 'number') generationConfig.topP = cfg.topP;
  if (typeof cfg.maxOutputTokens === 'number') generationConfig.maxOutputTokens = cfg.maxOutputTokens;
  return generationConfig;
}

function resolveBasePrompt(atlasCfg) {
  const customPrompt = atlasCfg && typeof atlasCfg.systemPrompt === 'string'
    ? atlasCfg.systemPrompt.trim()
    : '';
  return customPrompt || SYSTEM_PROMPT;
}

function buildExecutionPlan(userMessage, atlasCfg) {
  return buildPreliminaryPlan(userMessage, atlasCfg);
}

function isPlanCacheSafe(plan) {
  return !!plan
    && plan.useWebSearch !== true
    && plan.requiresSupervisorClassification !== true;
}

async function loadRuntimeConfig() {
  try {
    return await adminConfig.getAtlasConfig();
  } catch (err) {
    console.warn('[atlas] getAtlasConfig failed, using defaults:', err.message);
    return null;
  }
}

async function executeWebSearch(userMessage, plan, dependencies) {
  const deps = dependencies || {};
  const runAgent = deps.runWebSearchAgent || runWebSearchAgent;
  const directSearch = deps.searchTavily || searchTavily;
  let searchPayload = null;
  let agentMetadata = null;

  if (plan.webSearchExecutionMode === 'agent') {
    try {
      const agentResult = await runAgent(userMessage, {
        maxResults: plan.webSearchMaxResults,
        topic: plan.webSearchTopic,
      });
      searchPayload = agentResult.searchPayload;
      agentMetadata = agentResult.metadata;
      plan.webSearchExecution = 'agent';
    } catch (agentErr) {
      plan.webSearchExecution = 'direct-fallback';
      plan.webSearchFallbackCode = String(agentErr && agentErr.code || 'AGENT_ERROR');
      console.warn('[atlas/web-search-agent] Agent failed, using direct Tavily fallback:', agentErr.message);
    }
  }

  if (!searchPayload) {
    searchPayload = await directSearch(userMessage, {
      maxResults: plan.webSearchMaxResults,
      topic: plan.webSearchTopic,
    });
    if (!plan.webSearchExecution) plan.webSearchExecution = 'direct';
  }

  return { searchPayload, agentMetadata };
}

function publicWebSearchMeta(searchPayload, executionMetadata, plan) {
  const publicMeta = toPublicWebSearchMeta(searchPayload);
  if (!publicMeta) return null;
  const metadata = executionMetadata || {};
  return Object.assign({}, publicMeta, {
    execution: Object.assign({
      mode: metadata.execution || metadata.mode || plan.webSearchExecution || '',
      fallbackCode: metadata.fallbackCode || plan.webSearchFallbackCode || '',
    }, metadata),
  });
}

async function buildLegacyCallConfig(userMessage, cfg, executionPlan, generationConfig, basePrompt) {
  const plan = Object.assign({}, executionPlan);
  let promptBase = basePrompt;
  let webSearch = null;

  if (plan.useWebSearch) {
    try {
      const { searchPayload, agentMetadata } = await executeWebSearch(userMessage, plan);
      const webContext = buildWebSearchContext(searchPayload);
      if (webContext) {
        promptBase = [basePrompt, '', webContext].join('\n');
        webSearch = publicWebSearchMeta(searchPayload, agentMetadata, plan);
      } else {
        plan.useWebSearch = false;
      }
    } catch (webErr) {
      console.warn('[atlas/web-search] Tavily lookup failed, continuing without web context:', webErr.message);
      plan.useWebSearch = false;
    }
  }

  let systemPrompt;
  if (plan.useRag) {
    try {
      systemPrompt = await buildRagContext(userMessage, {
        topK: plan.ragTopK,
        baseSystemPrompt: promptBase,
        atlasCfg: cfg,
      });
      if (systemPrompt === promptBase) plan.useRag = false;
    } catch (ragErr) {
      console.warn('[atlas/rag] RAG context failed, falling back to base prompt:', ragErr.message);
      systemPrompt = promptBase;
      plan.useRag = false;
    }
  } else {
    systemPrompt = promptBase !== SYSTEM_PROMPT ? promptBase : undefined;
  }

  return { plan, systemPrompt, generationConfig, webSearch };
}

async function buildSupervisorCallConfig(userMessage, cfg, executionPlan, generationConfig, basePrompt) {
  const state = await runAtlasSupervisor({
    userMessage,
    atlasCfg: cfg,
    basePrompt,
    preliminaryPlan: executionPlan,
  });
  const plan = Object.assign({}, state.plan || executionPlan);
  const timings = state.nodeTimings && typeof state.nodeTimings === 'object'
    ? state.nodeTimings
    : {};
  const errors = Array.isArray(state.errors) ? state.errors : [];

  let promptBase = basePrompt;
  if (plan.useRag && state.ragPrompt && state.ragPrompt !== basePrompt) {
    promptBase = state.ragPrompt;
  } else {
    plan.useRag = false;
  }

  let webSearch = null;
  if (plan.useWebSearch) {
    const webContext = buildWebSearchContext(state.webSearchResult);
    if (webContext) {
      promptBase = [promptBase, '', webContext].join('\n');
      webSearch = publicWebSearchMeta(state.webSearchResult, state.webAgentMetadata, plan);
      plan.webSearchExecution = webSearch && webSearch.execution && webSearch.execution.mode || '';
      plan.webSearchFallbackCode = webSearch && webSearch.execution && webSearch.execution.fallbackCode || '';
    } else {
      plan.useWebSearch = false;
    }
  }

  plan.supervisorNodeTimings = timings;
  plan.supervisorErrors = errors.map(function (item) {
    return {
      node: String(item && item.node || ''),
      code: String(item && item.code || 'SUPERVISOR_NODE_ERROR'),
    };
  });

  return {
    plan,
    systemPrompt: promptBase !== SYSTEM_PROMPT ? promptBase : undefined,
    generationConfig,
    webSearch,
  };
}

async function buildCallConfig(userMessage, atlasCfg, executionPlan) {
  const cfg = atlasCfg || await loadRuntimeConfig();
  const plan = executionPlan || buildExecutionPlan(userMessage, cfg);
  const generationConfig = buildGenerationConfig(cfg);
  const basePrompt = resolveBasePrompt(cfg);

  if (plan.executionMode === 'multiagent') {
    try {
      return await buildSupervisorCallConfig(userMessage, cfg, plan, generationConfig, basePrompt);
    } catch (err) {
      console.warn('[atlas/supervisor] Graph failed, using legacy orchestrator:', err.message);
      const fallbackPlan = Object.assign({}, plan, {
        strategy: 'langgraph-fallback',
        requiresSupervisorClassification: false,
        supervisorDecisionSource: 'graph-fallback',
        supervisorConfidence: 0,
        supervisorReason: String(err && err.code || 'SUPERVISOR_GRAPH_ERROR'),
      });
      return buildLegacyCallConfig(userMessage, cfg, fallbackPlan, generationConfig, basePrompt);
    }
  }

  return buildLegacyCallConfig(userMessage, cfg, plan, generationConfig, basePrompt);
}

  return {
  buildExecutionPlan,
  isPlanCacheSafe,
  loadRuntimeConfig,
  executeWebSearch,
  buildLegacyCallConfig,
  buildSupervisorCallConfig,
  buildCallConfig,
};
}

module.exports = { createAtlasOrchestrator };
