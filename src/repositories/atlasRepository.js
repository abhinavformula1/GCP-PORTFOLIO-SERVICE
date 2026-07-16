'use strict';

/**
 * Atlas repository.
 *
 * Domain-facing data access for Atlas chat persistence and cache lookups.
 * Storage currently uses Firestore behind the scenes.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const USERS_COLLECTION = 'users';
const ACTIVE_DOC_ID = 'active';
const ATLAS_COLLECTION = 'atlas';
const ATLAS_USAGE_COLLECTION = 'atlasUsage';
const ATLAS_CACHE_COLLECTION = 'atlasCache';
const MAX_ATLAS_TURNS = 40;
const ATLAS_MONTHLY_BUDGET_INR = 100;

function atlasActiveDocRef(uid) {
  return firestore.getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(ATLAS_COLLECTION).doc(ACTIVE_DOC_ID);
}

function summariseAtlasUsage(turns) {
  return (Array.isArray(turns) ? turns : []).reduce((acc, turn) => {
    const usage = turn && turn.usage;
    if (!usage) return acc;
    acc.inputTokens += Number(usage.inputTokens || 0);
    acc.outputTokens += Number(usage.outputTokens || 0);
    acc.totalTokens += Number(usage.totalTokens || 0);
    acc.estimatedInr += Number(usage.estimatedInr || 0);
    acc.estimatedUsd += Number(usage.estimatedUsd || 0);
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedInr: 0,
    estimatedUsd: 0,
  });
}

async function getActiveConversation(uid) {
  const snap = await atlasActiveDocRef(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const turns = Array.isArray(d.turns) ? d.turns : [];
  return {
    startedAt: d.startedAt && d.startedAt.toMillis ? d.startedAt.toMillis() : null,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
    turns,
    usage: summariseAtlasUsage(turns),
  };
}

async function appendTurn(uid, { role, text, usage }) {
  if (role !== 'user' && role !== 'model') {
    throw new Error('appendTurn: role must be "user" or "model".');
  }
  const ref = atlasActiveDocRef(uid);
  return firestore.getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    let turns = [];
    if (snap.exists) {
      const d = snap.data() || {};
      turns = Array.isArray(d.turns) ? d.turns.slice() : [];
    }

    const turn = {
      role,
      text: String(text || '').slice(0, 4000),
      ts: Date.now(),
    };
    if (usage && typeof usage === 'object') {
      turn.usage = {
        model: String(usage.model || ''),
        modelLabel: String(usage.modelLabel || ''),
        inputTokens: Number(usage.inputTokens || 0),
        outputTokens: Number(usage.outputTokens || 0),
        totalTokens: Number(usage.totalTokens || 0),
        estimatedUsd: Number(usage.estimatedUsd || 0),
        estimatedInr: Number(usage.estimatedInr || 0),
      };
    }
    turns.push(turn);
    if (turns.length > MAX_ATLAS_TURNS) {
      turns = turns.slice(turns.length - MAX_ATLAS_TURNS);
    }

    const update = { turns, updatedAt: now };
    if (!snap.exists) update.startedAt = now;

    if (snap.exists) tx.update(ref, update);
    else tx.set(ref, update);
  });
}

async function clearActiveConversation(uid) {
  await atlasActiveDocRef(uid).delete();
}

async function appendUsageEvent(uid, usage) {
  if (!usage || typeof usage !== 'object') return;
  await firestore.getDb().collection(ATLAS_USAGE_COLLECTION).add({
    uid,
    model: String(usage.model || ''),
    modelLabel: String(usage.modelLabel || ''),
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.totalTokens || 0),
    estimatedUsd: Number(usage.estimatedUsd || 0),
    estimatedInr: Number(usage.estimatedInr || 0),
    usedAt: FieldValue.serverTimestamp(),
    usedAtMs: Date.now(),
  });
}

async function getMonthlyUsageSummary(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const snap = await firestore.getDb()
    .collection(ATLAS_USAGE_COLLECTION)
    .where('usedAtMs', '>=', start)
    .get();

  const summary = summariseAtlasUsage(
    snap.docs.map((doc) => ({ usage: doc.data() || {} }))
  );
  summary.remainingBudgetInr = Math.max(0, ATLAS_MONTHLY_BUDGET_INR - summary.estimatedInr);
  summary.budgetUsedPercent = ATLAS_MONTHLY_BUDGET_INR
    ? Math.min(100, (summary.estimatedInr / ATLAS_MONTHLY_BUDGET_INR) * 100)
    : 0;
  return summary;
}

async function getUsageSummary(uid) {
  const conv = await getActiveConversation(uid);
  const month = await getMonthlyUsageSummary();
  return {
    activeConversation: conv ? conv.usage : summariseAtlasUsage([]),
    month,
    monthlyBudgetInr: ATLAS_MONTHLY_BUDGET_INR,
  };
}

async function getCacheEntry(cacheKey) {
  const snap = await firestore.getDb().collection(ATLAS_CACHE_COLLECTION).doc(cacheKey).get();
  if (!snap.exists) return null;

  const data = snap.data() || {};
  if (Number(data.expiresAtMs || 0) <= Date.now()) return null;

  await snap.ref.update({
    hitCount: FieldValue.increment(1),
    lastHitAt: FieldValue.serverTimestamp(),
  });

  return {
    answer: String(data.answer || ''),
    model: String(data.model || ''),
  };
}

async function saveCacheEntry(cacheKey, entry) {
  await firestore.getDb().collection(ATLAS_CACHE_COLLECTION).doc(cacheKey).set({
    normalizedQuestion: String(entry.normalizedQuestion || '').slice(0, 500),
    model: String(entry.model || ''),
    personaVersion: String(entry.personaVersion || ''),
    answer: String(entry.answer || '').slice(0, 4000),
    createdAt: FieldValue.serverTimestamp(),
    expiresAtMs: Number(entry.expiresAtMs || 0),
    hitCount: 0,
  });
}

module.exports = {
  getActiveConversation,
  appendTurn,
  clearActiveConversation,
  appendUsageEvent,
  getUsageSummary,
  getCacheEntry,
  saveCacheEntry,
};
