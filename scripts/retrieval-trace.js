'use strict';

/**
 * Retrieval Trace (learning tool)
 *
 * Prints each step of Atlas retrieval on real Firestore data:
 *  - vector search (Firestore findNearest)
 *  - optional BM25 keyword search (Meilisearch)
 *  - optional fusion (RRF - Reciprocal Rank Fusion)
 *  - optional rerank (Cohere)
 *
 * Read-only by default.
 *
 * Usage:
 *   node scripts/retrieval-trace.js --title "Why We Didn't Use RAG (Yet)"
 *   node scripts/retrieval-trace.js --id "why-we-didn\u2019t-use-rag-yet" --query "why not rag" --topK 8
 */

require('dotenv').config();

let closeInfrastructure = () => Promise.resolve();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (v == null) return '';
  if (String(v).startsWith('--')) return '';
  return String(v);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureProjectId() {
  const fromEnv = String(
    process.env.FIRESTORE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    ''
  ).trim();
  if (fromEnv) return fromEnv;

  // Best-effort: infer from local gcloud config (common on developer machines).
  try {
    const { execSync } = require('node:child_process');
    const out = String(execSync('gcloud config get-value project', { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
    if (out && out !== '(unset)') {
      process.env.FIRESTORE_PROJECT_ID = out;
      return out;
    }
  } catch (_) {}

  return '';
}

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.trunc(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function preview(text, n = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function computeDistanceThreshold(similarityThreshold, distanceMeasure) {
  const s = Number(similarityThreshold);
  if (!Number.isFinite(s) || s <= 0) return null;
  const metric = String(distanceMeasure || 'COSINE').toUpperCase();
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
  const pick = new Map();

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

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Local BM25 (learning-only)
 *
 * This is NOT a replacement for Meilisearch. It's a lightweight implementation
 * so you can understand BM25 scoring on a small corpus (e.g. one article's chunks)
 * without running extra infrastructure locally.
 */
function bm25Rank(query, docs, { k1 = 1.5, b = 0.75, limit = 20 } = {}) {
  const list = Array.isArray(docs) ? docs : [];
  const N = list.length;
  if (!N) return [];

  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  // Build corpus stats.
  const docTokens = [];
  const docLens = [];
  const df = new Map(); // term -> doc freq
  for (const d of list) {
    const toks = tokenize(d && d.text ? d.text : '');
    docTokens.push(toks);
    docLens.push(toks.length);
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgdl = docLens.reduce((a, x) => a + x, 0) / Math.max(1, N);

  function idf(term) {
    const n = df.get(term) || 0;
    // Standard BM25 idf (smoothed).
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  const scored = list.map((d, idx) => {
    const toks = docTokens[idx];
    const dl = docLens[idx] || 0;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const term of qTokens) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const denom = f + k1 * (1 - b + b * (dl / (avgdl || 1)));
      score += idf(term) * (f * (k1 + 1)) / (denom || 1);
    }

    return Object.assign({}, d, { _bm25: true, bm25_score: score });
  });

  return scored
    .filter((d) => Number(d.bm25_score) > 0)
    .sort((a, b2) => b2.bm25_score - a.bm25_score)
    .slice(0, Math.max(1, Math.min(Number(limit) || 20, 60)));
}

// Select an article based on CLI input:
// - if --id is provided, fetch that one article via Firestore (getArticle)
// - otherwise, load all articles from Firestore (listArticles) and match by title
async function findArticle(articlesRepository, { id, title }) {
  console.log("### 1. title :: ",title);
  console.log("### 2. id ::",id);
  if (id) {
    const a = await articlesRepository.getArticle(id);
    if (!a) throw new Error(`Article not found by id: ${id}`);
    return a;
  }

  const want = normalizeText(title);
  const all = await articlesRepository.listArticles();

  // Exact title match first, then substring match.
  let hit = all.find((a) => normalizeText(a?.en?.title) === want);
  if (!hit) hit = all.find((a) => normalizeText(a?.en?.title).includes(want));
  if (!hit) throw new Error(`Article not found by title: ${title}`);
  return hit;
}

async function vectorSearchWithDistance(db, queryVector, topK, { distanceMeasure, distanceThreshold } = {}) {
  const k = Math.max(1, Math.min(Number(topK) || 5, 20));
  const metric = String(distanceMeasure || 'COSINE').toUpperCase();
  const opts = {
    vectorField: 'embedding',
    queryVector,
    limit: k,
    distanceMeasure: metric,
    distanceResultField: 'vector_distance',
  };
  if (distanceThreshold != null) opts.distanceThreshold = distanceThreshold;

  const snap = await db.collection('rag_chunks').findNearest(opts).get();
  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      articleId: String(d.articleId || ''),
      articleTitle: String(d.articleTitle || ''),
      chunkIndex: Number(d.chunkIndex || 0),
      blockType: String(d.blockType || 'paragraph'),
      text: String(d.text || ''),
      vector_distance: typeof d.vector_distance === 'number' ? d.vector_distance : null,
    };
  });
}

async function countChunksForArticle(db, articleId) {
  const snap = await db.collection('rag_chunks').where('articleId', '==', String(articleId)).get();
  return snap.size || 0;
}

async function loadChunksForArticle(db, articleId) {
  const snap = await db.collection('rag_chunks').where('articleId', '==', String(articleId)).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id,
        articleId: String(d.articleId || ''),
        articleTitle: String(d.articleTitle || ''),
        chunkIndex: Number(d.chunkIndex || 0),
        blockType: String(d.blockType || 'paragraph'),
        text: String(d.text || ''),
      };
    })
    .sort((a, b2) => a.chunkIndex - b2.chunkIndex);
}

function printList(label, chunks, { max = 8, filterArticleId = null, showDistance = false } = {}) {
  const list = Array.isArray(chunks) ? chunks : [];
  const scoped = filterArticleId
    ? list.filter((c) => String(c.articleId || '') === String(filterArticleId))
    : list;
  console.log(`\n${label} (showing ${Math.min(max, scoped.length)}/${scoped.length})`);
  scoped.slice(0, max).forEach((c, i) => {
    const dist = showDistance && c.vector_distance != null ? ` dist=${c.vector_distance.toFixed(4)}` : '';
    const src = c._keyword || c._bm25 ? ' [bm25]' : '';
    const score = c._bm25 && typeof c.bm25_score === 'number' ? ` score=${c.bm25_score.toFixed(3)}` : '';
    console.log(
      `  ${String(i + 1).padStart(2, ' ')}.${src} ${c.articleId}#${c.chunkIndex}${dist}${score} :: ${preview(c.text)}`
    );
  });
  return scoped;
}

async function main() {
  console.log("### 1. Inside the main method :: ");
  const project = argValue('--project') || ensureProjectId();
  if (project && !process.env.FIRESTORE_PROJECT_ID) process.env.FIRESTORE_PROJECT_ID = project;

  const { loadConfig } = require('../src/infrastructure/config');
  const { createRuntime } = require('../src/main/runtime');
  const { buildComposition } = require('../src/main/composition');
  const config = loadConfig(process.env);
  const composition = buildComposition(createRuntime(config), { config });
  closeInfrastructure = composition.firestore.close;
  const adminConfig = composition.adminConfig;
  const articlesRepository = composition.repositories.articles;
  const { embedText } = require('../src/infrastructure/ai/rag/embedText');
  const { keywordSearch, isMeiliConfigured } = require('../src/infrastructure/ai/rag/keywordSearch');
  const { rerankIfConfigured } = require('../src/infrastructure/ai/rag/rerank');
  const { indexArticle } = composition.rag;
  const db = composition.firestore.getDb();

  const title = argValue('--title') || "Why We Didn't Use RAG (Yet)";
  const id = argValue('--id');
  const query = argValue('--query') || "Why didn't we use RAG yet?";
  const topK = clampInt(argValue('--topK') || 6, 1, 20) || 6;
  const showAll = hasFlag('--all'); // show results across all articles, not just the chosen one
  const doIndex = hasFlag('--index'); // write chunks if missing
  const localBm25 = hasFlag('--local-bm25'); // BM25 without Meilisearch (learning)
  const forceHybrid = hasFlag('--force-hybrid'); // run fusion even if config disabled

  console.log("### 2. Calling findArticle from main method :: ");
  const article = await findArticle(articlesRepository, { id, title });
  const cfg = await adminConfig.getAtlasConfig().catch(() => ({}));

  const distanceMeasure = cfg && cfg.distanceMetric ? cfg.distanceMetric : 'COSINE';
  const distanceThreshold = computeDistanceThreshold(cfg && cfg.similarityThreshold, distanceMeasure);
  const embeddingModel = cfg && cfg.embeddingModel ? cfg.embeddingModel : undefined;
  const embeddingDims = cfg && typeof cfg.embeddingDimensions === 'number' ? cfg.embeddingDimensions : undefined;

  console.log('\n=== Retrieval Trace ===');
  console.log('article:', { id: article.id, title: article.en && article.en.title ? article.en.title : '' });
  console.log('query:', query);
  console.log('config:', {
    embeddingModel: embeddingModel || '(default)',
    embeddingDimensions: embeddingDims || '(default)',
    distanceMetric: distanceMeasure,
    similarityThreshold: cfg && cfg.similarityThreshold != null ? cfg.similarityThreshold : null,
    hybridSearchEnabled: !!(cfg && cfg.hybridSearchEnabled),
    keywordSearchProvider: cfg && cfg.keywordSearchProvider ? cfg.keywordSearchProvider : 'none',
    fusionStrategy: cfg && cfg.fusionStrategy ? cfg.fusionStrategy : 'rrf',
    rrfK: cfg && cfg.rrfK != null ? cfg.rrfK : 60,
    rerankerEnabled: !!(cfg && cfg.rerankerEnabled),
    rerankerProvider: cfg && cfg.rerankerProvider ? cfg.rerankerProvider : 'none',
    rerankerModel: cfg && cfg.rerankerModel ? cfg.rerankerModel : '',
  });

  let chunkCount = await countChunksForArticle(db, article.id).catch(() => 0);
  console.log('\narticle chunks in rag_chunks:', chunkCount);
  if (chunkCount === 0) {
    if (!doIndex) {
      console.log('No chunks indexed for this article yet.');
      console.log('Re-run with --index to index this one article (writes to Firestore + consumes embedding quota).');
      process.exitCode = 2;
      return;
    }

    console.log('Indexing this article into rag_chunks…');
    const out = await indexArticle(article, { chunkDelayMs: 0 });
    console.log('Indexed chunks:', out && out.indexed != null ? out.indexed : '(unknown)');
    chunkCount = await countChunksForArticle(db, article.id).catch(() => 0);
    console.log('article chunks in rag_chunks (after index):', chunkCount);
    if (chunkCount === 0) {
      console.log('Index step completed but no chunks were found. Aborting.');
      process.exitCode = 2;
      return;
    }
  }

  // 1) Vector search
  const qvec = await embedText(query, { model: embeddingModel, outputDimensionality: embeddingDims });
  const vectorLimit = clampInt(argValue('--vectorLimit') || (showAll ? topK : Math.max(topK * 8, 40)), 1, 60) || topK;
  const vector = await vectorSearchWithDistance(db, qvec, vectorLimit, { distanceMeasure, distanceThreshold });
  printList('vector search (semantic)', vector, {
    max: 10,
    filterArticleId: showAll ? null : article.id,
    showDistance: true,
  });

  // 2) Keyword search (BM25)
  let keyword = [];
  const hybridEnabled = !!(cfg && cfg.hybridSearchEnabled);
  const keywordProvider = cfg && typeof cfg.keywordSearchProvider === 'string' ? cfg.keywordSearchProvider : 'none';
  const keywordConfigured = isMeiliConfigured();
  if (hybridEnabled && keywordProvider === 'meilisearch' && keywordConfigured) {
    keyword = await keywordSearch(query, { limit: Math.max(10, Math.min(topK * 6, 60)) });
    printList('keyword search (BM25 via Meilisearch)', keyword, {
      max: 10,
      filterArticleId: showAll ? null : article.id,
    });
  } else if (localBm25) {
    const corpus = showAll
      ? (await db.collection('rag_chunks').limit(500).get()).docs.map((doc) => {
        const d = doc.data() || {};
        return {
          id: doc.id,
          articleId: String(d.articleId || ''),
          articleTitle: String(d.articleTitle || ''),
          chunkIndex: Number(d.chunkIndex || 0),
          blockType: String(d.blockType || 'paragraph'),
          text: String(d.text || ''),
        };
      })
      : await loadChunksForArticle(db, article.id);
    keyword = bm25Rank(query, corpus, { limit: Math.max(10, Math.min(topK * 6, 60)) });
    printList(showAll ? 'keyword search (local BM25 over first 500 chunks)' : 'keyword search (local BM25 over this article)', keyword, {
      max: 10,
      filterArticleId: showAll ? null : article.id,
    });
  } else {
    console.log('\nkeyword search (BM25): skipped', {
      hybridEnabled,
      keywordProvider,
      meilisearchConfigured: keywordConfigured,
      hint: 'Pass --local-bm25 to run BM25 locally for learning (no Meilisearch).',
    });
  }

  // 3) Fusion
  let fused = vector;
  if ((forceHybrid || (hybridEnabled && keywordProvider === 'meilisearch')) && keyword.length) {
    const fusion = cfg && typeof cfg.fusionStrategy === 'string' ? cfg.fusionStrategy : 'rrf';
    if (fusion === 'rrf') {
      fused = rrfFuse(vector, keyword, { k: cfg && cfg.rrfK, limit: topK });
      printList('fusion (RRF)', fused, { max: 10, filterArticleId: showAll ? null : article.id });
    }
  }

  // 4) Rerank
  if (cfg && cfg.rerankerEnabled) {
    const reranked = await rerankIfConfigured(query, fused, {
      provider: cfg && cfg.rerankerProvider,
      model: cfg && cfg.rerankerModel,
      topN: cfg && cfg.rerankerTopN,
      finalK: topK,
    });
    printList('reranked (Cohere if configured)', reranked, { max: 10, filterArticleId: showAll ? null : article.id });
  }

  console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('\nError:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closeInfrastructure().catch((err) => {
    console.error('\nFirestore shutdown failed:', err.message);
    process.exitCode = 1;
  }));

