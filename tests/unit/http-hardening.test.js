'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, createApp } = require('../../src/main/server');
const { createRuntime } = require('../../src/main/runtime');
const { loadConfig } = require('../../src/infrastructure/config');

const config = loadConfig({ NODE_ENV: 'test' });
const runtime = createRuntime(config);

test('server supports port zero and exposes lifecycle controls', async function () {
  const control = startServer({
    port: 0,
    config,
    runtime,
    logger: { log() {} },
  });
  const address = await control.ready;
  assert.equal(typeof address.port, 'number');
  assert.ok(address.port > 0);
  assert.equal(control.address().port, address.port);

  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.status, 'ok');
  assert.equal(typeof healthBody.env, 'string');

  const ready = await fetch(`${base}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });

  const missing = await fetch(`${base}/api/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    success: false,
    code: 'NOT_FOUND',
    error: 'API route not found.',
  });
  await control.close();
});

test('Stripe raw-body route is registered before JSON parsing', function () {
  const app = createApp({ config, runtime });
  assert.equal(app.locals.composition, undefined);
  assert.deepEqual(app.locals.readiness, { initialized: true });
  const stack = app._router.stack;
  const webhookIndex = stack.findIndex((layer) => layer.route
    && layer.route.path === '/api/billing/webhook');
  const jsonIndex = stack.findIndex((layer) => layer.name === 'jsonParser');
  assert.ok(webhookIndex >= 0);
  assert.ok(jsonIndex > webhookIndex);
});
