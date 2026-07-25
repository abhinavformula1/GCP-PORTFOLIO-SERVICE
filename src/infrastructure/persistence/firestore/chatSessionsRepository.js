'use strict';

/**
 * Guided chat sessions repository.
 *
 * Domain-facing persistence for the step-based guided chat flow.
 */

const { FieldValue } = require('@google-cloud/firestore');

const USERS_COLLECTION = 'users';
const ACTIVE_DOC_ID = 'active';
const SESSIONS_COLLECTION = 'sessions';
const INQUIRIES_COLLECTION = 'inquiries';
const MAX_MESSAGES = 50;

function createChatSessionsRepository({ firestore }) {
if (!firestore || typeof firestore.getDb !== 'function') {
  throw new TypeError('chatSessionsRepository.firestore.getDb is required');
}

function activeDocRef(uid) {
  return firestore.getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(SESSIONS_COLLECTION).doc(ACTIVE_DOC_ID);
}

async function getActiveChat(uid) {
  const snap = await activeDocRef(uid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return {
    startedAt: d.startedAt && d.startedAt.toMillis ? d.startedAt.toMillis() : null,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null,
    step: typeof d.step === 'number' ? d.step : 0,
    answers: d.answers || {},
    messages: Array.isArray(d.messages) ? d.messages : [],
    locale: d.locale || 'en',
  };
}

async function upsertActiveChat(uid, { step, answers, message, locale }) {
  const ref = activeDocRef(uid);
  return firestore.getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    let messages = [];
    if (snap.exists) {
      const d = snap.data() || {};
      messages = Array.isArray(d.messages) ? d.messages.slice() : [];
    }
    if (message && message.text) {
      messages.push({
        role: message.role === 'user' ? 'user' : 'bot',
        text: String(message.text).slice(0, 2000),
        ts: Date.now(),
      });
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES);
      }
    }

    const update = {
      step: typeof step === 'number' ? step : (snap.exists ? snap.get('step') || 0 : 0),
      answers: answers && typeof answers === 'object' ? answers : (snap.exists ? snap.get('answers') || {} : {}),
      locale: locale || (snap.exists ? snap.get('locale') || 'en' : 'en'),
      messages,
      updatedAt: now,
    };
    if (!snap.exists) update.startedAt = now;

    if (snap.exists) tx.update(ref, update);
    else tx.set(ref, update);
  });
}

async function clearActiveChat(uid) {
  await activeDocRef(uid).delete();
}

async function completeActiveChat(uid, { salesforceId, alreadySubmitted } = {}) {
  const ref = activeDocRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const d = snap.data() || {};
  await firestore.getDb()
    .collection(USERS_COLLECTION).doc(uid)
    .collection(INQUIRIES_COLLECTION)
    .add({
      completedAt: FieldValue.serverTimestamp(),
      startedAt: d.startedAt || null,
      step: d.step || 0,
      answers: d.answers || {},
      messages: d.messages || [],
      salesforceId: salesforceId || null,
      alreadySubmitted: !!alreadySubmitted,
    });

  await ref.delete();
}

return Object.freeze({
  getActiveChat,
  upsertActiveChat,
  clearActiveChat,
  completeActiveChat,
});
}

module.exports = { createChatSessionsRepository };
