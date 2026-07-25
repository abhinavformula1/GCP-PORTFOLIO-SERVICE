'use strict';

/**
 * Retry-with-exponential-backoff helper — STABLE layer.
 *
 * Generic enough to wrap any async operation. Used by domain services that
 * call Salesforce so a flaky transient failure (network blip, brief 5xx,
 * 429 throttle) doesn't surface to the caller as a hard error.
 *
 * Design rules:
 *
 *   1. Only retry transient errors. Validation (4xx-except-429), auth (401),
 *      and "not found" (404) are PERMANENT — retrying just burns budget and
 *      delays the inevitable failure. The caller decides what's transient
 *      via the `shouldRetry` predicate.
 *
 *   2. Exponential backoff with jitter. Each attempt waits
 *      `baseMs * factor^attempt + random(0..jitterMs)`. Jitter prevents
 *      thundering-herd retries from synchronised clients.
 *
 *   3. Bounded. Default 3 attempts (1 initial + 2 retries). Salesforce will
 *      not magically heal in 10 retries if it's down — fail fast and let the
 *      caller fall back (queue, 5xx to user, etc.).
 *
 *   4. No silent swallowing. The final failure is rethrown verbatim so the
 *      caller sees the real cause (with the SalesforceError chain intact).
 *
 *   5. Observable. Each retry is logged with attempt number + delay, so a
 *      retry storm shows up clearly in Cloud Run logs.
 *
 * This helper does NOT decide whether 401 is retryable — the auth/token-
 * refresh retry lives in the domain layer (see siteVisitor.js, recruiterInquiry.js)
 * because it has different semantics (invalidate cache, re-fetch token, retry
 * exactly once with no backoff).
 */

/**
 * Sleep for the given milliseconds. Promise-wrapped setTimeout.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with retries. Default policy retries up to twice on transient
 * errors with exponential backoff: ~200ms, ~600ms (plus jitter).
 *
 * @template T
 * @param {() => Promise<T>}                fn          The async operation to run.
 * @param {object}                          [opts]
 * @param {number}                          [opts.attempts=3]   Total attempts (initial + retries).
 * @param {number}                          [opts.baseMs=200]   Base delay before first retry.
 * @param {number}                          [opts.factor=3]     Multiplier per attempt.
 * @param {number}                          [opts.jitterMs=100] Random extra ms (0..jitterMs).
 * @param {(err: any) => boolean}           [opts.shouldRetry]  Predicate. Default: never retry.
 * @param {string}                          [opts.label]        For log lines (e.g. "upsertQuestion").
 * @returns {Promise<T>}
 */
async function withRetry(fn, opts = {}) {
  const attempts    = Math.max(1, opts.attempts ?? 3);
  const baseMs      = opts.baseMs ?? 200;
  const factor      = opts.factor ?? 3;
  const jitterMs    = opts.jitterMs ?? 100;
  const shouldRetry = opts.shouldRetry ?? (() => false);
  const label       = opts.label || 'op';

  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(err)) {
        throw err;
      }
      const delay = Math.round(baseMs * Math.pow(factor, attempt) + Math.random() * jitterMs);
      console.warn(
        `[retry:${label}] attempt ${attempt + 1}/${attempts} failed (${err && err.message}); ` +
        `retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  // Unreachable — the loop either returns or throws — but TypeScript-style safety:
  throw lastErr;
}

/**
 * Default predicate: retry on transport-level network errors and on
 * Salesforce HTTP responses that indicate the server (or proxy) is the
 * problem rather than the request.
 *
 *   ECONNRESET / ETIMEDOUT / ENOTFOUND / EAI_AGAIN  → network blip
 *   429                                              → API throttle
 *   500 / 502 / 503 / 504                            → upstream hiccup
 *
 * Anything else (400 validation, 401 auth, 403 forbidden, 404 not found,
 * 409 duplicate-rule, etc.) is PERMANENT — surface immediately.
 *
 * Two error shapes are supported:
 *   - Plain Node error with `.code` (network)
 *   - SalesforceError with `.detail` containing "(HTTP <n>)" — keeps things
 *     simple without coupling this helper to the SalesforceError class.
 */
function isTransientSalesforceError(err) {
  if (!err) return false;
  // Network-level (Node https module emits these)
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(err.code)) {
    return true;
  }
  // HTTP-level — domain code stamps the status into the message
  const msg = `${err.message || ''} ${err.detail || ''}`;
  return /HTTP (429|500|502|503|504)\b/.test(msg);
}

module.exports = { withRetry, isTransientSalesforceError, sleep };
