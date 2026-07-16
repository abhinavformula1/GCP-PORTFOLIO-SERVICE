'use strict';

/**
 * Firestore client wrapper.
 *
 * This module is intentionally small: it owns only Firestore client creation.
 * Domain-level reads/writes should live in repositories, not here.
 */

const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');

// Lazy singleton — initialised on first use, not at import time.
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

module.exports = {
  getDb,
};
