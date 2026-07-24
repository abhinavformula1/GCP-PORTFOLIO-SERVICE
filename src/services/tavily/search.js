'use strict';

const config = require('../../config');

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 8;
const WEB_QUERY_PATTERNS = [
  /\b(latest|current|today|tonight|this week|this month|this year|breaking|recent|newly|up[- ]to[- ]date)\b/i,
  /\b(news|headline|announcement|launch|release|released|shipping|price|pricing|stock|market cap|weather|forecast)\b/i,
  /\b(who won|score|result|results|election|match|game|standing|standings)\b/i,
  /\b(as of|right now|currently|at the moment|in \d{4})\b/i,
];

function hasApiKey() {
  return !!config.tavily.apiKey;
}

function normalizeMode(value) {
  const mode = String(value || 'web-intent').trim().toLowerCase();
  if (mode === 'always' || mode === 'disabled' || mode === 'web-intent') return mode;
  return 'web-intent';
}

function normalizeTopic(value) {
  const topic = String(value || 'general').trim().toLowerCase();
  return topic === 'news' ? 'news' : 'general';
}

function normalizeMaxResults(value) {
  const num = Number(value || DEFAULT_MAX_RESULTS);
  if (!Number.isFinite(num) || num < 1) return DEFAULT_MAX_RESULTS;
  return Math.min(MAX_RESULTS_CAP, Math.max(1, Math.round(num)));
}

function looksLikeWebIntent(query) {
  const text = String(query || '').trim();
  if (!text) return false;
  return WEB_QUERY_PATTERNS.some(function (pattern) { return pattern.test(text); });
}

function shouldUseWebSearch(query, atlasCfg) {
  if (!hasApiKey()) return false;
  if (atlasCfg && atlasCfg.webSearchEnabled === false) return false;

  const mode = normalizeMode(atlasCfg && atlasCfg.webSearchMode);
  if (mode === 'disabled') return false;
  if (mode === 'always') return true;
  return looksLikeWebIntent(query);
}

async function searchTavily(query, opts) {
  if (!hasApiKey()) return null;

  const options = opts || {};
  const endpoint = String(config.tavily.baseUrl || 'https://api.tavily.com').replace(/\/+$/, '') + '/search';
  const body = {
    query: String(query || '').trim(),
    topic: normalizeTopic(options.topic),
    search_depth: 'basic',
    max_results: normalizeMaxResults(options.maxResults),
    include_answer: false,
    include_images: false,
    include_raw_content: false,
    include_favicon: false,
    include_usage: false,
    auto_parameters: true,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.tavily.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(function () { return ''; });
    const err = new Error('Tavily upstream error ' + res.status + '.');
    err.code = 'TAVILY_UPSTREAM_ERROR';
    err.statusCode = 502;
    err.upstream = text.slice(0, 500);
    throw err;
  }

  const data = await res.json().catch(function () { return {}; });
  const results = Array.isArray(data.results) ? data.results : [];
  return {
    query: String(data.query || body.query),
    answer: typeof data.answer === 'string' ? data.answer.trim() : '',
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
    responseTime: typeof data.response_time === 'number' ? data.response_time : null,
    results: results
      .map(function (item) {
        if (!item || typeof item !== 'object') return null;
        const title = String(item.title || '').trim();
        const url = String(item.url || '').trim();
        const content = String(item.content || '').trim();
        if (!title || !url || !content) return null;
        return {
          title,
          url,
          content,
          score: typeof item.score === 'number' ? item.score : null,
        };
      })
      .filter(Boolean),
  };
}

function buildWebSearchContext(searchPayload) {
  if (!searchPayload || !Array.isArray(searchPayload.results) || !searchPayload.results.length) return '';
  const lines = [
    'LIVE WEB SEARCH CONTEXT (Tavily)',
    'Use this only for fresh external facts or time-sensitive information.',
    'Prefer portfolio and RAG context for Abhinav-specific experience, projects, and internal product behavior.',
    'If the user asks for current news, current events, or other external live information, answer from this web context instead of redirecting back to portfolio-only topics.',
    'IMPORTANT: The presence of this section means live web search context IS available for grounding.',
    'Do not refuse or redirect an off-topic question when this section is present — answer directly from these sources.',
  ];

  searchPayload.results.forEach(function (result, idx) {
    lines.push('');
    lines.push('[' + (idx + 1) + '] ' + result.title);
    lines.push('URL: ' + result.url);
    if (result.score != null) lines.push('Relevance: ' + result.score);
    lines.push('Snippet: ' + result.content.slice(0, 420));
  });

  lines.push('');
  lines.push('If you use these external sources, cite them inline on each bullet/line you write.');
  lines.push('Format: end each bullet with a short parenthetical publisher label, e.g. "… (Euronews)".');
  lines.push('Do NOT add a separate Sources section — the UI renders sources separately.');
  return lines.join('\n');
}

function toPublicWebSearchMeta(searchPayload) {
  if (!searchPayload || !Array.isArray(searchPayload.results) || !searchPayload.results.length) return null;
  return {
    provider: 'tavily',
    query: searchPayload.query,
    requestId: searchPayload.requestId || '',
    responseTime: searchPayload.responseTime,
    sources: searchPayload.results.map(function (result) {
      return {
        title: result.title,
        url: result.url,
        score: result.score,
      };
    }),
  };
}

module.exports = {
  hasApiKey,
  looksLikeWebIntent,
  shouldUseWebSearch,
  searchTavily,
  buildWebSearchContext,
  toPublicWebSearchMeta,
};
