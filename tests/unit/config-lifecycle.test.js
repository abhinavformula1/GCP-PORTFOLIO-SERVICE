'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../../src/infrastructure/config');
const { createRuntime } = require('../../src/main/runtime');
const { createReadiness } = require('../../src/main/readiness');
const { createCloseController } = require('../../src/main/lifecycle');
const { startServer } = require('../../src/main/server');

test('config validates enums, booleans, numeric ranges, API versions, and URLs', function () {
  const matrices = [
    [{ NODE_ENV: 'staging' }, /NODE_ENV/],
    [{ NODE_ENV: 'test', PORT: '-1' }, /PORT/],
    [{ NODE_ENV: 'test', PORT: '65536' }, /PORT/],
    [{ NODE_ENV: 'test', ADMIN_LOCAL_PREVIEW: 'sometimes' }, /ADMIN_LOCAL_PREVIEW/],
    [{ NODE_ENV: 'test', LANGSMITH_TRACING: 'sometimes' }, /LANGSMITH_TRACING/],
    [{ NODE_ENV: 'test', SF_API_VERSION: '60' }, /SF_API_VERSION/],
    [{ NODE_ENV: 'test', SF_LOGIN_URL: 'ftp://example.com' }, /SF_LOGIN_URL/],
    [{ NODE_ENV: 'test', TAVILY_BASE_URL: 'not-a-url' }, /TAVILY_BASE_URL/],
    [{ NODE_ENV: 'test', MEILI_HOST: 'localhost:7700' }, /MEILI_HOST/],
    [{ NODE_ENV: 'test', COHERE_BASE_URL: 'file://local' }, /COHERE_BASE_URL/],
    [{ NODE_ENV: 'test', LANGSMITH_ENDPOINT: 'smtp://example.com' }, /LANGSMITH_ENDPOINT/],
    [{ NODE_ENV: 'test', SITE_URL: '/relative' }, /SITE_URL/],
  ];
  for (const [env, expected] of matrices) {
    assert.throws(() => loadConfig(env), expected);
  }
});

test('production allows absent optional providers but validates enabled integrations', function () {
  const base = { NODE_ENV: 'production', INTERNAL_REQUEST_SECRET: 'server-secret' };
  assert.equal(loadConfig(base).server.env, 'production');
  assert.throws(() => loadConfig({ ...base, SF_CLIENT_ID: 'client' }), /Salesforce credentials/);
  assert.throws(() => loadConfig({ ...base, STRIPE_PUBLISHABLE_KEY: 'pk_test_value' }), /Stripe credentials/);
  assert.throws(() => loadConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_value' }), /STRIPE_WEBHOOK_SECRET/);
  assert.throws(() => loadConfig({ ...base, LANGSMITH_TRACING: 'true' }), /LANGSMITH_API_KEY/);
  assert.throws(() => loadConfig({ ...base, MEILI_API_KEY: 'key' }), /MEILI_HOST/);
  assert.throws(() => loadConfig({ ...base, ADMIN_ALLOWED_EMAILS: 'admin@example.com' }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /INTERNAL_REQUEST_SECRET/);
});

test('configuration errors redact supplied values', function () {
  const secret = 'do-not-print-this-value';
  let error;
  try {
    loadConfig({
      NODE_ENV: 'production',
      INTERNAL_REQUEST_SECRET: 'server-secret',
      TAVILY_BASE_URL: `https://user:${secret}@example.com`,
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.equal(error.message.includes(secret), false);
  assert.match(error.message, /TAVILY_BASE_URL/);
});

test('runtime is derived only from validated configuration', function () {
  const config = loadConfig({
    NODE_ENV: 'test',
    K_SERVICE: 'portfolio',
    MEDIA_BUCKET: ' media-bucket ',
    ADMIN_LOCAL_PREVIEW: 'true',
    CHROME_PATH: ' /chrome ',
    SF_API_KEY: ' sf-key ',
    SITE_URL: 'https://example.com/path',
  });
  const runtime = createRuntime(config);
  assert.deepEqual(runtime, {
    isCloudRuntime: true,
    nodeEnv: 'test',
    mediaBucket: 'media-bucket',
    adminLocalPreview: false,
    chromePath: '/chrome',
    sfApiKey: 'sf-key',
    siteUrl: 'https://example.com',
  });
  assert.equal(Object.isFrozen(runtime), true);
  assert.throws(() => createRuntime({ NODE_ENV: 'test' }), /validated configuration/);
});

test('readiness aggregates local capability checks without network access', async function () {
  const readiness = createReadiness({
    config: () => true,
    adapter: () => false,
    capability() { throw new Error('not initialized'); },
  });
  assert.deepEqual(await readiness.check(), {
    ready: false,
    failed: ['adapter', 'capability'],
  });
});

test('injected readiness failure returns a safe 503 response', async function () {
  const config = loadConfig({ NODE_ENV: 'test' });
  const control = startServer({
    port: 0,
    config,
    runtime: createRuntime(config),
    readiness: { async check() { return { ready: false, failed: ['secret-adapter-name'] }; } },
    logger: { log() {}, error() {} },
  });
  const address = await control.ready;
  const response = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not-ready' });
  await control.close();
});

test('close hooks execute once in reverse order', async function () {
  const order = [];
  const close = createCloseController({
    server: { listening: false, close() {} },
    closeHooks: [
      async () => order.push('first'),
      async () => order.push('second'),
      async () => order.push('third'),
    ],
    logger: { error() {} },
  });
  const firstClose = close();
  const secondClose = close();
  assert.equal(firstClose, secondClose);
  await Promise.all([firstClose, secondClose]);
  assert.deepEqual(order, ['third', 'second', 'first']);
});

test('close hooks aggregate failures after running every hook', async function () {
  const order = [];
  const logged = [];
  const close = createCloseController({
    server: { listening: false, close() {} },
    closeHooks: [
      async () => { order.push('first'); throw new Error('first failed'); },
      async () => { order.push('second'); throw new Error('second failed'); },
    ],
    logger: { error(...args) { logged.push(args); } },
  });
  await assert.rejects(close(), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.deepEqual(order, ['second', 'first']);
  assert.equal(logged.length, 2);
});

test('importing createApp installs no signals, rejection handlers, or listener', function () {
  const root = path.resolve(__dirname, '..', '..');
  const script = `
    const before = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
      rejection: process.listenerCount('unhandledRejection')
    };
    require('./src/main/server');
    const after = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
      rejection: process.listenerCount('unhandledRejection'),
      servers: process._getActiveHandles().filter((h) => h && h.constructor && h.constructor.name === 'Server').length
    };
    process.stdout.write(JSON.stringify({ before, after }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.after.sigterm, output.before.sigterm);
  assert.equal(output.after.sigint, output.before.sigint);
  assert.equal(output.after.rejection, output.before.rejection);
  assert.equal(output.after.servers, 0);
});
