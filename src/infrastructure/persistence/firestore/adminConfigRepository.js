'use strict';

/**
 * Admin config repository.
 *
 * Firestore-backed document access for admin-managed configuration.
 */

const { FieldValue } = require('@google-cloud/firestore');
const { toMillis } = require('./values');

const CONFIG_COLLECTION = 'config';
const APP_CONFIG_COLLECTION = 'appConfig';
const TIER_CONFIG_DOC = 'tierSettings';
const SEO_CONFIG_DOC = 'seoConfig';
const ATLAS_CONFIG_DOC = 'atlasConfig';
const COMPONENT_REGISTRY_DOC = 'componentRegistry';
const CONTACT_POLICY_DOC = 'contactPolicy';

function createAdminConfigRepository({ firestore }) {
if (!firestore || typeof firestore.getDb !== 'function') {
  throw new TypeError('adminConfigRepository.firestore.getDb is required');
}

async function getConfigDoc(docId) {
  const snap = await firestore.getDb().collection(CONFIG_COLLECTION).doc(docId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return Object.assign({}, data, {
    updatedAt: data.updatedAt == null ? null : toMillis(data.updatedAt),
  });
}

async function setConfigDoc(docId, data, opts) {
  await firestore.getDb().collection(CONFIG_COLLECTION).doc(docId).set(data, opts);
}

async function getAppConfigDoc(docId) {
  const snap = await firestore.getDb().collection(APP_CONFIG_COLLECTION).doc(docId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return Object.assign({}, data, {
    updatedAt: data.updatedAt == null ? null : toMillis(data.updatedAt),
  });
}

async function setAppConfigDoc(docId, data, opts) {
  await firestore.getDb().collection(APP_CONFIG_COLLECTION).doc(docId).set(data, opts);
}

async function getTierConfigDoc() {
  return getConfigDoc(TIER_CONFIG_DOC);
}

async function saveTierConfigDoc(data) {
  return setConfigDoc(TIER_CONFIG_DOC, Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }));
}

async function getSeoConfigDoc() {
  return getConfigDoc(SEO_CONFIG_DOC);
}

async function saveSeoConfigDoc(data) {
  return setConfigDoc(SEO_CONFIG_DOC, Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }));
}

async function getAtlasConfigDoc() {
  return getConfigDoc(ATLAS_CONFIG_DOC);
}

async function saveAtlasConfigDoc(data, opts) {
  return setConfigDoc(ATLAS_CONFIG_DOC, Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }), opts);
}

async function getComponentRegistryDoc() {
  return getConfigDoc(COMPONENT_REGISTRY_DOC);
}

async function saveComponentRegistryDoc(data) {
  return setConfigDoc(COMPONENT_REGISTRY_DOC, Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }));
}

async function getContactPolicyDoc() {
  return getAppConfigDoc(CONTACT_POLICY_DOC);
}

async function saveContactPolicyDoc(data, opts) {
  return setAppConfigDoc(CONTACT_POLICY_DOC, Object.assign({}, data, {
    updatedAt: FieldValue.serverTimestamp(),
  }), opts);
}

return Object.freeze({
  getTierConfigDoc,
  saveTierConfigDoc,
  getSeoConfigDoc,
  saveSeoConfigDoc,
  getAtlasConfigDoc,
  saveAtlasConfigDoc,
  getComponentRegistryDoc,
  saveComponentRegistryDoc,
  getContactPolicyDoc,
  saveContactPolicyDoc,
});
}

module.exports = { createAdminConfigRepository };
