'use strict';

/**
 * RAG Evaluation Runner
 *
 * Runs 50 realistic visitor questions against the rag_chunks collection
 * and reports Recall@K, Precision@K, and MRR.
 *
 * Usage:
 *   node scripts/rag-eval.js          → run full 50-question golden set
 *   node scripts/rag-eval.js --k=3    → evaluate at K=3
 *   node scripts/rag-eval.js --k=10   → evaluate at K=10
 *
 * Prerequisites:
 *   • GEMINI_API_KEY in .env
 *   • Firestore credentials active (gcloud auth application-default login)
 *   • rag_chunks collection populated (run rag-backfill.js first)
 *
 * Pass/Fail gate:
 *   Recall@5 ≥ 0.80 → PASS  (safe to enable ragEnabled = true in production)
 *   Recall@5 < 0.80 → FAIL  (tune chunk size / overlap before going live)
 *
 * Interview answer this enables:
 *   "I ran Recall@5 on a 50-question golden set before flipping the toggle.
 *    The pipeline scored 84%, which met the 80% gate I set. I then enabled
 *    RAG in production."
 */

require('dotenv').config();

const { buildComposition } = require('../src/main/composition');
const config = require('../src/infrastructure/config');
const { createRuntime } = require('../src/main/runtime');
const composition = buildComposition(createRuntime(config), { config });
const { evaluateRetrieval } = composition.ragEvaluation;
const { GOLDEN_SET }        = require('../src/domain/rag/goldenSet');

const PASS_THRESHOLD = 0.80;

// Golden set is now in src/domain/rag/goldenSet.js (shared with the admin SSE endpoint).

// ── Runner ─────────────────────────────────────────────────────────────────

async function main() {
  const k = parseInt((process.argv.find((a) => a.startsWith('--k=')) || '--k=5').split('=')[1], 10) || 5;

  console.log(`\nRAG Evaluation — Recall@${k}  (${GOLDEN_SET.length} questions)`);
  console.log('═'.repeat(60));
  console.log('Running... this will take ~2 minutes due to rate-limit delays.\n');

  const { metrics, details } = await evaluateRetrieval(GOLDEN_SET, {
    k,
    delayMs: 400,
    onProgress({ index, total, question, hit, rank }) {
      const status = hit ? `✓  rank ${rank}` : '✗  miss';
      const q      = question.length > 52 ? question.slice(0, 49) + '…' : question.padEnd(52);
      console.log(`[${String(index).padStart(2)}/${total}] ${status}  ${q}`);
    },
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`\nResults at K = ${k}`);
  console.log(`  Recall@${k}    : ${(metrics.recallAtK * 100).toFixed(1)}%   (${metrics.hits}/${metrics.total} questions had the right article in top-${k})`);
  console.log(`  Precision@${k} : ${(metrics.precisionAtK * 100).toFixed(1)}%   (relevant chunks as a share of all ${k * metrics.total} retrieved slots)`);
  console.log(`  MRR         : ${metrics.mrr.toFixed(3)}   (mean reciprocal rank — higher = right chunk appears earlier)`);

  const passed = metrics.recallAtK >= PASS_THRESHOLD;
  console.log(`\n  Gate (Recall@${k} ≥ ${(PASS_THRESHOLD * 100).toFixed(0)}%): ${passed ? '✅ PASS' : '❌ FAIL'}`);

  if (passed) {
    console.log('\n  ➜  You can safely enable RAG in Admin → AI Config → RAG Mode.\n');
  } else {
    console.log('\n  ➜  Do NOT enable RAG yet. Tune chunk size or overlap, re-run backfill,');
    console.log('     then re-run this script until the gate passes.\n');
  }

  // ── Missed questions (for debugging) ─────────────────────────────────────
  const misses = details.filter((d) => !d.hit);
  if (misses.length > 0) {
    console.log('─'.repeat(60));
    console.log(`\nMissed questions (${misses.length}):`);
    misses.forEach((d) => {
      console.log(`\n  Q: "${d.question}"`);
      console.log(`     Expected : ${d.expectedArticleId}`);
      console.log(`     Got      : ${d.retrievedArticles.slice(0, 3).join(', ') || '(none)'}`);
      if (d.error) console.log(`     Error    : ${d.error}`);
    });
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => composition.firestore.close().catch((err) => {
    console.error('\nFirestore shutdown failed:', err.message);
    process.exitCode = 1;
  }));
