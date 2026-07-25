'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/infrastructure/config');
const { createRuntime } = require('../../src/main/runtime');
const { buildComposition } = require('../../src/main/composition');
const { createFirestoreClient } = require('../../src/infrastructure/persistence/firestore/client');
const { createAtlasRepository } = require('../../src/infrastructure/persistence/firestore/atlasRepository');
const { createArticlesRepository } = require('../../src/infrastructure/persistence/firestore/articlesRepository');
const { createStripeClient } = require('../../src/infrastructure/billing/stripe');
const { createStripeGateway } = require('../../src/infrastructure/billing/stripeGateway');
const { createGoogleIdentityVerifier } = require('../../src/infrastructure/identity/google');
const { createTavilySearch } = require('../../src/infrastructure/search/tavily/search');
const { createProviderRegistry } = require('../../src/infrastructure/ai/llm/providers');
const { createLlmGateway } = require('../../src/infrastructure/ai/llm');
const { createTracingAdapter } = require('../../src/infrastructure/observability/langsmith');

test('Firestore client is lazy, instance-owned, and closes once', async function () {
  let created = 0;
  let terminated = 0;
  class FakeFirestore {
    constructor(options) {
      created += 1;
      this.options = options;
    }
    async terminate() {
      terminated += 1;
    }
  }

  const config = loadConfig({
    NODE_ENV: 'test',
    FIRESTORE_PROJECT_ID: 'test-project',
    FIRESTORE_DATABASE_ID: 'test-db',
  });
  const first = createFirestoreClient({ config, FirestoreClass: FakeFirestore });
  const second = createFirestoreClient({ config, FirestoreClass: FakeFirestore });
  assert.equal(created, 0);
  assert.notEqual(first.getDb(), second.getDb());
  assert.equal(first.getDb(), first.getDb());
  assert.equal(created, 2);
  const closeOne = first.close();
  const closeTwo = first.close();
  assert.equal(closeOne, closeTwo);
  await Promise.all([closeOne, closeTwo]);
  assert.equal(terminated, 1);
  await second.close();
  assert.equal(terminated, 2);
});

test('Atlas repository fallback state is isolated per adapter instance', async function () {
  const unavailableFirestore = {
    getDb() {
      throw new Error('Could not load the default credentials');
    },
  };
  const logger = { warn() {} };
  const first = createAtlasRepository({ firestore: unavailableFirestore, logger });
  const second = createAtlasRepository({ firestore: unavailableFirestore, logger });
  const entry = {
    normalizedQuestion: 'question',
    model: 'flash',
    personaVersion: 'v1',
    answer: 'first-only',
    expiresAtMs: Date.now() + 60_000,
  };

  await first.saveCacheEntry('cache-key', entry);
  assert.deepEqual(await first.getCacheEntry('cache-key'), {
    answer: 'first-only',
    model: 'flash',
  });
  assert.equal(await second.getCacheEntry('cache-key'), null);
});

test('composition owns the Firestore close hook without eager construction', async function () {
  let created = 0;
  let terminated = 0;
  class FakeFirestore {
    constructor() {
      created += 1;
    }
    async terminate() {
      terminated += 1;
    }
  }
  const config = loadConfig({ NODE_ENV: 'test' });
  const composition = buildComposition(createRuntime(config), {
    config,
    FirestoreClass: FakeFirestore,
    logger: { warn() {} },
  });
  assert.equal(created, 0);
  assert.equal(composition.closeHooks.length, 1);
  assert.equal(composition.closeHooks[0], composition.firestore.close);
  composition.firestore.getDb();
  assert.equal(created, 1);
  await composition.closeHooks[0]();
  await composition.closeHooks[0]();
  assert.equal(terminated, 1);
});

test('adapter factories fail fast on incomplete contracts', function () {
  assert.throws(() => createFirestoreClient({ config: {} }), /config\.firestore/);
  assert.throws(() => createAtlasRepository({ firestore: {} }), /firestore\.getDb/);
  assert.throws(() => createArticlesRepository({ firestore: {} }), /firestore\.getDb/);
  assert.throws(() => createStripeClient({ config: {} }), /config\.stripe/);
  assert.throws(() => createStripeGateway({ stripeClient: {} }), /stripeClient/);
  assert.throws(() => createGoogleIdentityVerifier({ config: {} }), /config\.google/);
  assert.throws(() => createTavilySearch({ config: {} }), /config\.tavily/);
  assert.throws(() => createProviderRegistry({ geminiProvider: {} }), /geminiProvider/);
  assert.throws(() => createLlmGateway({}), /getProvider/);
  assert.throws(() => createTracingAdapter({ config: {} }), /config\.langsmith/);
});
