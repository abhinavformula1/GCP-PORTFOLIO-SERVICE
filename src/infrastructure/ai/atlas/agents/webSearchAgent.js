'use strict';

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { createAgent, toolCallLimitMiddleware } = require('langchain');
const { resolveModel } = require('../../../../domain/llm/models');
const { createWebSearchTool } = require('../tools/webSearchTool');
const { WEB_SEARCH_AGENT_PROMPT } = require('../../../../domain/atlas/webSearchPrompt');
const { finalAgentText, mergeSearchPayloads } = require('../../../../domain/atlas/webSearchResult');

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TOOL_CALLS = 2;

function createWebSearchAgent({ config, traceIfEnabled, searchTavily }) {
if (!config || !config.gemini) {
  throw new TypeError('webSearchAgent.config.gemini is required');
}
if (typeof traceIfEnabled !== 'function') {
  throw new TypeError('webSearchAgent.traceIfEnabled is required');
}
if (typeof searchTavily !== 'function') {
  throw new TypeError('webSearchAgent.searchTavily is required');
}
function agentError(message, code) {
  const err = new Error(message);
  err.code = code;
  err.isOperational = true;
  return err;
}

async function runWebSearchAgentImpl(userMessage, options) {
  const opts = options || {};
  if (!config.gemini.apiKey) throw agentError('Gemini is not configured for the search agent.', 'AGENT_MODEL_NOT_CONFIGURED');

  const timeoutMs = Math.max(1_000, Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 20_000));
  const controller = new AbortController();
  const externalSignal = opts.signal;
  const onAbort = function () { controller.abort(); };
  if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  const payloads = [];
  const startedAt = Date.now();
  const modelInfo = resolveModel(opts.model || 'flash');

  try {
    const model = new ChatGoogleGenerativeAI({
      apiKey: config.gemini.apiKey,
      model: modelInfo.providerModelId,
      temperature: 0.1,
      maxOutputTokens: 500,
      maxRetries: 1,
    });
    const webSearchTool = createWebSearchTool({
      maxResults: opts.maxResults,
      topic: opts.topic,
      signal: controller.signal,
      payloads,
      search: opts.search || searchTavily,
    });
    const agent = createAgent({
      name: 'atlas-web-search-agent',
      model,
      tools: [webSearchTool],
      systemPrompt: WEB_SEARCH_AGENT_PROMPT,
      middleware: [
        toolCallLimitMiddleware({
          toolName: 'web_search',
          runLimit: MAX_TOOL_CALLS,
          exitBehavior: 'end',
        }),
      ],
      signal: controller.signal,
    });

    const result = await agent.invoke(
      { messages: [{ role: 'user', content: String(userMessage || '').trim() }] },
      {
        signal: controller.signal,
        recursionLimit: 12,
        tags: ['atlas', 'web-search-agent'],
        metadata: { model: modelInfo.key, maxToolCalls: MAX_TOOL_CALLS },
      }
    );
    const searchPayload = mergeSearchPayloads(payloads, userMessage);
    if (!searchPayload) throw agentError('The search agent returned no usable web sources.', 'AGENT_EMPTY_RESULT');

    return {
      searchPayload,
      researchBrief: finalAgentText(result),
      metadata: {
        mode: 'agent',
        model: modelInfo.key,
        toolCalls: payloads.length,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (err) {
    if (controller.signal.aborted && (!err || err.code !== 'AGENT_EMPTY_RESULT')) {
      throw agentError('The search agent timed out.', 'AGENT_TIMEOUT');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

const runWebSearchAgent = traceIfEnabled(runWebSearchAgentImpl, {
  name: 'atlas.web-search-agent',
  run_type: 'chain',
  tags: ['atlas', 'agent', 'web-search'],
});

  return Object.freeze({
    runWebSearchAgent,
    runWebSearchAgentImpl,
    DEFAULT_TIMEOUT_MS,
    MAX_TOOL_CALLS,
  });
}

module.exports = { createWebSearchAgent, DEFAULT_TIMEOUT_MS, MAX_TOOL_CALLS };
