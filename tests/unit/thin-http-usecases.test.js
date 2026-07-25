'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHttpCapabilities } = require('../../src/application/http/createHttpCapabilities');
const { createMediaUseCases } = require('../../src/application/media/createMediaUseCases');
const { createBillingUseCases } = require('../../src/application/billing/createBillingUseCases');
const { createSoftwareArchitectureUseCases } = require('../../src/application/content/createSoftwareArchitectureUseCases');
const { createAnalyticsService } = require('../../src/application/analytics/createAnalyticsService');
const { createAtlasChatUseCases } = require('../../src/application/atlas/createAtlasChatUseCases');
const { createRouter: createMediaRouter } = require('../../src/interfaces/http/routes/media');

const noop = async () => {};

function methodPort(names) {
  return Object.fromEntries(names.map((name) => [name, noop]));
}

test('HTTP capability factory exposes exact frozen allowlists', function () {
  const capability = createHttpCapabilities({
    atlasRepository: {
      ...methodPort(['getActiveConversation', 'appendTurn', 'appendUsageEvent', 'getCacheEntry', 'saveCacheEntry', 'getUsageSummary', 'clearActiveConversation']),
      secretRepositoryMethod: noop,
    },
    articlesRepository: {
      ...methodPort(['listPublishedArticles', 'getArticle', 'listArticles', 'upsertArticle', 'deleteArticle']),
      rawFirestoreDocument: noop,
    },
    ragAdminRepository: {
      ...methodPort(['getGoldenDatasetRows', 'resetGoldenDataset', 'saveGoldenDatasetRows', 'saveRagEvalRun', 'listRagEvalRuns', 'deleteRagEvalRun']),
      collectionReference: noop,
    },
    adminConfig: {
      ...methodPort(['getTierConfig', 'getSeoConfig', 'upsertSeoConfig', 'getComponentRegistry', 'upsertComponentRegistry', 'upsertTierConfig', 'upsertContactPolicyConfig', 'getAtlasConfig', 'patchAtlasObservabilityConfig', 'upsertAtlasConfig']),
      internalConfig: noop,
    },
    pdfGenerator: methodPort(['generatePdf', 'checkChrome']),
  });

  assert.deepEqual(Object.keys(capability.atlasPersistence), [
    'getActiveConversation', 'appendTurn', 'appendUsageEvent', 'getCacheEntry',
    'saveCacheEntry', 'getUsageSummary', 'clearActiveConversation',
  ]);
  assert.deepEqual(Object.keys(capability.articleContent), [
    'listPublishedArticles', 'getArticle', 'listArticles', 'upsertArticle', 'deleteArticle',
  ]);
  assert.equal('secretRepositoryMethod' in capability.atlasPersistence, false);
  assert.equal('rawFirestoreDocument' in capability.articleContent, false);
  assert.equal(Object.isFrozen(capability), true);
  assert.equal(Object.isFrozen(capability.configuration), true);
});

test('media use case blocks deletion when an article still references an object', async function () {
  let deleted = false;
  const media = createMediaUseCases({
    storage: {
      uploadMedia: noop,
      listMediaObjects: async () => [],
      async deleteMediaObject() { deleted = true; },
    },
    articles: {
      async listArticles() {
        return [{ id: 'a1', en: { title: 'Article' }, thumbnail: 'https://storage.googleapis.com/bucket/media/image.png' }];
      },
    },
    sponsorBanner: methodPort(['getSponsorBanner', 'upsertSponsorBanner', 'deleteSponsorBanner']),
    runtime: { mediaBucket: 'bucket', nodeEnv: 'test', isCloudRuntime: false, adminLocalPreview: false },
    clock: Date,
    maxUploadBytes: 1024,
  });
  const result = await media.removeObject('media/image.png');
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'MEDIA_IN_USE');
  assert.equal(deleted, false);
});

function billingPort(overrides = {}) {
  return {
    isStripeConfigured: () => true,
    retrievePrice: noop,
    listPromotionCodes: async () => ({ data: [] }),
    createCheckoutSession: async () => ({ id: 'cs_1', url: 'https://stripe.test', client_secret: 'secret' }),
    getStripeCustomerIdForUser: async () => null,
    appendStripeCheckoutInitiated: async () => {},
    retrieveCheckoutSession: noop,
    updateSubscription: noop,
    claimStripeCheckoutOwnership: noop,
    retrieveSubscription: noop,
    upsertStripeSubscription: noop,
    createBillingPortalSession: noop,
    getSubscriptionsOverview: async () => ({ subscriptions: [] }),
    ...overrides,
  };
}

test('billing use case owns embedded provider fallback', async function () {
  const modes = [];
  const billing = createBillingUseCases({
    billing: billingPort({
      async createCheckoutSession(input) {
        modes.push(input.ui_mode);
        if (input.ui_mode === 'embedded_page') {
          throw Object.assign(new Error('invalid ui_mode'), { param: 'ui_mode' });
        }
        return { id: 'cs_1', client_secret: 'secret' };
      },
    }),
    settings: {
      environment: 'test',
      isCloudRuntime: false,
      adminLocalPreview: false,
      stripe: { priceMonthly: 'price_m', priceYearly: '', siteUrl: 'http://localhost:8080' },
    },
  });
  const result = await billing.createGuestEmbedded({ input: {}, baseUrl: 'http://localhost:8080' });
  assert.deepEqual(modes, ['embedded_page', 'embedded']);
  assert.deepEqual(result, { success: true, clientSecret: 'secret' });
});

function softwareDependencies({ articles, entitlementActive = false, localPreview = false } = {}) {
  return {
    configuration: methodPort([
      'getTierConfig', 'getSeoConfig', 'upsertSeoConfig', 'getComponentRegistry',
      'upsertComponentRegistry', 'upsertTierConfig', 'upsertContactPolicyConfig',
      'getAtlasConfig', 'patchAtlasObservabilityConfig', 'upsertAtlasConfig',
    ]),
    articles: {
      ...methodPort(['getArticle', 'listArticles', 'upsertArticle', 'deleteArticle']),
      listPublishedArticles: async () => articles || [],
    },
    ragAdmin: methodPort([
      'getGoldenDatasetRows', 'resetGoldenDataset', 'saveGoldenDatasetRows',
      'saveRagEvalRun', 'listRagEvalRuns', 'deleteRagEvalRun',
    ]),
    billing: { async getUserSubscriptionEntitlement() { return { active: entitlementActive }; } },
    contactPolicy: {
      ...methodPort(['getContactPolicyConfig', 'normaliseDomains', 'normaliseEmails']),
      normaliseDomains: (values) => values,
      normaliseEmails: (values) => values,
    },
    sponsorships: methodPort(['listActiveSponsorships', 'listSponsorships', 'upsertSponsorship', 'deleteSponsorship']),
    localPreviewContent: { getLocalPreviewArticles: () => [], getLocalPreviewArticle: () => null },
    indexArticle: noop,
    removeArticleChunks: noop,
    evaluateRetrieval: noop,
    generateChatResponse: noop,
    runtimeMetrics: () => ({}),
    clock: Date,
    logger: { warn() {}, error() {} },
    settings: {
      localPreview,
      localDevelopment: localPreview,
      allowedAdminEmails: [],
      privatePhone: '',
      geminiReady: false,
      langsmithReady: false,
    },
  };
}

test('premium-access policy strips content without entitlement', async function () {
  const article = {
    id: 'premium',
    tier: 'premium',
    blocks: [{ type: 'text', value: 'secret' }],
    en: { title: 'Premium', body: 'secret' },
  };
  const software = createSoftwareArchitectureUseCases(softwareDependencies({ articles: [article] }));
  const result = await software.listPublished({ uid: '', forceLocked: false });
  assert.equal(result.body.articles[0].hasAccess, false);
  assert.deepEqual(result.body.articles[0].blocks, []);
  assert.equal(result.body.articles[0].en.body, '');
});

test('premium-access policy returns full content for active subscribers', async function () {
  const article = { id: 'premium', tier: 'premium', blocks: [{ value: 'full' }], en: { title: 'P', body: 'full' } };
  const software = createSoftwareArchitectureUseCases(softwareDependencies({
    articles: [article],
    entitlementActive: true,
  }));
  const result = await software.listPublished({ uid: 'u1', forceLocked: false });
  assert.equal(result.body.articles[0].hasAccess, true);
  assert.equal(result.body.articles[0].en.body, 'full');
  assert.equal(result.cacheControl, 'private, no-store');
});

test('local-preview forceLocked never widens premium access', async function () {
  const article = { id: 'premium', tier: 'premium', blocks: [{ value: 'full' }], en: { title: 'P', body: 'full' } };
  const software = createSoftwareArchitectureUseCases(softwareDependencies({
    articles: [article],
    entitlementActive: true,
    localPreview: true,
  }));
  const result = await software.listPublished({ uid: 'local-admin-preview', forceLocked: true });
  assert.equal(result.body.articles[0].hasAccess, false);
  assert.equal(result.body.articles[0].en.body, '');
});

test('analytics use case normalizes request payload before persistence', async function () {
  let recorded;
  const analytics = createAnalyticsService({
    crypto,
    analyticsRepository: {
      async recordEvent(value) { recorded = value; },
      ...methodPort(['fetchOverview', 'fetchTodayUsers', 'cleanupMonthlyTestData', 'cleanupDailyTestUsers']),
    },
    geoLookup: () => ({ city: 'Paris', region: 'IDF', country: 'FR' }),
  });
  await analytics.recordEventRequest({
    type: ' click ',
    clientId: ' client-123 ',
    path: ' /x ',
    dwellMs: '12',
  }, '8.8.8.8');
  assert.equal(recorded.eventType, 'click');
  assert.equal(recorded.path, '/x');
  assert.equal(recorded.geoCountry, 'FR');
});

test('route factories reject incomplete narrow capabilities at startup', function () {
  assert.throws(
    () => createMediaRouter({ requireAdmin() {}, media: {} }),
    /interfaces\.routes\.media\.media\.upload/
  );
});

test('Atlas use case rejects incomplete model capability at composition time', function () {
  assert.throws(() => createAtlasChatUseCases({
    persistence: methodPort(['getActiveConversation', 'appendTurn', 'appendUsageEvent', 'getCacheEntry', 'saveCacheEntry', 'getUsageSummary', 'clearActiveConversation']),
    responder: { ask: noop, askStream: noop },
    orchestrator: methodPort(['buildExecutionPlan', 'isPlanCacheSafe', 'loadRuntimeConfig', 'buildCallConfig']),
    tracing: methodPort(['setLangSmithRuntimeEnabled', 'setLangSmithCapturePolicy']),
    getAtlasConfig: noop,
    randomUUID: () => 'tx',
    hashText: () => 'hash',
    logger: { log() {}, error() {} },
    settings: { localPreview: false },
  }), /application\.atlasChat\.responder\.LLM_MODELS/);
});
