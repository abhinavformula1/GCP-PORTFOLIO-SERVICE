'use strict';

/**
 * RAG admin repository.
 *
 * Firestore-backed persistence for admin-managed golden datasets and
 * retrieval evaluation history.
 */

const firestore = require('../services/firestore');

const GOLDEN_DATASET_COLLECTION = 'goldenDataset';
const GOLDEN_DATASET_DOC_ID = 'current';
const RAG_EVAL_RUNS_COLLECTION = 'ragEvalRuns';

async function getGoldenDatasetRows() {
  const doc = await firestore.getDb()
    .collection(GOLDEN_DATASET_COLLECTION)
    .doc(GOLDEN_DATASET_DOC_ID)
    .get();

  if (!doc.exists) return null;
  const rows = doc.data()?.rows;
  return Array.isArray(rows) && rows.length ? rows : null;
}

async function resetGoldenDataset() {
  await firestore.getDb()
    .collection(GOLDEN_DATASET_COLLECTION)
    .doc(GOLDEN_DATASET_DOC_ID)
    .delete();
}

async function saveGoldenDatasetRows(rows) {
  await firestore.getDb()
    .collection(GOLDEN_DATASET_COLLECTION)
    .doc(GOLDEN_DATASET_DOC_ID)
    .set({
      rows,
      updatedAt: new Date(),
    });
}

async function saveRagEvalRun({ k, mode, metrics, details }) {
  const hits = Array.isArray(details) ? details.filter((d) => d && d.hit).length : 0;
  const total = Array.isArray(details) ? details.length : 0;

  await firestore.getDb().collection(RAG_EVAL_RUNS_COLLECTION).add({
    ranAt: new Date(),
    k,
    mode,
    metrics,
    hits,
    misses: total - hits,
    total,
    passRate: total > 0 ? Math.round((hits / total) * 100) : 0,
    passed: Number(metrics?.recallAtK || 0) >= 0.8,
    details,
  });
}

async function listRagEvalRuns(limit) {
  const snap = await firestore.getDb()
    .collection(RAG_EVAL_RUNS_COLLECTION)
    .orderBy('ranAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data() || {};
    return {
      id: doc.id,
      ranAt: d.ranAt?.toDate?.()?.toISOString() || null,
      k: d.k,
      mode: d.mode || 'golden',
      metrics: d.metrics,
      hits: d.hits,
      misses: d.misses,
      total: d.total,
      passRate: d.passRate,
      passed: d.passed,
    };
  });
}

async function deleteRagEvalRun(id) {
  await firestore.getDb().collection(RAG_EVAL_RUNS_COLLECTION).doc(id).delete();
}

module.exports = {
  getGoldenDatasetRows,
  resetGoldenDataset,
  saveGoldenDatasetRows,
  saveRagEvalRun,
  listRagEvalRuns,
  deleteRagEvalRun,
};
