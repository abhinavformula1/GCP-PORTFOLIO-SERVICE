'use strict';

/**
 * Atlas orchestrator.
 *
 * Industry-standard boundary for source selection + context assembly.
 *
 * Today this is a single-agent orchestrator:
 *   - decide whether the request should use web search
 *   - decide whether the request should use RAG
 *   - assemble the final system prompt and generation config
 *
 * Later this can grow into a richer planner/supervisor without forcing the
 * HTTP route or the low-level LLM caller to change shape.
 */

const adminConfig = require('../adminConfig');
const { SYSTEM_PROMPT } = require('./persona');
const { buildRagContext } = require('../rag');
const {
  traceIfEnabled,
  previewText,
  summarizeExecutionPlan,
  summarizeGenerationConfig,
  summarizeWebSearchMeta,
} = require('../observability/langsmith');
const {
  shouldUseWebSearch,
  searchTavily,
  buildWebSearchContext,
  toPublicWebSearchMeta,
} = require('../tavily/search');

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

function resolveExecutionMode(atlasCfg) {
  const mode = String(atlasCfg && atlasCfg.executionMode || 'single-agent').trim().toLowerCase();
  if (mode === 'pure-model' || mode === 'single-agent' || mode === 'multiagent') return mode;
  return 'single-agent';
}

function selectSpecialists(userMessage, plan) {
  if (!plan || plan.executionMode !== 'multiagent') return [];
  const text = String(userMessage || '').toLowerCase();
  const selected = [];

  if (plan.useWebSearch) selected.push('search-agent');
  if (plan.useRag || /\b(portfolio|project|architecture|atlas|rag)\b/.test(text)) {
    selected.push('portfolio-agent');
  }
  if (/\b(resume|cv|experience|certification|skills|background)\b/.test(text)) {
    selected.push('resume-agent');
  }

  return selected.length ? selected : ['portfolio-agent'];
}

function buildExecutionPlan(userMessage, atlasCfg) {
  const cfg = atlasCfg && typeof atlasCfg === 'object' ? atlasCfg : null;
  const executionMode = resolveExecutionMode(cfg);
  const common = {
    executionMode,
    ragTopK: cfg && cfg.ragTopK ? cfg.ragTopK : 5,
    webSearchMaxResults: cfg && cfg.webSearchMaxResults,
    webSearchTopic: cfg && cfg.webSearchTopic,
  };

  if (executionMode === 'pure-model') {
    return Object.assign({}, common, {
      strategy: 'direct-llm',
      useWebSearch: false,
      useRag: false,
      specialists: [],
    });
  }

  const useWebSearch = shouldUseWebSearch(userMessage, cfg);
  const useRag = !!(cfg && cfg.ragEnabled);

  if (executionMode === 'multiagent') {
    const plan = Object.assign({}, common, {
      strategy: 'supervisor-preview',
      useWebSearch,
      useRag,
    });
    return Object.assign(plan, {
      specialists: selectSpecialists(userMessage, plan),
    });
  }

  return Object.assign({}, common, {
    strategy: 'single-agent-orchestrator',
    useWebSearch,
    useRag,
    specialists: [],
  });
}

async function loadRuntimeConfig() {
  try {
    return await adminConfig.getAtlasConfig();
  } catch (err) {
    console.warn('[atlas] getAtlasConfig failed, using defaults:', err.message);
    return null;
  }
}

async function buildCallConfig(userMessage, atlasCfg, executionPlan) {
  try {
    const cfg = atlasCfg || await loadRuntimeConfig();
    const plan = executionPlan || buildExecutionPlan(userMessage, cfg);
    const generationConfig = buildGenerationConfig(cfg);
    const basePrompt = resolveBasePrompt(cfg);

    let promptBase = basePrompt;
    let webSearch = null;

    if (plan.useWebSearch) {
      try {
        const webSearchResult = await searchTavily(userMessage, {
          maxResults: plan.webSearchMaxResults,
          topic: plan.webSearchTopic,
        });
        const webContext = buildWebSearchContext(webSearchResult);
        if (webContext) {
          promptBase = [basePrompt, '', webContext].join('\n');
          webSearch = toPublicWebSearchMeta(webSearchResult);
        }
      } catch (webErr) {
        console.warn('[atlas/web-search] Tavily lookup failed, continuing without web context:', webErr.message);
      }
    }

    let systemPrompt;
    if (plan.useRag) {
      try {
        systemPrompt = await buildRagContext(userMessage, {
          topK: plan.ragTopK,
          baseSystemPrompt: promptBase,
        });
      } catch (ragErr) {
        console.warn('[atlas/rag] RAG context failed, falling back to base prompt:', ragErr.message);
        systemPrompt = promptBase;
      }
    } else {
      systemPrompt = promptBase !== SYSTEM_PROMPT ? promptBase : undefined;
    }

    return { plan, systemPrompt, generationConfig, webSearch };
  } catch (err) {
    console.warn('[atlas] buildCallConfig failed, using defaults:', err.message);
    return {
      plan: buildExecutionPlan(userMessage, atlasCfg),
      systemPrompt: undefined,
      generationConfig: {},
      webSearch: null,
    };
  }
}

module.exports = {
  buildExecutionPlan: traceIfEnabled(buildExecutionPlan, {
    name: 'atlas.build_execution_plan',
    run_type: 'chain',
    processInputs(inputs) {
      const args = Array.isArray(inputs.args) ? inputs.args : [];
      const userMessage = args[0];
      const atlasCfg = args[1];
      return {
        messagePreview: previewText(userMessage),
        messageChars: String(userMessage || '').trim().length,
        ragEnabled: !!(atlasCfg && atlasCfg.ragEnabled),
        webSearchEnabled: !!(atlasCfg && atlasCfg.webSearchEnabled),
        webSearchMode: atlasCfg && atlasCfg.webSearchMode ? String(atlasCfg.webSearchMode) : '',
        executionMode: atlasCfg && atlasCfg.executionMode ? String(atlasCfg.executionMode) : '',
      };
    },
    processOutputs(outputs) {
      return {
        plan: summarizeExecutionPlan(outputs),
      };
    },
  }),
  loadRuntimeConfig: traceIfEnabled(loadRuntimeConfig, {
    name: 'atlas.load_runtime_config',
    run_type: 'retriever',
    processOutputs(outputs) {
      return outputs && typeof outputs === 'object'
        ? {
          ragEnabled: !!outputs.ragEnabled,
          executionMode: String(outputs.executionMode || ''),
          defaultModel: String(outputs.defaultModel || ''),
          webSearchMode: String(outputs.webSearchMode || ''),
          tracingEnabled: !!outputs.tracingEnabled,
        }
        : {};
    },
  }),
  buildCallConfig: traceIfEnabled(buildCallConfig, {
    name: 'atlas.build_call_config',
    run_type: 'chain',
    processInputs(inputs) {
      const args = Array.isArray(inputs.args) ? inputs.args : [];
      const userMessage = args[0];
      const atlasCfg = args[1];
      const executionPlan = args[2];
      return {
        messagePreview: previewText(userMessage),
        messageChars: String(userMessage || '').trim().length,
        hasAtlasConfig: !!atlasCfg,
        requestedPlan: summarizeExecutionPlan(executionPlan),
      };
    },
    processOutputs(outputs) {
      return outputs && typeof outputs === 'object'
        ? {
          plan: summarizeExecutionPlan(outputs.plan),
          generationConfig: summarizeGenerationConfig(outputs.generationConfig),
          hasSystemPrompt: !!outputs.systemPrompt,
          systemPromptChars: outputs.systemPrompt ? String(outputs.systemPrompt).length : 0,
          webSearch: summarizeWebSearchMeta(outputs.webSearch),
        }
        : {};
    },
  }),
};
