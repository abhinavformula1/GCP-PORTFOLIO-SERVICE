'use strict';

const {
  StateGraph,
  START,
  END,
} = require('@langchain/langgraph');
const { AtlasSupervisorState } = require('./state');
const { assertDependencies } = require('../../../../application/ports/assert');
const { createWebSearchNode } = require('../../../../application/atlas/supervisor/nodes/webSearch');
const { createRagNode } = require('../../../../application/atlas/supervisor/nodes/rag');

const SUPERVISOR_TIMEOUT_MS = 20_000;

function selectSpecialistNodes(state) {
  const plan = state && state.plan || {};
  const nodes = [];
  if (plan.useWebSearch) nodes.push('webSearch');
  if (plan.useRag) nodes.push('rag');
  return nodes.length ? nodes : END;
}

function createAtlasSupervisorGraph(dependencies) {
  assertDependencies(dependencies, 'infrastructure.langGraphSupervisor', {
    resolveSupervisorPlan: 'function',
    runWebSearchAgent: 'function',
    searchTavily: 'function',
    buildRagContext: 'function',
  });
  const deps = dependencies || {};
  const resolveSupervisorPlan = deps.resolveSupervisorPlan;
  const supervisorNode = async function (state) {
    const startedAt = Date.now();
    const plan = await resolveSupervisorPlan(
      state.userMessage,
      state.atlasCfg,
      state.preliminaryPlan,
      { classify: deps.classify, signal: state.signal }
    );
    return {
      plan,
      nodeTimings: { supervisorMs: Date.now() - startedAt },
    };
  };

  return new StateGraph(AtlasSupervisorState)
    .addNode('supervisor', supervisorNode)
    .addNode('webSearch', createWebSearchNode(deps))
    .addNode('rag', createRagNode(deps))
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', selectSpecialistNodes)
    .addEdge('webSearch', END)
    .addEdge('rag', END)
    .compile();
}

async function runAtlasSupervisorImpl(input, options) {
  const opts = options || {};
  const controller = new AbortController();
  const timeoutMs = Math.max(5_000, Math.min(Number(opts.timeoutMs) || SUPERVISOR_TIMEOUT_MS, 30_000));
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  const externalSignal = opts.signal;
  const onAbort = function () { controller.abort(); };
  if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });

  try {
    const graph = opts.graph || createAtlasSupervisorGraph(opts.dependencies || {});
    return await graph.invoke(Object.assign({}, input, {
      signal: controller.signal,
    }), {
      signal: controller.signal,
      recursionLimit: 8,
      tags: ['atlas', 'langgraph-supervisor'],
      metadata: {
        executionMode: input && input.preliminaryPlan && input.preliminaryPlan.executionMode,
      },
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

module.exports = {
  SUPERVISOR_TIMEOUT_MS,
  selectSpecialistNodes,
  createAtlasSupervisorGraph,
  runAtlasSupervisorImpl,
};
