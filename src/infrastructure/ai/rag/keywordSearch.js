'use strict';

/**
 * Keyword retriever (BM25) via Meilisearch.
 *
 * This module is optional: if MEILI_HOST / MEILI_API_KEY are unset, all
 * functions degrade to no-ops so Atlas still works with vector-only search.
 */

const config = require('../../config');

function isMeiliConfigured() {
  return !!(config.meilisearch && config.meilisearch.host && config.meilisearch.apiKey);
}

function meiliHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.meilisearch.apiKey}`,
  };
}

function meiliUrl(path) {
  const base = String(config.meilisearch.host || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${base}/${p}`;
}

function chunkDocId(chunk) {
  const articleId = String(chunk.articleId || '');
  const idx = Number(chunk.chunkIndex || 0);
  return `${articleId}_chunk_${idx}`;
}

async function upsertKeywordChunks(chunks) {
  if (!isMeiliConfigured()) return { ok: false, skipped: true };
  if (!Array.isArray(chunks) || chunks.length === 0) return { ok: true, count: 0 };

  const index = String(config.meilisearch.index || 'rag_chunks');
  const docs = chunks.map((c) => ({
    id: chunkDocId(c),
    articleId: String(c.articleId || ''),
    articleTitle: String(c.articleTitle || ''),
    chunkIndex: Number(c.chunkIndex || 0),
    blockType: String(c.blockType || 'paragraph'),
    text: String(c.text || ''),
  }));

  try {
    const res = await fetch(meiliUrl(`/indexes/${encodeURIComponent(index)}/documents`), {
      method: 'POST',
      headers: meiliHeaders(),
      body: JSON.stringify(docs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meilisearch upsert failed (${res.status}): ${body.slice(0, 280)}`);
    }
    return { ok: true, count: docs.length };
  } catch (err) {
    console.warn('[keyword] upsertKeywordChunks failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function deleteKeywordChunksByArticle(articleId) {
  if (!isMeiliConfigured()) return { ok: false, skipped: true };
  const id = String(articleId || '').trim();
  if (!id) return { ok: true, deleted: 0 };

  const index = String(config.meilisearch.index || 'rag_chunks');
  // Best-effort: Meilisearch supports deletion by filter (newer versions).
  try {
    const res = await fetch(meiliUrl(`/indexes/${encodeURIComponent(index)}/documents/delete`), {
      method: 'POST',
      headers: meiliHeaders(),
      body: JSON.stringify({ filter: `articleId = "${id.replace(/"/g, '\\"')}"` }),
    });
    if (res.ok) return { ok: true };
  } catch (_) {}

  return { ok: false };
}

async function keywordSearch(query, { limit = 20 } = {}) {
  if (!isMeiliConfigured()) return [];
  const q = String(query || '').trim();
  if (!q) return [];

  const index = String(config.meilisearch.index || 'rag_chunks');
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 60));
  try {
    const res = await fetch(meiliUrl(`/indexes/${encodeURIComponent(index)}/search`), {
      method: 'POST',
      headers: meiliHeaders(),
      body: JSON.stringify({
        q,
        limit: safeLimit,
        attributesToRetrieve: ['articleId', 'articleTitle', 'chunkIndex', 'blockType', 'text'],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Meilisearch search failed (${res.status}): ${body.slice(0, 280)}`);
    }
    const data = await res.json().catch(() => ({}));
    const hits = Array.isArray(data.hits) ? data.hits : [];
    return hits.map((h) => ({
      articleId: String(h.articleId || ''),
      articleTitle: String(h.articleTitle || ''),
      chunkIndex: Number(h.chunkIndex || 0),
      blockType: String(h.blockType || 'paragraph'),
      text: String(h.text || ''),
      _keyword: true,
    }));
  } catch (err) {
    console.warn('[keyword] keywordSearch failed:', err.message);
    return [];
  }
}

module.exports = {
  isMeiliConfigured,
  upsertKeywordChunks,
  deleteKeywordChunksByArticle,
  keywordSearch,
};

