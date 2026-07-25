'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAtlasOrchestrator } = require('../../src/application/atlas/createAtlasOrchestrator');
const localOrchestrator = createAtlasOrchestrator({
  adminConfig: { async getAtlasConfig() { return {}; } },
  runWebSearchAgent: async () => null,
  buildPreliminaryPlan(message, cfg) {
    const useWebSearch = cfg.webSearchEnabled !== false
      && (cfg.webSearchMode === 'always' || /\b(latest|current)\b/i.test(String(message)));
    return {
      executionMode: cfg.executionMode || 'single-agent',
      useWebSearch,
      useRag: false,
      webSearchExecutionMode: cfg.webSearchExecutionMode || 'agent',
      requiresSupervisorClassification: false,
    };
  },
  runAtlasSupervisor: async (input) => ({ plan: input.preliminaryPlan }),
  buildRagContext: async (_message, options) => options.baseSystemPrompt,
  searchTavily: async () => null,
  buildWebSearchContext: (_payload, prompt) => prompt,
  toPublicWebSearchMeta: () => null,
});
const { createWebSearchTool } = require('../../src/infrastructure/ai/atlas/tools/webSearchTool');
const {
  isSafePublicUrl,
  mergeSearchPayloads,
} = require('../../src/domain/atlas/webSearchResult');
const {
  buildExecutionPlan,
  executeWebSearch,
} = localOrchestrator;

function payload(query, url) {
  return {
    query,
    requestId: 'request-1',
    responseTime: 0.2,
    results: [{
      title: 'Current release',
      url,
      content: 'A factual current release summary.',
      score: 0.9,
    }],
  };
}

test('rejects local and unsafe source URLs', function () {
  assert.equal(isSafePublicUrl('https://example.com/news'), true);
  assert.equal(isSafePublicUrl('javascript:alert(1)'), false);
  assert.equal(isSafePublicUrl('http://localhost:8080/private'), false);
  assert.equal(isSafePublicUrl('http://192.168.1.2/private'), false);
});

test('normalizes and deduplicates agent search sources', function () {
  const merged = mergeSearchPayloads([
    payload('first', 'https://example.com/news'),
    payload('second', 'https://example.com/news'),
    payload('private', 'http://127.0.0.1/secret'),
  ], 'original question');

  assert.equal(merged.query, 'original question');
  assert.equal(merged.results.length, 1);
  assert.equal(merged.results[0].title, 'Current release');
});

test('typed web tool records normalized Tavily payloads', async function () {
  const recorded = [];
  const webTool = createWebSearchTool({
    payloads: recorded,
    search: async function (query) {
      return payload(query, 'https://example.com/result');
    },
  });

  const output = JSON.parse(await webTool.invoke({ query: ' latest   Gemini release ' }));
  assert.equal(output.ok, true);
  assert.equal(output.query, 'latest Gemini release');
  assert.equal(output.results.length, 1);
  assert.equal(recorded.length, 1);
});

test('execution plan selects feature-flagged agent mode', function () {
  const plan = buildExecutionPlan('What is the latest Gemini release?', {
    executionMode: 'single-agent',
    webSearchEnabled: true,
    webSearchMode: 'web-intent',
    webSearchExecutionMode: 'agent',
  });

  assert.equal(plan.useWebSearch, true);
  assert.equal(plan.webSearchExecutionMode, 'agent');
});

test('agent failure falls back to direct Tavily search', async function () {
  const plan = {
    webSearchExecutionMode: 'agent',
    webSearchMaxResults: 5,
    webSearchTopic: 'general',
  };
  const directPayload = payload('fallback', 'https://example.com/fallback');
  const result = await executeWebSearch('latest release', plan, {
    runWebSearchAgent: async function () {
      const err = new Error('model unavailable');
      err.code = 'AGENT_MODEL_ERROR';
      throw err;
    },
    searchTavily: async function () {
      return directPayload;
    },
  });

  assert.equal(result.searchPayload, directPayload);
  assert.equal(plan.webSearchExecution, 'direct-fallback');
  assert.equal(plan.webSearchFallbackCode, 'AGENT_MODEL_ERROR');
});
