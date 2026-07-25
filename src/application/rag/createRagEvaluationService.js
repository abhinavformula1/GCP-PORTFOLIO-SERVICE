'use strict';

const { assertDependencies } = require('../ports/assert');

function createRagEvaluationService(dependencies) {
  assertDependencies(dependencies, 'application.ragEvaluation', { embedText: 'function', findNearestChunks: 'function', getChunksForArticle: 'function', generateChatResponse: 'function' });
  const { embedText, findNearestChunks, getChunksForArticle, generateChatResponse } = dependencies;

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

const { buildRagSystemPrompt } = require('../../domain/rag/ragPrompt');

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

const JUDGE_SYSTEM_PROMPT = [
  'You are a strict offline evaluator for a retrieval augmented generation system.',
  'Score the candidate answer using only the provided retrieved context and reference context.',
  'Return JSON only. No markdown, no prose, no code fences.',
  'Scoring rules:',
  '- faithfulness: fraction of answer claims that are supported by the retrieved context.',
  '- hallucination: fraction of answer claims that are unsupported or contradicted by the retrieved context.',
  '- answerCorrectness: how correct and complete the answer is versus the reference answer or reference article context.',
  '- All scores must be numbers between 0 and 1.',
  '- If there are no clear claims, return zeros.',
].join('\n');

function meanMetric(values) {
  const nums = (values || []).filter(function (v) { return Number.isFinite(v); });
  if (!nums.length) return null;
  const sum = nums.reduce(function (acc, v) { return acc + v; }, 0);
  return Number((sum / nums.length).toFixed(4));
}

function normaliseScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(1, Number(num.toFixed(4))));
}

function compactChunkText(chunks, maxChunks, maxCharsPerChunk) {
  return (Array.isArray(chunks) ? chunks : [])
    .slice(0, maxChunks)
    .map(function (chunk, index) {
      const text = String(chunk && chunk.text || '').trim().slice(0, maxCharsPerChunk);
      return [
        '[' + (index + 1) + '] ' + String(chunk && chunk.articleTitle || chunk && chunk.articleId || 'Unknown source'),
        'Type: ' + String(chunk && chunk.blockType || 'paragraph'),
        text,
      ].join('\n');
    })
    .join('\n\n');
}

function buildJudgeUserMessage(args) {
  return [
    'Question:',
    String(args.question || ''),
    '',
    'Candidate answer:',
    String(args.answer || ''),
    '',
    'Retrieved context used by the generator:',
    compactChunkText(args.retrievedChunks, 5, 900) || 'None',
    '',
    'Reference article context:',
    compactChunkText(args.referenceChunks, 6, 700) || 'None',
    '',
    'Expected answer (optional):',
    String(args.expectedAnswer || '').trim() || 'None',
    '',
    'Return JSON with this exact shape:',
    '{"claimCount":0,"supportedClaims":0,"unsupportedClaims":0,"contradictedClaims":0,"faithfulness":0,"hallucination":0,"answerCorrectness":0,"reasoning":"brief"}',
  ].join('\n');
}

function parseJudgeJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Judge returned empty response.');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Judge did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

async function runGenerationJudge(args) {
  const judgeResponse = await generateChatResponse({
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    history: [],
    userMessage: buildJudgeUserMessage(args),
    model: args.judgeModel || 'flash-lite',
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 500,
    },
  });

  const parsed = parseJudgeJson(judgeResponse && judgeResponse.text);
  const claimCount = Math.max(0, Number(parsed.claimCount || 0));
  const supportedClaims = Math.max(0, Number(parsed.supportedClaims || 0));
  const unsupportedClaims = Math.max(0, Number(parsed.unsupportedClaims || 0));
  const contradictedClaims = Math.max(0, Number(parsed.contradictedClaims || 0));

  return {
    claimCount,
    supportedClaims,
    unsupportedClaims,
    contradictedClaims,
    faithfulness: normaliseScore(parsed.faithfulness),
    hallucination: normaliseScore(parsed.hallucination),
    answerCorrectness: normaliseScore(parsed.answerCorrectness),
    reasoning: String(parsed.reasoning || '').trim(),
  };
}

// ── Evaluator (I/O) ───────────────────────────────────────────────────────────

/**
 * Run the golden set through the retrieval pipeline and return metrics.
 *
 * @param {Array<{
 *   question:          string,
 *   expectedArticleId: string,
 *   expectedAnswer?:   string,
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
  const generationEval = opts.generationEval && opts.generationEval.enabled
    ? opts.generationEval
    : null;

  const rawResults = [];
  const details    = [];

  for (let i = 0; i < goldenSet.length; i++) {
    const { question, expectedArticleId, expectedAnswer } = goldenSet[i];

    let chunks = [];
    let hit    = false;
    let rank   = null;
    let error  = null;
    let answer = '';
    let generationError = null;
    let generationScores = null;

    try {
      const queryVector = await embedText(question);
      chunks = await findNearestChunks(queryVector, k);
      ({ hit, rank } = checkHit(chunks, expectedArticleId));
    } catch (err) {
      error = err.message;
    }

    if (generationEval) {
      try {
        const basePrompt = String(generationEval.baseSystemPrompt || '').trim();
        const systemPrompt = buildRagSystemPrompt(chunks, basePrompt);
        const generated = await generateChatResponse({
          systemPrompt,
          history: [],
          userMessage: question,
          model: generationEval.answerModel || 'flash-lite',
          generationConfig: generationEval.answerGenerationConfig || undefined,
        });
        answer = String(generated && generated.text || '').trim();

        const referenceChunks = expectedArticleId
          ? await getChunksForArticle(expectedArticleId).catch(function () { return []; })
          : [];

        generationScores = await runGenerationJudge({
          question,
          answer,
          retrievedChunks: chunks,
          referenceChunks,
          expectedAnswer,
          judgeModel: generationEval.judgeModel || 'flash-lite',
        });
      } catch (err) {
        generationError = err.message;
      }
    }

    rawResults.push({ hit, rank, k });
    details.push({
      index:             i + 1,
      question,
      expectedArticleId,
      hit,
      rank,
      retrievedArticles: chunks.map((c) => c.articleId),
      answer,
      expectedAnswer: expectedAnswer || '',
      faithfulness: generationScores ? generationScores.faithfulness : null,
      hallucination: generationScores ? generationScores.hallucination : null,
      answerCorrectness: generationScores ? generationScores.answerCorrectness : null,
      claimCount: generationScores ? generationScores.claimCount : 0,
      supportedClaims: generationScores ? generationScores.supportedClaims : 0,
      unsupportedClaims: generationScores ? generationScores.unsupportedClaims : 0,
      contradictedClaims: generationScores ? generationScores.contradictedClaims : 0,
      generationReasoning: generationScores ? generationScores.reasoning : '',
      generationError: generationError || undefined,
      error:             error || undefined,
    });

    if (onProgress) {
      onProgress({ index: i + 1, total: goldenSet.length, question, hit, rank });
    }

    if (i < goldenSet.length - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const metrics = computeMetrics(rawResults);
  if (generationEval) {
    metrics.faithfulness = meanMetric(details.map(function (d) { return d.faithfulness; }));
    metrics.hallucination = meanMetric(details.map(function (d) { return d.hallucination; }));
    metrics.answerCorrectness = meanMetric(details.map(function (d) { return d.answerCorrectness; }));
  }

  return {
    metrics,
    details,
  };
}

  return {
  evaluateRetrieval,
  // Exported for unit tests.
  _pure: { checkHit, computeMetrics },
};
}

module.exports = { createRagEvaluationService };
