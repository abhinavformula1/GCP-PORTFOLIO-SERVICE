'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { loadConfig } = require('../../src/infrastructure/config');
const { assertDependencies } = require('../../src/application/ports/assert');
const { validateComposition } = require('../../src/main/validateComposition');
const { installGracefulShutdown } = require('../../src/main/lifecycle');
const { createAuthMiddleware } = require('../../src/interfaces/http/middleware/auth');
const { createAuthorizationService } = require('../../src/application/auth/createAuthorizationService');
const { createRecommendationUseCases } = require('../../src/application/recommendations/createRecommendationUseCases');
const { createRagService } = require('../../src/application/rag/createRagService');
const { createContactPolicy } = require('../../src/application/auth/createContactPolicy');
const { createBillingService } = require('../../src/application/billing/createBillingService');
const { errorHandler } = require('../../src/interfaces/http/middleware/errorHandler');
const { AppError } = require('../../src/domain/errors');

test('config rejects invalid ports and production credential matrices', function () {
  assert.throws(() => loadConfig({ PORT: 'abc', NODE_ENV: 'test' }), /PORT/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    SF_CLIENT_ID: 'id',
  }), /Salesforce credentials/);
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    STRIPE_SECRET_KEY: 'redacted',
  }), /STRIPE_WEBHOOK_SECRET/);
});

test('config normalizes values and deep-freezes the result', function () {
  const config = loadConfig({
    PORT: '0',
    NODE_ENV: 'TEST',
    ADMIN_LOCAL_PREVIEW: 'true',
    LANGSMITH_TRACING: '1',
    SITE_URL: 'https://example.com/path',
  });
  assert.equal(config.server.port, 0);
  assert.equal(config.server.env, 'test');
  assert.equal(config.admin.localPreview, true);
  assert.equal(config.langsmith.tracingEnabled, true);
  assert.equal(config.stripe.siteUrl, 'https://example.com');
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.server), true);
});

test('application dependency assertions identify exact missing methods', function () {
  assert.throws(
    () => assertDependencies({ repository: {} }, 'application.example', {
      repository: ['save'],
    }),
    /application\.example\.repository\.save/
  );
});

test('composition validation fails before Express wiring', function () {
  assert.throws(
    () => validateComposition({ config: {}, repositories: {}, httpCapabilities: {}, readiness: { check() {} }, closeHooks: [] }),
    /composition\.repositories\.adminConfig/
  );
});

test('auth middleware never enables local-preview token in cloud runtime', async function () {
  const authorization = createAuthorizationService({
    identity: { async verifyIdToken() { throw new Error('must not verify'); } },
    adminPolicy: { allowedEmails: [] },
    runtime: { adminLocalPreview: true, nodeEnv: 'development', isCloudRuntime: true },
  });
  const middleware = createAuthMiddleware({
    authorization,
  });
  const req = {
    headers: { host: 'localhost', authorization: 'Bearer local-admin-preview' },
  };
  const error = await new Promise((resolve) => middleware.requireAuth(req, {}, resolve));
  assert.match(error.message, /must not verify/);
});

test('graceful lifecycle closes once for repeated signals', async function () {
  const processRef = new EventEmitter();
  processRef.exitCode = 0;
  let closes = 0;
  const uninstall = installGracefulShutdown({
    async close() { closes += 1; },
  }, {
    processRef,
    logger: { log() {}, error() {} },
  });
  processRef.emit('SIGTERM');
  processRef.emit('SIGINT');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  uninstall();
});

function recommendationUseCases(overrides = {}) {
  return createRecommendationUseCases({
    repository: Object.assign({
      async listActiveRecommendations() { return []; },
      async upsertRecommendation() { return { isNew: true }; },
      async deleteRecommendation() { return { deleted: true }; },
      async writeRecommendationReply() { return { applied: true }; },
    }, overrides.repository),
    salesforce: Object.assign({
      async upsertRecommendation() { return { id: 'sf-1' }; },
      async deleteRecommendation() { return { deleted: true }; },
    }, overrides.salesforce),
    identity: { async verifyIdToken() { return { uid: 'u1', email: 'a@example.com', name: 'A', picture: null }; } },
    randomUUID: () => 'tx-1',
    secureCompare: (left, right) => left === right,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    logger: { error() {} },
    callbackSecret: 'secret',
  });
}

test('recommendation remains successful when Salesforce synchronization fails', async function () {
  const service = recommendationUseCases({
    salesforce: { async upsertRecommendation() { throw new Error('salesforce down'); } },
  });
  const result = await service.submit({ token: 'token', text: 'Excellent work' });
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.success, true);
  assert.equal(result.body.salesforceSynced, false);
});

test('recommendation does not call Salesforce when public-store write fails', async function () {
  let salesforceCalls = 0;
  const service = recommendationUseCases({
    repository: { async upsertRecommendation() { throw new Error('firestore down'); } },
    salesforce: { async upsertRecommendation() { salesforceCalls += 1; } },
  });
  await assert.rejects(() => service.submit({ token: 'token', text: 'Excellent work' }), /firestore down/);
  assert.equal(salesforceCalls, 0);
});

test('RAG retrieval failures preserve the base prompt fallback', async function () {
  const rag = createRagService({
    async embedText() { throw new Error('embedding unavailable'); },
    async saveChunks() {},
    async deleteChunksForArticle() {},
    async findNearestChunks() { return []; },
    adminConfig: { async getAtlasConfig() { return {}; } },
    async keywordSearch() { return []; },
    async upsertKeywordChunks() {},
    async deleteKeywordChunksByArticle() {},
    async rerankIfConfigured(items) { return items; },
  });
  const prompt = await rag.buildRagContext('question', { baseSystemPrompt: 'BASE' });
  assert.equal(prompt, 'BASE');
});

test('contact policy allows company identities and blocks personal domains', async function () {
  const policy = createContactPolicy({
    config: {
      server: { env: 'development' },
      admin: { allowedEmails: [] },
      contactPolicy: {
        allowedDomains: [],
        personalDomains: ['gmail.com'],
        allowedEmails: [],
        blockedDomains: [],
        privatePhone: '+91 12345678',
      },
    },
    adminConfig: { async getContactPolicyConfig() { throw new Error('offline'); } },
    isCloudRuntime: false,
  });
  assert.equal((await policy.resolveContactViewAsync({ email: 'a@google.com' })).canSeePhone, true);
  assert.equal((await policy.resolveContactViewAsync({ email: 'a@gmail.com' })).canSeePhone, false);
});

test('billing entitlement maps normalized active subscriptions', async function () {
  const noop = async () => ({});
  const billing = createBillingService({
    clock: Date,
    billingRepository: {
      appendBillingEvent: noop, upsertBillingUser: noop, upsertBillingCustomer: noop,
      getBillingCustomer: noop,
      async getBillingUser() {
        return { status: 'active', currentPeriodEnd: Date.now() + 60_000, cancelAtPeriodEnd: false };
      },
      listBillingUsers: async () => [],
    },
    usersRepository: { getUser: noop, mergeUserFields: noop },
    stripeGateway: {
      isConfigured: () => false,
      retrievePrice: noop, listPromotionCodes: noop, createCheckoutSession: noop,
      retrieveCheckoutSession: noop, updateSubscription: noop, retrieveSubscription: noop,
      createBillingPortalSession: noop, constructWebhookEvent: noop,
    },
  });
  const entitlement = await billing.getUserSubscriptionEntitlement('u1');
  assert.equal(entitlement.active, true);
  assert.equal(entitlement.status, 'active');
});

test('error middleware exposes operational errors and redacts unexpected ones', function () {
  function responseRecorder() {
    return {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
  }
  const operational = responseRecorder();
  errorHandler(new AppError('Denied', 403, 'FORBIDDEN'), {}, operational, () => {});
  assert.deepEqual(operational.body, { success: false, code: 'FORBIDDEN', error: 'Denied' });

  const unexpected = responseRecorder();
  const originalError = console.error;
  console.error = () => {};
  try {
    errorHandler(new Error('secret detail'), { originalUrl: '/x', method: 'GET' }, unexpected, () => {});
  } finally {
    console.error = originalError;
  }
  assert.equal(unexpected.statusCode, 500);
  assert.equal(unexpected.body.error.includes('secret detail'), false);
});
