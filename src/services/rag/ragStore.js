'use strict';

/**
 * RAG storage service.
 *
 * SOLID:
 *   S — One job: read and write the `rag_chunks` Firestore collection.
 *       No chunking logic.  No embedding.  No prompt building.
 *   I — Three focused exports; callers import only what they need.
 *       The retriever never imports saveChunks.  The indexer never
 *       imports findNearestChunks.
 *   D — Depends on the `getDb()` abstraction from services/firestore,
 *       not on the Firestore SDK directly.  Swap the DB layer by
 *       replacing getDb() — nothing here changes.
 *
 * Collection layout
 * -----------------
 *   rag_chunks/{articleId}_chunk_{chunkIndex}
 *     articleId    : string
 *     articleTitle : string
 *     chunkIndex   : number
 *     blockType    : string  (paragraph | heading | code | matrix | list | …)
 *     text         : string  (raw plain text, max 4 000 chars)
 *     embedding    : vector  (768-dim, text-embedding-004)
 *     indexedAt    : timestamp
 *
 * Document IDs are deterministic so re-indexing the same article is a
 * pure upsert — no orphan documents accumulate on edits.
 */

const { FieldValue, VectorValue } = require('@google-cloud/firestore');
const { getDb }                   = require('../firestore');

const RAG_COLLECTION   = 'rag_chunks';
const VECTOR_FIELD     = 'embedding';
const DISTANCE_MEASURE = 'COSINE'; // best for normalised text embeddings

// Firestore batch writes cap at 500 ops; stay safely below.
const BATCH_SIZE = 400;

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Batch-write chunks (with pre-computed embeddings) to Firestore.
 *
 * Each document id is `{articleId}_chunk_{chunkIndex}` — deterministic so
 * that saving the same article twice performs an upsert, not a duplicate.
 *
 * @param {Array<{
 *   articleId:    string,
 *   articleTitle: string,
 *   chunkIndex:   number,
 *   blockType:    string,
 *   text:         string,
 *   embedding:    number[],
 * }>} chunks
 */
async function saveChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return;

  const db     = getDb();
  const colRef = db.collection(RAG_COLLECTION);
  const now    = FieldValue.serverTimestamp();

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const chunk of slice) {
      const docId = `${chunk.articleId}_chunk_${chunk.chunkIndex}`;
      batch.set(colRef.doc(docId), {
        articleId:    String(chunk.articleId    || ''),
        articleTitle: String(chunk.articleTitle || ''),
        chunkIndex:   Number(chunk.chunkIndex),
        blockType:    String(chunk.blockType    || 'paragraph'),
        text:         String(chunk.text         || '').slice(0, 4000),
        // VectorValue wraps the float[] so Firestore stores it as a
        // first-class vector field that findNearest can operate on.
        [VECTOR_FIELD]: FieldValue.vector(chunk.embedding),
        indexedAt:    now,
      });
    }

    await batch.commit();
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete all chunks belonging to a given article.
 *
 * Call this:
 *   • Before re-indexing an edited article (prevents stale orphan chunks).
 *   • When an article is unpublished or deleted.
 *
 * @param {string} articleId
 */
async function deleteChunksForArticle(articleId) {
  if (!articleId) return;

  const db   = getDb();
  const snap = await db
    .collection(RAG_COLLECTION)
    .where('articleId', '==', String(articleId))
    .get();

  if (snap.empty) return;

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    snap.docs.slice(i, i + BATCH_SIZE).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

// ── Read (vector search) ──────────────────────────────────────────────────────

/**
 * Return the top-K most semantically similar chunks for a query vector.
 *
 * Uses Firestore's built-in findNearest (COSINE distance) — no external
 * vector DB required.  A vector index on the `embedding` field must exist
 * in firestore.indexes.json before this will work in production.
 *
 * @param {number[]} queryVector   Embedding of the user's question (768-dim).
 * @param {number}   topK          Number of chunks to return (clamped 1–20).
 * @returns {Promise<Array<{
 *   articleId:    string,
 *   articleTitle: string,
 *   chunkIndex:   number,
 *   blockType:    string,
 *   text:         string,
 * }>>}
 */
async function findNearestChunks(queryVector, topK) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) return [];

  const k  = Math.max(1, Math.min(Number(topK) || 5, 20));
  const db = getDb();

  const snap = await db
    .collection(RAG_COLLECTION)
    .findNearest({
      vectorField:     VECTOR_FIELD,
      queryVector:     new VectorValue(queryVector),
      limit:           k,
      distanceMeasure: DISTANCE_MEASURE,
    })
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      articleId:    String(d.articleId    || ''),
      articleTitle: String(d.articleTitle || ''),
      chunkIndex:   Number(d.chunkIndex   || 0),
      blockType:    String(d.blockType    || 'paragraph'),
      text:         String(d.text         || ''),
    };
  });
}

module.exports = {
  saveChunks,
  deleteChunksForArticle,
  findNearestChunks,
};
