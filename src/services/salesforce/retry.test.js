'use strict';

/**
 * Unit tests for the retry-with-exponential-backoff helper.
 *
 * No test framework — uses node:test + node:assert (Node ≥18 built-ins).
 * Run with:   node --test src/services/salesforce/retry.test.js
 *
 * Why test this directly (and not just integration-test the route):
 *   The retry policy is the single point where transient vs permanent
 *   failures get classified. A bug here means we either flood Salesforce
 *   with retries on a 400 (validation) or give up on a 502 (transient).
 *   Both modes are observable only under failure — exactly when they're
 *   hardest to reproduce in production. So we pin the behaviour with
 *   pure unit tests.
 */

const test   = require('node:test');
const assert = require('node:assert/strict');

const { withRetry, isTransientSalesforceError } = require('./retry');

// ── isTransientSalesforceError classifier ──────────────────────────────────

test('isTransientSalesforceError: network errors are transient', () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN']) {
    const err = Object.assign(new Error('network'), { code });
    assert.equal(isTransientSalesforceError(err), true, `code=${code}`);
  }
});

test('isTransientSalesforceError: 429/5xx Salesforce errors are transient', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const err = new Error(`Apex REST upsert failed (HTTP ${status})`);
    assert.equal(isTransientSalesforceError(err), true, `HTTP ${status}`);
  }
});

test('isTransientSalesforceError: validation/auth/not-found are PERMANENT', () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const err = new Error(`Apex REST upsert failed (HTTP ${status})`);
    assert.equal(isTransientSalesforceError(err), false, `HTTP ${status}`);
  }
});

test('isTransientSalesforceError: null / undefined → false', () => {
  assert.equal(isTransientSalesforceError(null), false);
  assert.equal(isTransientSalesforceError(undefined), false);
});

// ── withRetry behaviour ────────────────────────────────────────────────────

test('withRetry: success on first attempt — returns immediately, no retry', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return 'ok';
  }, { attempts: 3, baseMs: 1, jitterMs: 0, shouldRetry: () => true });

  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry: retries up to N attempts and succeeds on last', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('transient');
    return 'eventually';
  }, {
    attempts:    3,
    baseMs:      1,
    factor:      2,
    jitterMs:    0,
    shouldRetry: () => true,
  });

  assert.equal(result, 'eventually');
  assert.equal(calls, 3);
});

test('withRetry: rethrows when attempts are exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      const e = new Error('still bad');
      e.code = 'ECONNRESET';
      throw e;
    }, {
      attempts:    3,
      baseMs:      1,
      jitterMs:    0,
      shouldRetry: isTransientSalesforceError,
    }),
    /still bad/
  );
  assert.equal(calls, 3);
});

test('withRetry: does NOT retry permanent errors', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error('upsertQuestion failed (HTTP 400)');
    }, {
      attempts:    5,
      baseMs:      1,
      jitterMs:    0,
      shouldRetry: isTransientSalesforceError,
    }),
    /HTTP 400/
  );
  assert.equal(calls, 1, 'should fail fast on 400');
});

test('withRetry: backoff grows exponentially (timing sanity check)', async () => {
  // baseMs=20, factor=3 → expected delays ~20ms, ~60ms (no jitter)
  // Total elapsed for 3 attempts that all fail must be ≥80ms.
  const start = Date.now();
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw new Error('boom');
    }, {
      attempts:    3,
      baseMs:      20,
      factor:      3,
      jitterMs:    0,
      shouldRetry: () => true,
    })
  );
  const elapsed = Date.now() - start;
  assert.equal(calls, 3);
  assert.ok(elapsed >= 75, `elapsed should be ≥ 75ms (was ${elapsed}ms)`);
});
