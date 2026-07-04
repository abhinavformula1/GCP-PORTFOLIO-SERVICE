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
 * @param {{ topK?: number, baseSystemPrompt: string }} opts
 * @returns {Promise<string>}  Augmented (or original) system prompt.
 */
async function buildRagContext(userMessage, { topK = 5, baseSystemPrompt }) {
  try {
    const queryVector = await embedText(userMessage);
    const chunks      = await findNearestChunks(queryVector, topK);
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
async function indexArticle(article) {
  const chunks = chunkArticle(article);
  if (chunks.length === 0) return { indexed: 0 };

  await deleteChunksForArticle(article.id);

  const chunksWithEmbeddings = [];
  for (const chunk of chunks) {
    const embedding = await embedText(chunk.text);
    chunksWithEmbeddings.push({ ...chunk, embedding });
  }

  await saveChunks(chunksWithEmbeddings);

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
  console.log('[rag] removed chunks for article:', articleId);
}

module.exports = {
  buildRagContext,
  indexArticle,
  removeArticleChunks,
};
