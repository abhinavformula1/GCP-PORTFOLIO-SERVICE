'use strict';

const { tool } = require('langchain');
const { z } = require('zod');
const { mergeSearchPayloads } = require('../../../../domain/atlas/webSearchResult');

const MAX_QUERY_CHARS = 300;

function createWebSearchTool(options) {
  const opts = options || {};
  if (typeof opts.search !== 'function') {
    throw new TypeError('infrastructure.webSearchTool.search: required function is missing');
  }
  const search = opts.search;
  const payloads = Array.isArray(opts.payloads) ? opts.payloads : [];

  return tool(
    async function runWebSearch({ query }) {
      const safeQuery = String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
      if (!safeQuery) return JSON.stringify({ ok: false, error: 'A non-empty query is required.' });

      const payload = await search(safeQuery, {
        maxResults: opts.maxResults,
        topic: opts.topic,
        signal: opts.signal,
      });
      if (payload) payloads.push(payload);

      const normalized = mergeSearchPayloads(payload ? [payload] : [], safeQuery);
      if (!normalized) return JSON.stringify({ ok: true, query: safeQuery, results: [] });

      return JSON.stringify({
        ok: true,
        query: safeQuery,
        results: normalized.results.map(function (result) {
          return {
            title: result.title,
            url: result.url,
            snippet: result.content,
            score: result.score,
          };
        }),
      });
    },
    {
      name: 'web_search',
      description: 'Search the live public web for current, recent, or external factual information.',
      schema: z.object({
        query: z.string().min(2).max(MAX_QUERY_CHARS).describe('A focused standalone web search query.'),
      }),
    }
  );
}

module.exports = { createWebSearchTool, MAX_QUERY_CHARS };
