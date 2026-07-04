'use strict';

/**
 * RAG Evaluator — Recall@K and Precision@K measurement.
 *
 * SOLID:
 *   S — One job: given a golden set and a retriever function, compute
 *       retrieval quality metrics.  No embedding, no Firestore, no LLM.
 *   O — New metrics (MRR, NDCG) → add functions below; nothing changes.
 *   D — Takes `retrieveFn` as a parameter (injected), never imports
 *       ragStore directly.  Swap the retriever for a mock in tests.
 *
 * Concepts
 * --------
 *   Golden set  : curated list of { question, expectedArticleId } pairs.
 *                 "For this question, the answer lives in this article."
 *
 *   Recall@K    : of all questions, what fraction had the right article
 *                 appear somewhere in the top-K results?
 *                 Formula: hits / total
 *                 Target : ≥ 0.80 before enabling RAG in production.
 *
 *   Precision@K : of all K slots across all questions, what fraction
 *                 were actually relevant?
 *                 Formula: hits / (total × K)
 *                 Tells you: are we wasting context window with noise?
 *
 *   MRR         : Mean Reciprocal Rank — rewards finding the right chunk
 *                 earlier in the list (rank 1 > rank 3).
 *                 Formula: mean of (1 / rank_of_first_hit) per question.
 *
 * Interview talking point
 * -----------------------
 *   "I evaluate retrieval independently from generation. A Recall@5 below
 *    80 % means the LLM never even sees the right information — no prompt
 *    engineering can fix a retrieval failure. I measure retrieval first,
 *    generation second."
 */

const { embedText }        = require('./embedText');
const { findNearestChunks } = require('./ragStore');

// ── Core metric functions (pure — no I/O) ────────────────────────────────────

/**
 * Given one question's result, check whether the expected article
 * appears anywhere in the returned chunks.
 *
 * @param {Array<{articleId: string}>} chunks  Retrieved chunks (top-K).
 * @param {string}                    expectedArticleId
 * @returns {{ hit: boolean, rank: number|null }}
 *   rank = 1-based position of first hit, null if not found.
 */
function checkHit(chunks, expectedArticleId) {
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].articleId === expectedArticleId) {
      return { hit: true, rank: i + 1 };
    }
  }
  return { hit: false, rank: null };
}

/**
 * Compute Recall@K, Precision@K, and MRR from a list of per-question results.
 *
 * @param {Array<{ hit: boolean, rank: number|null, k: number }>} results
 * @returns {{ recallAtK: number, precisionAtK: number, mrr: number, total: number, hits: number }}
 */
function computeMetrics(results) {
  if (!results || results.length === 0) {
    return { recallAtK: 0, precisionAtK: 0, mrr: 0, total: 0, hits: 0 };
  }
  const total  = results.length;
  const hits   = results.filter((r) => r.hit).length;
  const k      = results[0] ? results[0].k : 1;
  const mrrSum = results.reduce((acc, r) => acc + (r.rank ? 1 / r.rank : 0), 0);

  return {
    recallAtK:    Number((hits / total).toFixed(4)),
    precisionAtK: Number((hits / (total * k)).toFixed(4)),
    mrr:          Number((mrrSum / total).toFixed(4)),
    total,
    hits,
  };
}

// ── Evaluator (I/O) ───────────────────────────────────────────────────────────

/**
 * Run the golden set through the retrieval pipeline and return metrics.
 *
 * @param {Array<{
 *   question:          string,
 *   expectedArticleId: string,
 * }>} goldenSet
 *
 * @param {{
 *   k?:          number,    Top-K to retrieve per question (default 5).
 *   delayMs?:    number,    Pause between questions in ms (default 300).
 *   onProgress?: Function, Called after each question with { index, total, question, hit, rank }.
 * }} opts
 *
 * @returns {Promise<{
 *   metrics:  { recallAtK, precisionAtK, mrr, total, hits },
 *   details:  Array<{ question, expectedArticleId, hit, rank, retrievedArticles }>,
 * }>}
 */
async function evaluateRetrieval(goldenSet, opts = {}) {
  const k        = Math.max(1, Math.min(Number(opts.k) || 5, 20));
  const delayMs  = Number(opts.delayMs) || 300;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const rawResults = [];
  const details    = [];

  for (let i = 0; i < goldenSet.length; i++) {
    const { question, expectedArticleId } = goldenSet[i];

    let chunks = [];
    let hit    = false;
    let rank   = null;
    let error  = null;

    try {
      const queryVector = await embedText(question);
      chunks = await findNearestChunks(queryVector, k);
      ({ hit, rank } = checkHit(chunks, expectedArticleId));
    } catch (err) {
      error = err.message;
    }

    rawResults.push({ hit, rank, k });
    details.push({
      index:             i + 1,
      question,
      expectedArticleId,
      hit,
      rank,
      retrievedArticles: chunks.map((c) => c.articleId),
      error:             error || undefined,
    });

    if (onProgress) {
      onProgress({ index: i + 1, total: goldenSet.length, question, hit, rank });
    }

    if (i < goldenSet.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    metrics: computeMetrics(rawResults),
    details,
  };
}

module.exports = {
  evaluateRetrieval,
  // Exported for unit tests.
  _pure: { checkHit, computeMetrics },
};
