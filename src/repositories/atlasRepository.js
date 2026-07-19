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
const localActiveConversations = new Map();
const localUsageEvents = [];
const localCacheEntries = new Map();
const warnedFallbackScopes = new Set();

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

function isFirestoreUnavailable(err) {
  const message = String(err && err.message ? err.message : '').toLowerCase();
  return message.includes('unable to detect a project id')
    || message.includes('could not load the default credentials')
    || message.includes('could not load the credentials')
    || message.includes('client is not initialized')
    || message.includes('firestore has already been closed');
}

function warnLocalFallback(scope, err) {
  const key = String(scope || 'atlas');
  if (warnedFallbackScopes.has(key)) return;
  warnedFallbackScopes.add(key);
  console.warn('[atlasRepository] using in-memory fallback for ' + key + ':', err.message);
}

function cloneTurns(turns) {
  return (Array.isArray(turns) ? turns : []).map(function (turn) {
    const out = {
      role: turn && turn.role ? String(turn.role) : 'user',
      text: turn && turn.text ? String(turn.text) : '',
      ts: Number(turn && turn.ts ? turn.ts : Date.now()),
    };
    if (turn && turn.usage && typeof turn.usage === 'object') {
      out.usage = {
        model: String(turn.usage.model || ''),
        modelLabel: String(turn.usage.modelLabel || ''),
        inputTokens: Number(turn.usage.inputTokens || 0),
        outputTokens: Number(turn.usage.outputTokens || 0),
        totalTokens: Number(turn.usage.totalTokens || 0),
        estimatedUsd: Number(turn.usage.estimatedUsd || 0),
        estimatedInr: Number(turn.usage.estimatedInr || 0),
        cached: turn.usage.cached === true,
      };
    }
    return out;
  });
}

function getLocalConversation(uid) {
  const entry = localActiveConversations.get(String(uid || ''));
  if (!entry) return null;
  return {
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    turns: cloneTurns(entry.turns),
    usage: summariseAtlasUsage(entry.turns),
  };
}

function appendLocalTurn(uid, { role, text, usage }) {
  const key = String(uid || '');
  const existing = localActiveConversations.get(key) || {
    startedAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };
  const turns = cloneTurns(existing.turns);
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
      cached: usage.cached === true,
    };
  }
  turns.push(turn);
  const trimmedTurns = turns.length > MAX_ATLAS_TURNS
    ? turns.slice(turns.length - MAX_ATLAS_TURNS)
    : turns;
  localActiveConversations.set(key, {
    startedAt: existing.startedAt,
    updatedAt: Date.now(),
    turns: trimmedTurns,
  });
}

function appendLocalUsageEvent(uid, usage) {
  if (!usage || typeof usage !== 'object') return;
  localUsageEvents.push({
    uid: String(uid || ''),
    model: String(usage.model || ''),
    modelLabel: String(usage.modelLabel || ''),
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.totalTokens || 0),
    estimatedUsd: Number(usage.estimatedUsd || 0),
    estimatedInr: Number(usage.estimatedInr || 0),
    usedAtMs: Date.now(),
  });
}

function getLocalMonthlyUsageSummary(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const summary = summariseAtlasUsage(
    localUsageEvents
      .filter(function (event) { return Number(event.usedAtMs || 0) >= start; })
      .map(function (event) { return { usage: event || {} }; })
  );
  summary.remainingBudgetInr = Math.max(0, ATLAS_MONTHLY_BUDGET_INR - summary.estimatedInr);
  summary.budgetUsedPercent = ATLAS_MONTHLY_BUDGET_INR
    ? Math.min(100, (summary.estimatedInr / ATLAS_MONTHLY_BUDGET_INR) * 100)
    : 0;
  return summary;
}

async function getActiveConversation(uid) {
  try {
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
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('conversation-read', err);
    return getLocalConversation(uid);
  }
}

async function appendTurn(uid, { role, text, usage }) {
  if (role !== 'user' && role !== 'model') {
    throw new Error('appendTurn: role must be "user" or "model".');
  }
  const ref = atlasActiveDocRef(uid);
  try {
    return await firestore.getDb().runTransaction(async (tx) => {
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
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('conversation-write', err);
    appendLocalTurn(uid, { role, text, usage });
    return undefined;
  }
}

async function clearActiveConversation(uid) {
  try {
    await atlasActiveDocRef(uid).delete();
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('conversation-clear', err);
    localActiveConversations.delete(String(uid || ''));
  }
}

async function appendUsageEvent(uid, usage) {
  if (!usage || typeof usage !== 'object') return;
  try {
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
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('usage-write', err);
    appendLocalUsageEvent(uid, usage);
  }
}

async function getMonthlyUsageSummary(now = new Date()) {
  try {
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
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('usage-read', err);
    return getLocalMonthlyUsageSummary(now);
  }
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
  try {
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
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('cache-read', err);
    const data = localCacheEntries.get(String(cacheKey || ''));
    if (!data) return null;
    if (Number(data.expiresAtMs || 0) <= Date.now()) {
      localCacheEntries.delete(String(cacheKey || ''));
      return null;
    }
    data.hitCount = Number(data.hitCount || 0) + 1;
    data.lastHitAtMs = Date.now();
    return {
      answer: String(data.answer || ''),
      model: String(data.model || ''),
    };
  }
}

async function saveCacheEntry(cacheKey, entry) {
  try {
    await firestore.getDb().collection(ATLAS_CACHE_COLLECTION).doc(cacheKey).set({
      normalizedQuestion: String(entry.normalizedQuestion || '').slice(0, 500),
      model: String(entry.model || ''),
      personaVersion: String(entry.personaVersion || ''),
      answer: String(entry.answer || '').slice(0, 4000),
      createdAt: FieldValue.serverTimestamp(),
      expiresAtMs: Number(entry.expiresAtMs || 0),
      hitCount: 0,
    });
  } catch (err) {
    if (!isFirestoreUnavailable(err)) throw err;
    warnLocalFallback('cache-write', err);
    localCacheEntries.set(String(cacheKey || ''), {
      normalizedQuestion: String(entry.normalizedQuestion || '').slice(0, 500),
      model: String(entry.model || ''),
      personaVersion: String(entry.personaVersion || ''),
      answer: String(entry.answer || '').slice(0, 4000),
      createdAtMs: Date.now(),
      expiresAtMs: Number(entry.expiresAtMs || 0),
      hitCount: 0,
      lastHitAtMs: null,
    });
  }
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
