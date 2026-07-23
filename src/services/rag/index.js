'use strict';

/**
 * RAG Orchestrator — the single entry point for all RAG operations.
 *
 * SOLID:
 *   S — One job: wire the individual RAG services together.
 *       It knows *what* to call and *in what order*, not *how* each step works.
 *   D — High-level callers (atlas/respond.js, admin routes) depend on this
 *       abstraction, never on embedText / ragStore / ragPrompt directly.
 *       This is the Dependency Inversion boundary: swap any inner service
 *       (e.g. different embedding model, pgvector instead of Firestore)
 *       and this file is the only one that needs updating.
 *
 * Public API
 * ----------
 *   buildRagContext(userMessage, { topK, baseSystemPrompt })
 *     → Embed the question, retrieve top-K chunks, return augmented prompt.
 *       Gracefully degrades to baseSystemPrompt on any failure so the Atlas
 *       chat never breaks even if RAG is partially unavailable.
 *
 *   indexArticle(article)
 *     → Chunk + embed + store an article.  Call after publish/update.
 *
 *   removeArticleChunks(articleId)
 *     → Delete all chunks for an article.  Call on unpublish / delete.
 */

const { embedText }            = require('./embedText');
const { chunkArticle }         = require('./chunkArticle');
const {
  saveChunks,
  deleteChunksForArticle,
  findNearestChunks,
}                              = require('./ragStore');
const { buildRagSystemPrompt } = require('./ragPrompt');
const adminConfig              = require('../adminConfig');
const {
  keywordSearch,
  upsertKeywordChunks,
  deleteKeywordChunksByArticle,
}                              = require('./keywordSearch');
const { rerankIfConfigured }   = require('./rerank');

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.trunc(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function computeDistanceThreshold(similarityThreshold, distanceMeasure) {
  const s = Number(similarityThreshold);
  if (!Number.isFinite(s) || s <= 0) return null;
  const metric = String(distanceMeasure || 'COSINE').toUpperCase();
  // UI uses "Similarity Threshold (0..1)" semantics. Firestore expects distance.
  // For COSINE distance, similarity ≈ 1 - distance (typical implementation).
  if (metric === 'COSINE') return Math.max(0, Math.min(1, 1 - s));
  return null;
}

function docKey(chunk) {
  return `${String(chunk.articleId || '')}_chunk_${Number(chunk.chunkIndex || 0)}`;
}

function rrfFuse(a, b, { k = 60, limit = 20 } = {}) {
  const K = Math.max(1, Math.min(Number(k) || 60, 200));
  const L = Math.max(1, Math.min(Number(limit) || 20, 60));
  const score = new Map();
  const pick = new Map(); // key -> representative chunk

  function add(list) {
    (Array.isArray(list) ? list : []).forEach((item, idx) => {
      const key = docKey(item);
      if (!pick.has(key)) pick.set(key, item);
      const rank = idx + 1;
      const inc = 1 / (K + rank);
      score.set(key, (score.get(key) || 0) + inc);
    });
  }

  add(a);
  add(b);

  return Array.from(score.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, L)
    .map(([key]) => pick.get(key))
    .filter(Boolean);
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/**
 * Build an augmented system prompt for one user question.
 *
 * Steps:
 *   1. Embed the user's question  (embedText)
 *   2. Find the top-K closest chunks  (findNearestChunks)
 *   3. Prepend them to the base system prompt  (buildRagSystemPrompt)
 *
 * Degrades gracefully: any failure returns baseSystemPrompt unchanged.
 * Atlas chat is never blocked by RAG unavailability.
 *
 * @param {string} userMessage
 * @param {{ topK?: number, baseSystemPrompt: string, atlasCfg?: object }} opts
 * @returns {Promise<string>}  Augmented (or original) system prompt.
 */
async function buildRagContext(userMessage, { topK = 5, baseSystemPrompt, atlasCfg } = {}) {
  try {
    const cfg = atlasCfg || await adminConfig.getAtlasConfig().catch(() => null);
    const embeddingModel = cfg && cfg.embeddingModel ? cfg.embeddingModel : undefined;
    const embeddingDims  = cfg && typeof cfg.embeddingDimensions === 'number' ? cfg.embeddingDimensions : undefined;
    const distanceMeasure = cfg && cfg.distanceMetric ? cfg.distanceMetric : undefined;
    const distanceThreshold = computeDistanceThreshold(cfg && cfg.similarityThreshold, distanceMeasure);

    const queryVector = await embedText(userMessage, {
      model: embeddingModel,
      outputDimensionality: embeddingDims,
    });
    const vectorChunks = await findNearestChunks(queryVector, topK, {
      distanceMeasure,
      distanceThreshold,
    });

    let chunks = vectorChunks;

    const hybridEnabled = !!(cfg && cfg.hybridSearchEnabled);
    const keywordProvider = cfg && typeof cfg.keywordSearchProvider === 'string'
      ? cfg.keywordSearchProvider
      : 'none';
    if (hybridEnabled && keywordProvider === 'meilisearch') {
      const keywordLimit = Math.max(10, Math.min((Number(topK) || 5) * 6, 60));
      const keywordChunks = await keywordSearch(userMessage, { limit: keywordLimit });
      const fusion = cfg && typeof cfg.fusionStrategy === 'string' ? cfg.fusionStrategy : 'rrf';
      if (fusion === 'rrf') {
        chunks = rrfFuse(vectorChunks, keywordChunks, { k: cfg && cfg.rrfK, limit: topK });
      } else {
        chunks = vectorChunks;
      }
    }

    const rerankerEnabled = !!(cfg && cfg.rerankerEnabled);
    if (rerankerEnabled) {
      const topN = cfg && typeof cfg.rerankerTopN === 'number' ? cfg.rerankerTopN : 30;
      chunks = await rerankIfConfigured(userMessage, chunks, {
        provider: cfg && cfg.rerankerProvider,
        model: cfg && cfg.rerankerModel,
        topN,
        finalK: topK,
      });
    }

    return buildRagSystemPrompt(chunks, baseSystemPrompt);
  } catch (err) {
    // Log but never crash the chat.  The caller gets the plain persona prompt.
    console.warn('[rag] buildRagContext failed, falling back to base prompt:', err.message);
    return baseSystemPrompt;
  }
}

// ── Indexing ──────────────────────────────────────────────────────────────────

/**
 * Index a single published article into the RAG knowledge base.
 *
 * Steps:
 *   1. Chunk the article into block-level text pieces  (chunkArticle)
 *   2. Delete stale chunks from a previous index run  (deleteChunksForArticle)
 *   3. Embed each chunk  (embedText — one API call per chunk)
 *   4. Store chunks with their embeddings  (saveChunks)
 *
 * The delete-before-write pattern ensures a shorter re-edit never leaves
 * orphan chunks from the previous version (e.g. article shrinks from 20
 * blocks to 12 — without delete, chunks 12-19 would persist forever).
 *
 * Embedding calls are sequential (not concurrent) to stay within Gemini
 * API rate limits.  For a typical 10-chunk article this takes ~2-3 seconds
 * and happens in the background — the article save itself is not blocked.
 *
 * @param {{
 *   id:     string,
 *   en:     { title: string },
 *   blocks: object[],
 * }} article
 *
 * @returns {Promise<{ indexed: number }>}  Number of chunks written.
 */
async function indexArticle(article, { chunkDelayMs = 0 } = {}) {
  const cfg = await adminConfig.getAtlasConfig().catch(() => null);
  const chunks = chunkArticle(article, cfg || {});
  if (chunks.length === 0) return { indexed: 0 };

  await deleteChunksForArticle(article.id);
  // Best-effort: keep keyword index in sync too.
  deleteKeywordChunksByArticle(article.id).catch(() => {});

  const embeddingModel = cfg && cfg.embeddingModel ? cfg.embeddingModel : undefined;
  const embeddingDims  = cfg && typeof cfg.embeddingDimensions === 'number' ? cfg.embeddingDimensions : undefined;
  const batchSize = clampInt(cfg && cfg.embeddingBatchSize, 1, 50) || 1;

  const chunksWithEmbeddings = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const slice = chunks.slice(i, i + batchSize);
    const embedded = await Promise.all(slice.map(async (chunk) => {
      const embedding = await embedText(chunk.text, { model: embeddingModel, outputDimensionality: embeddingDims });
      return { ...chunk, embedding };
    }));
    chunksWithEmbeddings.push(...embedded);

    if (chunkDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
    }
  }

  await saveChunks(chunksWithEmbeddings);
  // Keyword index stores only text + metadata (no embeddings).
  upsertKeywordChunks(chunks).catch(() => {});

  console.log('[rag] indexed', { articleId: article.id, chunks: chunksWithEmbeddings.length });
  return { indexed: chunksWithEmbeddings.length };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Remove all RAG chunks for an article.
 *
 * Call when: article is unpublished, drafted, or hard-deleted.
 *
 * @param {string} articleId
 */
async function removeArticleChunks(articleId) {
  await deleteChunksForArticle(articleId);
  deleteKeywordChunksByArticle(articleId).catch(() => {});
  console.log('[rag] removed chunks for article:', articleId);
}

module.exports = {
  buildRagContext,
  indexArticle,
  removeArticleChunks,
};
