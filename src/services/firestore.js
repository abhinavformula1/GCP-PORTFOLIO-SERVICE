'use strict';

/**
 * Firestore client wrapper.
 *
 * Mental model (for Salesforce folks): a Firestore *collection* is like a
 * Custom Object, and a *document* is like a record. Documents are JSON-shaped
 * — fields can be primitives, maps, arrays, or timestamps — and the schema
 * is enforced by the application, not the database.
 *
 * Authentication on Cloud Run is automatic via the runtime service account.
 * Locally, run `gcloud auth application-default login` once.
 */

const { Firestore, FieldValue } = require('@google-cloud/firestore');
const config = require('../config');

// ── Lazy singleton — initialised on first use, not at import time ─────────────
// This means the app still boots cleanly if Firestore isn't configured yet.
let _db = null;
function getDb() {
  if (_db) return _db;

  const opts = {};
  if (config.firestore.projectId)  opts.projectId  = config.firestore.projectId;
  if (config.firestore.databaseId && config.firestore.databaseId !== '(default)') {
    opts.databaseId = config.firestore.databaseId;
  }

  _db = new Firestore(opts);
  return _db;
}

// ── User operations ───────────────────────────────────────────────────────────
const USERS_COLLECTION = 'users';

/**
 * Reads /users/{uid}. Returns null if the document doesn't exist.
 */
async function getUser(uid) {
  const snap = await getDb().collection(USERS_COLLECTION).doc(uid).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Creates /users/{uid} on first sight, or updates lastSeenAt and increments
 * visitCount on subsequent sights.
 *
 * Returns:
 *   {
 *     isReturning,   // false on first ever visit, true otherwise
 *     visitCount,    // post-increment count
 *     firstSeenAt,   // Firestore Timestamp | null
 *     lastSeenAt,    // Firestore Timestamp | null  (pre-update value)
 *   }
 */
async function upsertUserVisit({ uid, email, name, picture }) {
  const ref = getDb().collection(USERS_COLLECTION).doc(uid);

  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now  = FieldValue.serverTimestamp();

    if (snap.exists) {
      const existing = snap.data();
      tx.update(ref, {
        email,
        name,
        picture:    picture || null,
        lastSeenAt: now,
        visitCount: FieldValue.increment(1),
      });
      return {
        isReturning: true,
        visitCount:  (existing.visitCount || 0) + 1,
        firstSeenAt: existing.firstSeenAt || null,
        lastSeenAt:  existing.lastSeenAt  || null,
      };
    }

    tx.set(ref, {
      email,
      name,
      picture:     picture || null,
      firstSeenAt: now,
      lastSeenAt:  now,
      visitCount:  1,
    });
    return {
      isReturning: false,
      visitCount:  1,
      firstSeenAt: null,
      lastSeenAt:  null,
    };
  });
}

module.exports = {
  getDb,
  getUser,
  upsertUserVisit,
};
