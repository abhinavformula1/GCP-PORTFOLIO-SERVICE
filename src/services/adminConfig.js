'use strict';

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('./firestore');

// ── Tier configuration ────────────────────────────────────────────────────────
const CONFIG_COLLECTION = 'config';
const TIER_CONFIG_DOC   = 'tierSettings';

const DEFAULT_TIER_CONFIG = {
  free: {
    items: [
      { icon: 'article', label: 'Popular Articles' },
    ],
  },
  premium: {
    items: [
      { icon: 'library_books', label: 'All Articles' },
      { icon: 'support_agent', label: 'Customer Support' },
      { icon: 'build', label: 'Implementation Help' },
    ],
  },
};

async function getTierConfig() {
  const snap = await firestore.getDb().collection(CONFIG_COLLECTION).doc(TIER_CONFIG_DOC).get();
  if (!snap.exists) return DEFAULT_TIER_CONFIG;
  const d = snap.data() || {};
  return {
    free:    { items: Array.isArray(d.free?.items)    ? d.free.items    : DEFAULT_TIER_CONFIG.free.items },
    premium: { items: Array.isArray(d.premium?.items) ? d.premium.items : DEFAULT_TIER_CONFIG.premium.items },
  };
}

async function upsertTierConfig(config) {
  await firestore.getDb().collection(CONFIG_COLLECTION).doc(TIER_CONFIG_DOC).set({
    free:      { items: Array.isArray(config?.free?.items)    ? config.free.items    : [] },
    premium:   { items: Array.isArray(config?.premium?.items) ? config.premium.items : [] },
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── SEO / AEO configuration ───────────────────────────────────────────────────
const SEO_CONFIG_DOC = 'seoConfig';

const DEFAULT_SEO_CONFIG = {
  siteUrl:             'https://portfolio-service-647206478056.asia-southeast1.run.app',
  siteDescription:     'Senior Salesforce Application Engineer with 12+ years across Salesforce, GCP, MuleSoft and API integrations. Deep-dive system design articles on authentication, security, and enterprise architecture.',
  ogImageUrl:          '',
  adsensePublisherId:  '',
  jsonLdEnabled:       true,
  sitemapEnabled:      true,
  robotsNoindex:       false,
  hreflangFrEnabled:   false,
};

async function getSeoConfig() {
  const snap = await firestore.getDb().collection(CONFIG_COLLECTION).doc(SEO_CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SEO_CONFIG };
  const d = snap.data() || {};
  return {
    siteUrl:            String(d.siteUrl           || DEFAULT_SEO_CONFIG.siteUrl),
    siteDescription:    String(d.siteDescription   || DEFAULT_SEO_CONFIG.siteDescription),
    ogImageUrl:         String(d.ogImageUrl         || ''),
    adsensePublisherId: String(d.adsensePublisherId || ''),
    jsonLdEnabled:      d.jsonLdEnabled    !== false,
    sitemapEnabled:     d.sitemapEnabled   !== false,
    robotsNoindex:      !!d.robotsNoindex,
    hreflangFrEnabled:  !!d.hreflangFrEnabled,
  };
}

async function upsertSeoConfig(cfg) {
  await firestore.getDb().collection(CONFIG_COLLECTION).doc(SEO_CONFIG_DOC).set({
    siteUrl:            String(cfg.siteUrl           || DEFAULT_SEO_CONFIG.siteUrl),
    siteDescription:    String(cfg.siteDescription   || DEFAULT_SEO_CONFIG.siteDescription),
    ogImageUrl:         String(cfg.ogImageUrl         || ''),
    adsensePublisherId: String(cfg.adsensePublisherId || ''),
    jsonLdEnabled:      cfg.jsonLdEnabled    !== false,
    sitemapEnabled:     cfg.sitemapEnabled   !== false,
    robotsNoindex:      !!cfg.robotsNoindex,
    hreflangFrEnabled:  !!cfg.hreflangFrEnabled,
    updatedAt:          FieldValue.serverTimestamp(),
  });
}

// ── Atlas configuration ───────────────────────────────────────────────────────
const ATLAS_CONFIG_DOC = 'atlasConfig';

const DEFAULT_ATLAS_CONFIG = {
  enabledModels:        ['flash-lite', 'flash'],
  defaultModel:         'flash-lite',
  budgetCapInr:         100,
  modelSelectorVisible: true,
};

async function getAtlasConfig() {
  const snap = await firestore.getDb().collection(CONFIG_COLLECTION).doc(ATLAS_CONFIG_DOC).get();
  if (!snap.exists) return { ...DEFAULT_ATLAS_CONFIG };
  const d = snap.data() || {};
  return {
    enabledModels:        Array.isArray(d.enabledModels) ? d.enabledModels : DEFAULT_ATLAS_CONFIG.enabledModels,
    defaultModel:         String(d.defaultModel         || DEFAULT_ATLAS_CONFIG.defaultModel),
    budgetCapInr:         typeof d.budgetCapInr === 'number' ? d.budgetCapInr : DEFAULT_ATLAS_CONFIG.budgetCapInr,
    modelSelectorVisible: d.modelSelectorVisible !== false,
  };
}

async function upsertAtlasConfig(cfg) {
  await firestore.getDb().collection(CONFIG_COLLECTION).doc(ATLAS_CONFIG_DOC).set({
    enabledModels:        Array.isArray(cfg.enabledModels) ? cfg.enabledModels : DEFAULT_ATLAS_CONFIG.enabledModels,
    defaultModel:         String(cfg.defaultModel         || DEFAULT_ATLAS_CONFIG.defaultModel),
    budgetCapInr:         typeof cfg.budgetCapInr === 'number' ? cfg.budgetCapInr : DEFAULT_ATLAS_CONFIG.budgetCapInr,
    modelSelectorVisible: cfg.modelSelectorVisible !== false,
    updatedAt:            FieldValue.serverTimestamp(),
  });
}

// ── Component registry toggle map ─────────────────────────────────────────────
const COMPONENT_REGISTRY_DOC = 'componentRegistry';

async function getComponentRegistry() {
  const snap = await firestore.getDb().collection(CONFIG_COLLECTION).doc(COMPONENT_REGISTRY_DOC).get();
  if (!snap.exists) return {};
  return snap.data()?.enabled || {};
}

async function upsertComponentRegistry(enabled) {
  await firestore.getDb().collection(CONFIG_COLLECTION).doc(COMPONENT_REGISTRY_DOC).set({
    enabled:   enabled || {},
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ── Contact policy override (admin-managed) ───────────────────────────────────
const APP_CONFIG_COLLECTION = 'appConfig';
const CONTACT_POLICY_DOC = 'contactPolicy';

async function getContactPolicyConfig() {
  const snap = await firestore.getDb().collection(APP_CONFIG_COLLECTION).doc(CONTACT_POLICY_DOC).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    privatePhone: Object.prototype.hasOwnProperty.call(data, 'privatePhone')
      ? String(data.privatePhone || '').trim()
      : undefined,
    allowedDomains: Object.prototype.hasOwnProperty.call(data, 'allowedDomains') && Array.isArray(data.allowedDomains)
      ? data.allowedDomains.map(String)
      : undefined,
    personalDomains: Object.prototype.hasOwnProperty.call(data, 'personalDomains') && Array.isArray(data.personalDomains)
      ? data.personalDomains.map(String)
      : undefined,
    allowedEmails: Object.prototype.hasOwnProperty.call(data, 'allowedEmails') && Array.isArray(data.allowedEmails)
      ? data.allowedEmails.map(String)
      : undefined,
    blockedDomains: Object.prototype.hasOwnProperty.call(data, 'blockedDomains') && Array.isArray(data.blockedDomains)
      ? data.blockedDomains.map(String)
      : undefined,
    updatedBy:      data.updatedBy || null,
    updatedAt:      data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null,
  };
}

function cleanStringList(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
}

function cleanPhone(value) {
  const raw = String(value || '').trim();
  return raw;
}

async function upsertContactPolicyConfig({ privatePhone, allowedDomains, personalDomains, allowedEmails, blockedDomains, updatedBy }) {
  await firestore.getDb().collection(APP_CONFIG_COLLECTION).doc(CONTACT_POLICY_DOC).set({
    privatePhone:   cleanPhone(privatePhone),
    allowedDomains:  cleanStringList(allowedDomains),
    personalDomains: cleanStringList(personalDomains),
    allowedEmails:   cleanStringList(allowedEmails),
    blockedDomains:  cleanStringList(blockedDomains),
    updatedBy:      updatedBy || null,
    updatedAt:      FieldValue.serverTimestamp(),
  }, { merge: true });
  return getContactPolicyConfig();
}

module.exports = {
  getTierConfig,
  upsertTierConfig,
  getSeoConfig,
  upsertSeoConfig,
  getAtlasConfig,
  upsertAtlasConfig,
  getComponentRegistry,
  upsertComponentRegistry,
  getContactPolicyConfig,
  upsertContactPolicyConfig,
};

