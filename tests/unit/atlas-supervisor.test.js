'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildComposition } = require('../../src/main/composition');
const composition = buildComposition({ isCloudRuntime: false, nodeEnv: 'test' });
const { createSupervisorRouter } = require('../../src/application/atlas/supervisor/router');
const supervisor = createSupervisorRouter({
  hasTavilyApiKey: () => true,
  looksLikeWebIntent: (message) => /\b(latest|current)\b/i.test(String(message)),
  shouldUseWebSearch: (message, cfg) => cfg.webSearchEnabled !== false
    && (cfg.webSearchMode === 'always' || /\b(latest|current)\b/i.test(String(message))),
  classify: async () => ({ route: 'direct', confidence: 1, reason: 'test' }),
});
const {
  buildPreliminaryPlan,
  resolveSupervisorPlan,
} = supervisor;
const {
  runAtlasSupervisorImpl,
} = require('../../src/infrastructure/ai/atlas/supervisor');
const {
  isPlanCacheSafe,
  buildSupervisorCallConfig,
} = composition.atlasOrchestrator;

function webPayload() {
  return {
    query: 'latest Atlas release',
    requestId: 'request-1',
    responseTime: 0.1,
    results: [{
      title: 'Atlas release notes',
      url: 'https://example.com/atlas',
      content: 'Atlas released a current update.',
      score: 0.9,
    }],
  };
}

function withTavilyKey(fn) {
  return Promise.resolve().then(fn);
}

test('hybrid router uses deterministic routing for clear web intent', async function () {
  await withTavilyKey(function () {
    const plan = buildPreliminaryPlan('What is the latest Node.js release?', {
      executionMode: 'multiagent',
      webSearchEnabled: true,
      webSearchMode: 'web-intent',
      ragEnabled: false,
    });
    assert.equal(plan.requiresSupervisorClassification, false);
    assert.equal(plan.useWebSearch, true);
    assert.deepEqual(plan.specialists, ['search-agent']);
  });
});

test('hybrid router calls classifier only for ambiguous intent', async function () {
  const preliminary = buildPreliminaryPlan('Compare the available approaches', {
    executionMode: 'multiagent',
    webSearchEnabled: false,
    ragEnabled: true,
  });
  let calls = 0;
  const plan = await resolveSupervisorPlan(
    'Compare the available approaches',
    { executionMode: 'multiagent', ragEnabled: true },
    preliminary,
    {
      classify: async function () {
        calls += 1;
        return { route: 'rag', confidence: 0.82, reason: 'Needs indexed context' };
      },
    }
  );

  assert.equal(calls, 1);
  assert.equal(plan.useRag, true);
  assert.equal(plan.supervisorDecisionSource, 'gemini-classifier');
  assert.equal(plan.supervisorConfidence, 0.82);
});

test('supervisor runs web and RAG specialists in parallel graph branches', async function () {
  await withTavilyKey(async function () {
    const cfg = {
      executionMode: 'multiagent',
      webSearchEnabled: true,
      webSearchMode: 'web-intent',
      webSearchExecutionMode: 'agent',
      ragEnabled: true,
    };
    const preliminaryPlan = buildPreliminaryPlan('What is the latest Atlas RAG architecture?', cfg);
    const state = await runAtlasSupervisorImpl({
      userMessage: 'What is the latest Atlas RAG architecture?',
      atlasCfg: cfg,
      basePrompt: 'BASE',
      preliminaryPlan,
    }, {
      dependencies: {
        resolveSupervisorPlan,
        runWebSearchAgent: async function () {
          return {
            searchPayload: webPayload(),
            metadata: { mode: 'agent', toolCalls: 1 },
          };
        },
        searchTavily: async function () { return webPayload(); },
        buildRagContext: async function () { return 'RAG\nBASE'; },
      },
    });

    assert.deepEqual(state.plan.specialists.sort(), ['portfolio-agent', 'search-agent']);
    assert.equal(state.webSearchResult.results.length, 1);
    assert.equal(state.ragPrompt, 'RAG\nBASE');
    assert.equal(typeof state.nodeTimings.webSearchMs, 'number');
    assert.equal(typeof state.nodeTimings.ragMs, 'number');
  });
});

test('failed graph specialist degrades without failing the request', async function () {
  await withTavilyKey(async function () {
    const cfg = {
      executionMode: 'multiagent',
      webSearchEnabled: true,
      webSearchMode: 'always',
      webSearchExecutionMode: 'agent',
      ragEnabled: false,
    };
    const preliminaryPlan = buildPreliminaryPlan('latest release', cfg);
    const state = await runAtlasSupervisorImpl({
      userMessage: 'latest release',
      atlasCfg: cfg,
      basePrompt: 'BASE',
      preliminaryPlan,
    }, {
      dependencies: {
        resolveSupervisorPlan,
        runWebSearchAgent: async function () {
          throw Object.assign(new Error('agent down'), { code: 'AGENT_DOWN' });
        },
        searchTavily: async function () {
          throw Object.assign(new Error('search down'), { code: 'TAVILY_DOWN' });
        },
        buildRagContext: async function (_message, options) {
          return options.baseSystemPrompt;
        },
      },
    });

    assert.equal(state.webSearchResult, undefined);
    assert.equal(state.errors[0].node, 'web-search');
    assert.equal(state.errors[0].code, 'TAVILY_DOWN');
  });
});

test('uncertain plans are never cache eligible', function () {
  assert.equal(isPlanCacheSafe({
    useWebSearch: false,
    requiresSupervisorClassification: true,
  }), false);
  assert.equal(isPlanCacheSafe({
    useWebSearch: true,
    requiresSupervisorClassification: false,
  }), false);
  assert.equal(isPlanCacheSafe({
    useWebSearch: false,
    requiresSupervisorClassification: false,
  }), true);
});

test('supervisor output adapts to existing Atlas call-config contract', async function () {
  const cfg = {
    executionMode: 'multiagent',
    webSearchEnabled: false,
    ragEnabled: false,
  };
  const plan = buildPreliminaryPlan('hello', cfg);
  const result = await buildSupervisorCallConfig('hello', cfg, plan, {}, 'BASE');

  assert.equal(result.plan.strategy, 'langgraph-supervisor');
  assert.equal(result.systemPrompt, 'BASE');
  assert.equal(result.webSearch, null);
  assert.deepEqual(result.generationConfig, {});
});
