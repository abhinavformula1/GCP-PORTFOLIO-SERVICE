'use strict';

const { assertDependencies } = require('../../../ports/assert');

function errorCode(err, fallback) {
  return String(err && err.code || fallback);
}

function createWebSearchNode(dependencies) {
  assertDependencies(dependencies, 'application.atlasSupervisor.webSearchNode', {
    runWebSearchAgent: 'function',
    searchTavily: 'function',
  });
  const deps = dependencies || {};
  const runAgent = deps.runWebSearchAgent;
  const directSearch = deps.searchTavily;

  return async function webSearchNode(state) {
    const startedAt = Date.now();
    const plan = state.plan || {};
    let searchPayload = null;
    let agentMetadata = null;
    let execution = '';
    let fallbackCode = '';

    if (plan.webSearchExecutionMode === 'agent') {
      try {
        const result = await runAgent(state.userMessage, {
          maxResults: plan.webSearchMaxResults,
          topic: plan.webSearchTopic,
          signal: state.signal,
        });
        searchPayload = result && result.searchPayload;
        agentMetadata = result && result.metadata;
        execution = 'agent';
      } catch (err) {
        execution = 'direct-fallback';
        fallbackCode = errorCode(err, 'AGENT_ERROR');
        console.warn('[atlas/supervisor/web] Agent failed, using direct Tavily fallback:', err.message);
      }
    }

    try {
      if (!searchPayload) {
        searchPayload = await directSearch(state.userMessage, {
          maxResults: plan.webSearchMaxResults,
          topic: plan.webSearchTopic,
          signal: state.signal,
        });
        if (!execution) execution = 'direct';
      }
      return {
        webSearchResult: searchPayload,
        webAgentMetadata: Object.assign({
          execution,
          fallbackCode,
        }, agentMetadata || {}),
        nodeTimings: { webSearchMs: Date.now() - startedAt },
      };
    } catch (err) {
      return {
        errors: [{
          node: 'web-search',
          code: errorCode(err, 'WEB_SEARCH_ERROR'),
          message: String(err && err.message || 'Web search failed.'),
        }],
        webAgentMetadata: { execution, fallbackCode },
        nodeTimings: { webSearchMs: Date.now() - startedAt },
      };
    }
  };
}

module.exports = { createWebSearchNode };
