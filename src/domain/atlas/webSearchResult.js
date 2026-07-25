'use strict';

const MAX_SNIPPET_CHARS = 700;
const MAX_SOURCES = 8;

function isSafePublicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local')) return false;
    if (/^(127|10)\./.test(host) || /^192\.168\./.test(host)) return false;
    const private172 = host.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return host !== '0.0.0.0' && host !== '::1';
  } catch (_) {
    return false;
  }
}

function normalizeSource(item) {
  if (!item || typeof item !== 'object') return null;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  const url = String(item.url || '').trim();
  const content = String(item.content || '').replace(/\s+/g, ' ').trim();
  if (!title || !content || !isSafePublicUrl(url)) return null;
  return {
    title: title.slice(0, 240),
    url,
    content: content.slice(0, MAX_SNIPPET_CHARS),
    score: typeof item.score === 'number' ? item.score : null,
  };
}

function mergeSearchPayloads(payloads, originalQuery) {
  const calls = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
  const seen = new Set();
  const results = [];

  calls.forEach(function (payload) {
    const items = Array.isArray(payload && payload.results) ? payload.results : [];
    items.forEach(function (item) {
      const normalized = normalizeSource(item);
      if (!normalized) return;
      const key = normalized.url.toLowerCase();
      if (seen.has(key) || results.length >= MAX_SOURCES) return;
      seen.add(key);
      results.push(normalized);
    });
  });

  if (!results.length) return null;
  return {
    query: String(originalQuery || '').trim(),
    requestId: calls.map(function (item) { return String(item.requestId || '').trim(); }).filter(Boolean)[0] || '',
    responseTime: calls.reduce(function (total, item) {
      return total + (typeof item.responseTime === 'number' ? item.responseTime : 0);
    }, 0) || null,
    results,
  };
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';
  return message.content
    .map(function (block) {
      if (typeof block === 'string') return block;
      return block && block.type === 'text' ? String(block.text || '') : '';
    })
    .join('\n')
    .trim();
}

function finalAgentText(result) {
  const messages = result && Array.isArray(result.messages) ? result.messages : [];
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const text = messageText(messages[idx]);
    if (text) return text;
  }
  return '';
}

module.exports = {
  isSafePublicUrl,
  normalizeSource,
  mergeSearchPayloads,
  finalAgentText,
};
