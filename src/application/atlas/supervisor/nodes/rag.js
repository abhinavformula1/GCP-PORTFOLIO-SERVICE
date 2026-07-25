'use strict';

const { assertDependencies } = require('../../../ports/assert');

function createRagNode(dependencies) {
  assertDependencies(dependencies, 'application.atlasSupervisor.ragNode', {
    buildRagContext: 'function',
  });
  const deps = dependencies || {};
  const buildContext = deps.buildRagContext;

  return async function ragNode(state) {
    const startedAt = Date.now();
    try {
      const ragPrompt = await buildContext(state.userMessage, {
        topK: state.plan && state.plan.ragTopK,
        baseSystemPrompt: state.basePrompt,
        atlasCfg: state.atlasCfg,
      });
      return {
        ragPrompt,
        nodeTimings: { ragMs: Date.now() - startedAt },
      };
    } catch (err) {
      return {
        errors: [{
          node: 'rag',
          code: String(err && err.code || 'RAG_ERROR'),
          message: String(err && err.message || 'RAG retrieval failed.'),
        }],
        ragPrompt: state.basePrompt,
        nodeTimings: { ragMs: Date.now() - startedAt },
      };
    }
  };
}

module.exports = { createRagNode };
