'use strict';

const adminConfigRepository = require('../repositories/adminConfigRepository');
const appConfig = require('../config');
const { setLangSmithRuntimeEnabled } = require('./observability/langsmith');

// Local preview override: when Firestore is unavailable, allow admin UX work by
// persisting Atlas config changes in-memory for the current process.
let _localAtlasConfigOverride = {};

// ── Tier configuration ────────────────────────────────────────────────────────
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
  const d = await adminConfigRepository.getTierConfigDoc();
  if (!d) return DEFAULT_TIER_CONFIG;
  return {
    free:    { items: Array.isArray(d.free?.items)    ? d.free.items    : DEFAULT_TIER_CONFIG.free.items },
    premium: { items: Array.isArray(d.premium?.items) ? d.premium.items : DEFAULT_TIER_CONFIG.premium.items },
  };
}

async function upsertTierConfig(config) {
  await adminConfigRepository.saveTierConfigDoc({
    free:      { items: Array.isArray(config?.free?.items)    ? config.free.items    : [] },
    premium:   { items: Array.isArray(config?.premium?.items) ? config.premium.items : [] },
  });
}

// ── SEO / AEO configuration ───────────────────────────────────────────────────
const DEFAULT_SEO_CONFIG = {
  siteUrl:             'https://portfolio-service-647206478056.asia-southeast1.run.app',
  siteDescription:     'Senior Salesforce Application Engineer with 13+ years across Salesforce, GCP, MuleSoft and API integrations. Deep-dive system design articles on authentication, security, and enterprise architecture.',
  ogImageUrl:          '',
  adsensePublisherId:  '',
  jsonLdEnabled:       true,
  sitemapEnabled:      true,
  robotsNoindex:       false,
  hreflangFrEnabled:   false,
};

async function getSeoConfig() {
  const d = await adminConfigRepository.getSeoConfigDoc();
  if (!d) return { ...DEFAULT_SEO_CONFIG };
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
  await adminConfigRepository.saveSeoConfigDoc({
    siteUrl:            String(cfg.siteUrl           || DEFAULT_SEO_CONFIG.siteUrl),
    siteDescription:    String(cfg.siteDescription   || DEFAULT_SEO_CONFIG.siteDescription),
    ogImageUrl:         String(cfg.ogImageUrl         || ''),
    adsensePublisherId: String(cfg.adsensePublisherId || ''),
    jsonLdEnabled:      cfg.jsonLdEnabled    !== false,
    sitemapEnabled:     cfg.sitemapEnabled   !== false,
    robotsNoindex:      !!cfg.robotsNoindex,
    hreflangFrEnabled:  !!cfg.hreflangFrEnabled,
  });
}

// ── Atlas configuration ───────────────────────────────────────────────────────
const DEFAULT_ATLAS_MODEL_OPTIONS = {
  'flash-lite': {
    label: 'Fast & economical',
    detail: 'Default',
  },
  flash: {
    label: 'More detailed',
    detail: 'Higher cost',
  },
};

function sanitiseAtlasModelOptions(source, fallback) {
  const base = fallback && typeof fallback === 'object'
    ? fallback
    : DEFAULT_ATLAS_MODEL_OPTIONS;
  const input = source && typeof source === 'object' ? source : {};
  return Object.keys(DEFAULT_ATLAS_MODEL_OPTIONS).reduce((acc, key) => {
    const raw = input[key] && typeof input[key] === 'object' ? input[key] : {};
    const fromBase = base[key] && typeof base[key] === 'object' ? base[key] : DEFAULT_ATLAS_MODEL_OPTIONS[key];
    acc[key] = {
      label: _str(raw.label, fromBase.label),
      detail: _str(raw.detail, fromBase.detail),
    };
    return acc;
  }, {});
}

const DEFAULT_ATLAS_CONFIG = {
  // ── 1. LLM Configuration ────────────────────────────────────────────────
  enabledModels:            ['flash-lite', 'flash'],
  defaultModel:             'flash-lite',
  fallbackModel:            '',
  modelOptions:             sanitiseAtlasModelOptions(),
  temperature:              0.35,
  topP:                     0.85,
  maxOutputTokens:          900,
  streamingEnabled:         true,

  // ── 2. Embedding Configuration ──────────────────────────────────────────
  embeddingModel:           'text-embedding-004',
  embeddingDimensions:      768,
  distanceMetric:           'COSINE',
  embeddingBatchSize:       5,

  // ── 3. Chunking Strategy ─────────────────────────────────────────────────
  chunkSize:                4000,
  chunkOverlap:             200,
  splitterType:             'recursive',       // recursive | markdown

  // ── 4. Retrieval Configuration ───────────────────────────────────────────
  ragEnabled:               false,
  ragTopK:                  5,
  hybridSearchEnabled:      false,
  rerankerEnabled:          false,
  similarityThreshold:      0.0,

  // ── 5. Prompt Configuration ──────────────────────────────────────────────
  systemPrompt:             '',
  guardrailsEnabled:        false,
  conversationMemoryTurns:  5,

  // ── 6. Model Routing ─────────────────────────────────────────────────────
  executionMode:            'single-agent',   // pure-model | single-agent | multiagent
  routingStrategy:          'default',         // default | rule-based | classifier
  routingFallbackModel:     'flash-lite',
  webSearchEnabled:         true,
  webSearchMode:            'web-intent',      // disabled | web-intent | always
  webSearchMaxResults:      5,
  webSearchTopic:           'general',         // general | news

  // ── 7. Evaluation Configuration ──────────────────────────────────────────
  recallThreshold:          0.80,
  faithfulnessThreshold:    0.70,

  // ── 8. Observability Configuration ───────────────────────────────────────
  tracingEnabled:           false,
  capturePrompts:           false,
  captureChunks:            false,
  captureTokens:            true,
  langsmithTracingEnabled:  false,

  // ── 9. Cost Controls ─────────────────────────────────────────────────────
  budgetCapInr:             100,
  dailyBudgetCapInr:        0,
  tokenLimitPerQuery:       1000,
  budgetAlertThreshold:     0.8,

  // ── 10. Security ─────────────────────────────────────────────────────────
  piiRedactionEnabled:      false,
  promptInjectionDetection: false,
  rateLimitPerMinute:       20,
  contentModerationEnabled: false,

  // ── UI ───────────────────────────────────────────────────────────────────
  modelSelectorVisible:     true,
};

function _num(val, def)  { return typeof val === 'number' ? val : def; }
function _bool(val, def) { return typeof val === 'boolean' ? val : def; }
function _str(val, def)  { return typeof val === 'string' && val ? val : def; }

async function getAtlasConfig() {
  try {
    const d = await adminConfigRepository.getAtlasConfigDoc();
    if (!d) {
      const fallback = Object.assign({}, DEFAULT_ATLAS_CONFIG, _localAtlasConfigOverride || {});
      setLangSmithRuntimeEnabled(fallback.langsmithTracingEnabled === true);
      return fallback;
    }
    const D = DEFAULT_ATLAS_CONFIG;
    const cfg = {
      // LLM
      enabledModels:            Array.isArray(d.enabledModels) ? d.enabledModels : D.enabledModels,
      defaultModel:             _str(d.defaultModel,             D.defaultModel),
      fallbackModel:            typeof d.fallbackModel === 'string' ? d.fallbackModel : D.fallbackModel,
      modelOptions:             sanitiseAtlasModelOptions(d.modelOptions, D.modelOptions),
      temperature:              _num(d.temperature,              D.temperature),
      topP:                     _num(d.topP,                     D.topP),
      maxOutputTokens:          _num(d.maxOutputTokens,          D.maxOutputTokens),
      streamingEnabled:         _bool(d.streamingEnabled,        D.streamingEnabled),
      // Embedding
      embeddingModel:           _str(d.embeddingModel,           D.embeddingModel),
      embeddingDimensions:      _num(d.embeddingDimensions,      D.embeddingDimensions),
      distanceMetric:           _str(d.distanceMetric,           D.distanceMetric),
      embeddingBatchSize:       _num(d.embeddingBatchSize,       D.embeddingBatchSize),
      // Chunking
      chunkSize:                _num(d.chunkSize,                D.chunkSize),
      chunkOverlap:             _num(d.chunkOverlap,             D.chunkOverlap),
      splitterType:             _str(d.splitterType,             D.splitterType),
      // Retrieval
      ragEnabled:               d.ragEnabled === true,
      ragTopK:                  _num(d.ragTopK,                  D.ragTopK),
      hybridSearchEnabled:      _bool(d.hybridSearchEnabled,     D.hybridSearchEnabled),
      rerankerEnabled:          _bool(d.rerankerEnabled,         D.rerankerEnabled),
      similarityThreshold:      _num(d.similarityThreshold,      D.similarityThreshold),
      // Prompt
      systemPrompt:             typeof d.systemPrompt === 'string' ? d.systemPrompt : D.systemPrompt,
      guardrailsEnabled:        _bool(d.guardrailsEnabled,       D.guardrailsEnabled),
      conversationMemoryTurns:  _num(d.conversationMemoryTurns,  D.conversationMemoryTurns),
      // Routing
      executionMode:            _str(d.executionMode,            D.executionMode),
      routingStrategy:          _str(d.routingStrategy,          D.routingStrategy),
      routingFallbackModel:     _str(d.routingFallbackModel,     D.routingFallbackModel),
      webSearchEnabled:         _bool(d.webSearchEnabled,        D.webSearchEnabled),
      webSearchMode:            _str(d.webSearchMode,            D.webSearchMode),
      webSearchMaxResults:      _num(d.webSearchMaxResults,      D.webSearchMaxResults),
      webSearchTopic:           _str(d.webSearchTopic,           D.webSearchTopic),
      // Evaluation
      recallThreshold:          _num(d.recallThreshold,          D.recallThreshold),
      faithfulnessThreshold:    _num(d.faithfulnessThreshold,    D.faithfulnessThreshold),
      // Observability
      tracingEnabled:           _bool(d.tracingEnabled,          D.tracingEnabled),
      capturePrompts:           _bool(d.capturePrompts,          D.capturePrompts),
      captureChunks:            _bool(d.captureChunks,           D.captureChunks),
      captureTokens:            _bool(d.captureTokens,           D.captureTokens),
      langsmithTracingEnabled:  _bool(d.langsmithTracingEnabled, D.langsmithTracingEnabled),
      // Cost
      budgetCapInr:             _num(d.budgetCapInr,             D.budgetCapInr),
      dailyBudgetCapInr:        _num(d.dailyBudgetCapInr,        D.dailyBudgetCapInr),
      tokenLimitPerQuery:       _num(d.tokenLimitPerQuery,       D.tokenLimitPerQuery),
      budgetAlertThreshold:     _num(d.budgetAlertThreshold,     D.budgetAlertThreshold),
      // Security
      piiRedactionEnabled:      _bool(d.piiRedactionEnabled,     D.piiRedactionEnabled),
      promptInjectionDetection: _bool(d.promptInjectionDetection, D.promptInjectionDetection),
      rateLimitPerMinute:       _num(d.rateLimitPerMinute,       D.rateLimitPerMinute),
      contentModerationEnabled: _bool(d.contentModerationEnabled, D.contentModerationEnabled),
      // UI
      modelSelectorVisible:     d.modelSelectorVisible !== false,
    };
    setLangSmithRuntimeEnabled(cfg.langsmithTracingEnabled === true);
    return cfg;
  } catch (err) {
    console.warn('[atlas-config] Firestore read failed, using defaults:', err.message);
    const fallback = Object.assign({}, DEFAULT_ATLAS_CONFIG, _localAtlasConfigOverride || {});
    setLangSmithRuntimeEnabled(fallback.langsmithTracingEnabled === true);
    return fallback;
  }
}

async function upsertAtlasConfig(cfg) {
  const D = DEFAULT_ATLAS_CONFIG;
  const payload = {
    // LLM
    enabledModels:            Array.isArray(cfg.enabledModels) ? cfg.enabledModels : D.enabledModels,
    defaultModel:             _str(cfg.defaultModel,             D.defaultModel),
    fallbackModel:            typeof cfg.fallbackModel === 'string' ? cfg.fallbackModel : D.fallbackModel,
    modelOptions:             sanitiseAtlasModelOptions(cfg.modelOptions, D.modelOptions),
    temperature:              _num(cfg.temperature,              D.temperature),
    topP:                     _num(cfg.topP,                     D.topP),
    maxOutputTokens:          _num(cfg.maxOutputTokens,          D.maxOutputTokens),
    streamingEnabled:         _bool(cfg.streamingEnabled,        D.streamingEnabled),
    // Embedding
    embeddingModel:           _str(cfg.embeddingModel,           D.embeddingModel),
    embeddingDimensions:      _num(cfg.embeddingDimensions,      D.embeddingDimensions),
    distanceMetric:           _str(cfg.distanceMetric,           D.distanceMetric),
    embeddingBatchSize:       _num(cfg.embeddingBatchSize,       D.embeddingBatchSize),
    // Chunking
    chunkSize:                _num(cfg.chunkSize,                D.chunkSize),
    chunkOverlap:             _num(cfg.chunkOverlap,             D.chunkOverlap),
    splitterType:             _str(cfg.splitterType,             D.splitterType),
    // Retrieval
    ragEnabled:               cfg.ragEnabled === true,
    ragTopK:                  _num(cfg.ragTopK,                  D.ragTopK),
    hybridSearchEnabled:      _bool(cfg.hybridSearchEnabled,     D.hybridSearchEnabled),
    rerankerEnabled:          _bool(cfg.rerankerEnabled,         D.rerankerEnabled),
    similarityThreshold:      _num(cfg.similarityThreshold,      D.similarityThreshold),
    // Prompt
    systemPrompt:             typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : D.systemPrompt,
    guardrailsEnabled:        _bool(cfg.guardrailsEnabled,       D.guardrailsEnabled),
    conversationMemoryTurns:  _num(cfg.conversationMemoryTurns,  D.conversationMemoryTurns),
    // Routing
    executionMode:           _str(cfg.executionMode,          D.executionMode),
    routingStrategy:          _str(cfg.routingStrategy,          D.routingStrategy),
    routingFallbackModel:     _str(cfg.routingFallbackModel,     D.routingFallbackModel),
    webSearchEnabled:         _bool(cfg.webSearchEnabled,        D.webSearchEnabled),
    webSearchMode:            _str(cfg.webSearchMode,            D.webSearchMode),
    webSearchMaxResults:      _num(cfg.webSearchMaxResults,      D.webSearchMaxResults),
    webSearchTopic:           _str(cfg.webSearchTopic,           D.webSearchTopic),
    // Evaluation
    recallThreshold:          _num(cfg.recallThreshold,          D.recallThreshold),
    faithfulnessThreshold:    _num(cfg.faithfulnessThreshold,    D.faithfulnessThreshold),
    // Observability
    tracingEnabled:           _bool(cfg.tracingEnabled,          D.tracingEnabled),
    capturePrompts:           _bool(cfg.capturePrompts,          D.capturePrompts),
    captureChunks:            _bool(cfg.captureChunks,           D.captureChunks),
    captureTokens:            _bool(cfg.captureTokens,           D.captureTokens),
    langsmithTracingEnabled:  _bool(cfg.langsmithTracingEnabled, D.langsmithTracingEnabled),
    // Cost
    budgetCapInr:             _num(cfg.budgetCapInr,             D.budgetCapInr),
    dailyBudgetCapInr:        _num(cfg.dailyBudgetCapInr,        D.dailyBudgetCapInr),
    tokenLimitPerQuery:       _num(cfg.tokenLimitPerQuery,       D.tokenLimitPerQuery),
    budgetAlertThreshold:     _num(cfg.budgetAlertThreshold,     D.budgetAlertThreshold),
    // Security
    piiRedactionEnabled:      _bool(cfg.piiRedactionEnabled,     D.piiRedactionEnabled),
    promptInjectionDetection: _bool(cfg.promptInjectionDetection,D.promptInjectionDetection),
    rateLimitPerMinute:       _num(cfg.rateLimitPerMinute,       D.rateLimitPerMinute),
    contentModerationEnabled: _bool(cfg.contentModerationEnabled,D.contentModerationEnabled),
    // UI
    modelSelectorVisible:     cfg.modelSelectorVisible !== false,
  };

  try {
    await adminConfigRepository.saveAtlasConfigDoc(payload);
  } catch (err) {
    if (!appConfig.admin.localPreview) throw err;
    console.warn('[atlas-config] Firestore write failed in local preview, continuing without persistence:', err.message);
    _localAtlasConfigOverride = Object.assign({}, _localAtlasConfigOverride, payload);
  } finally {
    setLangSmithRuntimeEnabled(payload.langsmithTracingEnabled === true);
  }
}

async function patchAtlasObservabilityConfig(partial) {
  const enabled = partial && typeof partial.langsmithTracingEnabled === 'boolean'
    ? partial.langsmithTracingEnabled
    : undefined;
  if (typeof enabled !== 'boolean') return getAtlasConfig();
  try {
    await adminConfigRepository.saveAtlasConfigDoc({
      langsmithTracingEnabled: enabled,
    }, { merge: true });
  } catch (err) {
    if (!appConfig.admin.localPreview) throw err;
    console.warn('[atlas-config] Firestore patch failed in local preview, continuing without persistence:', err.message);
    _localAtlasConfigOverride = Object.assign({}, _localAtlasConfigOverride, { langsmithTracingEnabled: enabled });
  } finally {
    setLangSmithRuntimeEnabled(enabled === true);
  }
  return getAtlasConfig();
}

// ── Component registry toggle map ─────────────────────────────────────────────
async function getComponentRegistry() {
  const d = await adminConfigRepository.getComponentRegistryDoc();
  if (!d) return {};
  return d.enabled || {};
}

async function upsertComponentRegistry(enabled) {
  await adminConfigRepository.saveComponentRegistryDoc({
    enabled:   enabled || {},
  });
}

// ── Contact policy override (admin-managed) ───────────────────────────────────
async function getContactPolicyConfig() {
  const data = await adminConfigRepository.getContactPolicyDoc();
  if (!data) return null;
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
  await adminConfigRepository.saveContactPolicyDoc({
    privatePhone:   cleanPhone(privatePhone),
    allowedDomains:  cleanStringList(allowedDomains),
    personalDomains: cleanStringList(personalDomains),
    allowedEmails:   cleanStringList(allowedEmails),
    blockedDomains:  cleanStringList(blockedDomains),
    updatedBy:      updatedBy || null,
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
  patchAtlasObservabilityConfig,
  getComponentRegistry,
  upsertComponentRegistry,
  getContactPolicyConfig,
  upsertContactPolicyConfig,
};

