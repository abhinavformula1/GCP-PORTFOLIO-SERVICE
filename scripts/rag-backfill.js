'use strict';

/**
 * RAG Backfill Script
 *
 * Reads every Published article from Firestore and indexes it into the
 * rag_chunks collection.  Run this once before flipping ragEnabled = true
 * in the Admin → AI Config → RAG Mode panel.
 *
 * Usage:
 *   node scripts/rag-backfill.js            → index ALL published articles
 *   node scripts/rag-backfill.js <articleId> → re-index ONE specific article
 *
 * Prerequisites:
 *   1. GEMINI_API_KEY is set in .env
 *   2. Firestore credentials are available (gcloud auth application-default login)
 *   3. Vector index has been deployed:
 *        firebase deploy --only firestore:indexes
 *
 * What it does per article:
 *   1. chunkArticle()   → splits blocks into text pieces
 *   2. deleteChunks()   → removes any stale chunks from a previous run
 *   3. embedText() × N  → calls Google gemini-embedding-* for each chunk
 *   4. saveChunks()     → writes documents into the rag_chunks collection
 *
 * Rate limiting: 200ms pause between articles to stay within Gemini's
 * free-tier embedding quota (1 500 requests/min).
 */

require('dotenv').config();

const { buildComposition } = require('../src/main/composition');
const config = require('../src/infrastructure/config');
const { createRuntime } = require('../src/main/runtime');
const composition = buildComposition(createRuntime(config), { config });
const articlesRepository = composition.repositories.articles;
const { indexArticle } = composition.rag;

const DELAY_BETWEEN_ARTICLES_MS = 1000; // pause between articles
const DELAY_BETWEEN_CHUNKS_MS   = 500;  // pause between chunk embeddings (rate limit)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const targetId = process.argv[2] || null;

  // ── Load articles ──────────────────────────────────────────────────────────
  let articles;
  if (targetId) {
    const article = await articlesRepository.getArticle(targetId);
    if (!article) {
      console.error(`Article not found: ${targetId}`);
      process.exitCode = 1;
      return;
    }
    articles = [article];
  } else {
    const all = await articlesRepository.listArticles();
    articles   = all.filter((a) => a.status.toLowerCase() === 'published');
  }

  if (articles.length === 0) {
    console.log('No published articles found. Nothing to index.');
    return;
  }

  console.log(`\nRAG Backfill — ${articles.length} article(s) to index\n`);
  console.log('─'.repeat(55));

  // ── Index each article ─────────────────────────────────────────────────────
  let totalChunks  = 0;
  let succeeded    = 0;
  let failed       = 0;
  const failures   = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const label   = `[${i + 1}/${articles.length}] ${article.id}`;

    process.stdout.write(`${label} … `);

    try {
      const { indexed } = await indexArticle(article, { chunkDelayMs: DELAY_BETWEEN_CHUNKS_MS });
      totalChunks += indexed;
      succeeded++;
      console.log(`✓  ${indexed} chunks`);
    } catch (err) {
      failed++;
      failures.push({ id: article.id, error: err.message });
      console.log(`✗  ${err.message}`);
    }

    // Respect rate limits — pause between articles, not between chunks
    // (chunk embedding is already sequential inside indexArticle).
    if (i < articles.length - 1) {
      await sleep(DELAY_BETWEEN_ARTICLES_MS);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('─'.repeat(55));
  console.log(`\nDone.`);
  console.log(`  Articles indexed : ${succeeded}`);
  console.log(`  Chunks written   : ${totalChunks}`);
  console.log(`  Failures         : ${failed}`);

  if (failures.length > 0) {
    console.log('\nFailed articles:');
    failures.forEach((f) => console.log(`  • ${f.id} — ${f.error}`));
    process.exitCode = 1;
  } else {
    console.log('\nAll articles indexed successfully.');
    console.log('You can now enable RAG in Admin → AI Config → RAG Mode.\n');
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
