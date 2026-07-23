'use strict';

const config = require('../../config');

function isCohereConfigured() {
  return !!(config.cohere && config.cohere.apiKey && config.cohere.baseUrl);
}

function normalizeProvider(p) {
  const v = String(p || '').trim().toLowerCase();
  if (v === 'cohere') return 'cohere';
  if (v === 'none' || !v) return 'none';
  return 'none';
}

async function cohereRerank(query, docs, { model, topN }) {
  const baseUrl = String(config.cohere.baseUrl || 'https://api.cohere.com').replace(/\/+$/, '');
  const url = `${baseUrl}/v2/rerank`;
  const m = String(model || 'rerank-v3.5').trim() || 'rerank-v3.5';
  const list = Array.isArray(docs) ? docs : [];
  const N = Math.max(1, Math.min(Number(topN) || list.length, 100));

  const payload = {
    model: m,
    query: String(query || ''),
    documents: list.slice(0, N).map((d) => String(d && d.text ? d.text : '')),
    top_n: N,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.cohere.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cohere rerank failed (${res.status}): ${body.slice(0, 280)}`);
  }

  const data = await res.json().catch(() => ({}));
  const results = Array.isArray(data.results) ? data.results : [];
  const order = results
    .map((r) => (r && typeof r.index === 'number' ? r.index : null))
    .filter((i) => i != null && i >= 0 && i < N);

  const picked = order.map((i) => list[i]).filter(Boolean);
  // In case API returns fewer than N (rare), append remaining in original order.
  if (picked.length < Math.min(N, list.length)) {
    const seen = new Set(picked.map((d) => `${d.articleId}_${d.chunkIndex}`));
    list.forEach((d) => {
      const key = `${d.articleId}_${d.chunkIndex}`;
      if (!seen.has(key) && picked.length < N) picked.push(d);
    });
  }
  return picked;
}

async function rerankIfConfigured(query, chunks, opts) {
  const provider = normalizeProvider(opts && opts.provider);
  const list = Array.isArray(chunks) ? chunks : [];
  if (!list.length) return list;

  const finalK = Math.max(1, Math.min(Number(opts && opts.finalK) || 5, 60));
  const topN = Math.max(finalK, Math.min(Number(opts && opts.topN) || 30, 100));

  if (provider !== 'cohere') return list.slice(0, finalK);
  if (!isCohereConfigured()) return list.slice(0, finalK);

  try {
    const reranked = await cohereRerank(query, list, {
      model: opts && opts.model,
      topN,
    });
    return reranked.slice(0, finalK);
  } catch (err) {
    console.warn('[rerank] fallback to pre-rerank order:', err.message);
    return list.slice(0, finalK);
  }
}

module.exports = { rerankIfConfigured };

