'use strict';

/**
 * Firestore client wrapper.
 *
 * This module is intentionally small: it owns only Firestore client creation.
 * Domain-level reads/writes should live in repositories, not here.
 */

const { Firestore } = require('@google-cloud/firestore');

function createFirestoreClient({ config, FirestoreClass = Firestore }) {
  if (!config || !config.firestore) {
    throw new TypeError('firestoreClient.config.firestore is required');
  }
  if (typeof FirestoreClass !== 'function') {
    throw new TypeError('firestoreClient.FirestoreClass must be a constructor');
  }

  let db = null;
  let closePromise = null;
  let closed = false;

  function getDb() {
    if (closed) throw new Error('Firestore client has been closed.');
    if (db) return db;

    const opts = {};
    if (config.firestore.projectId) opts.projectId = config.firestore.projectId;
    if (config.firestore.databaseId && config.firestore.databaseId !== '(default)') {
      opts.databaseId = config.firestore.databaseId;
    }

    db = new FirestoreClass(opts);
    return db;
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = Promise.resolve().then(async () => {
      if (!db) return;
      if (typeof db.terminate === 'function') await db.terminate();
      else if (typeof db.close === 'function') await db.close();
    });
    return closePromise;
  }

  return Object.freeze({ getDb, close });
}

module.exports = { createFirestoreClient };
