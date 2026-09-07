'use strict';

/**
 * sync-testimonial-to-firestore
 *
 * Eventarc 2nd-gen Pub/Sub trigger → Firestore. Applies the SF-owned workflow
 * fields (reply, repliedAt, status) onto recommendations/{uid}. Option B
 * (scoped sync): this function is the ONLY writer of those fields; it never
 * touches app-owned creation data (email, name, text, submittedAt, ...).
 *
 * Behavior contract lives in docs/architecture/gcp-side-review.md §4.
 */

const functions = require('@google-cloud/functions-framework');
const { Firestore, Timestamp, FieldValue } = require('@google-cloud/firestore');

const COLLECTION = 'recommendations';
// Attribute contract with the Salesforce publisher (TestimonialSyncQueueable).
// The live publisher sends eventType="TESTIMONIAL_UPSERT". We also accept
// "testimonial.updated" (an alternate value that appeared in the SF handoff
// brief) so the sync is robust to whichever value the org actually emits.
// Both sets are env-overridable so a contract change never needs a redeploy.
const ACCEPTED_EVENT_TYPES = new Set(
  (process.env.ACCEPTED_EVENT_TYPES || 'TESTIMONIAL_UPSERT,testimonial.updated')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
// Forward-compat guard: drop unknown versions rather than mis-parse them.
// Covers both the vN scheme and the "1.0" scheme seen in the SF brief.
const ACCEPTED_EVENT_VERSIONS = new Set(
  (process.env.ACCEPTED_EVENT_VERSIONS || 'v1,v2,v3,1.0')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const MAX_REPLY_LEN = 1000;

const db = new Firestore({
  databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)',
});

/** Structured log line; `event`/`metric` keys are what dashboards/alerts key off. */
function log(severity, event, fields) {
  process.stdout.write(
    JSON.stringify({ severity, event, ...fields }) + '\n'
  );
}

/** A transient error (5xx / network) — worth a Pub/Sub redelivery. */
function isTransient(err) {
  const code = err && (err.code || err.status);
  // gRPC codes: 14 UNAVAILABLE, 4 DEADLINE_EXCEEDED, 8 RESOURCE_EXHAUSTED, 13 INTERNAL, 10 ABORTED.
  if ([4, 8, 10, 13, 14].includes(code)) return true;
  if (typeof code === 'number' && code >= 500) return true;
  const msg = String((err && err.message) || '');
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|UNAVAILABLE|DEADLINE/i.test(msg);
}

/** Millis for a Firestore Timestamp / Date / ISO string; null if unparseable. */
function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

functions.cloudEvent('syncTestimonialToFirestore', async (cloudEvent) => {
  const message = cloudEvent && cloudEvent.data && cloudEvent.data.message;
  if (!message) {
    // Malformed envelope — ack (nothing to retry) and log.
    log('WARNING', 'no_message', { id: cloudEvent && cloudEvent.id });
    return;
  }

  const messageId = message.messageId || message.message_id || null;
  const attributes = message.attributes || {};
  const eventType = attributes.eventType;
  const eventVersion = attributes.eventVersion;

  // --- Attribute gate (before decoding the body): forward-compat guard. ---
  if (!ACCEPTED_EVENT_TYPES.has(eventType)) {
    log('WARNING', 'drop_unknown_event_type', { messageId, eventType, expected: [...ACCEPTED_EVENT_TYPES].join(','), metric: 'sync_dropped' });
    return; // ack
  }
  if (!ACCEPTED_EVENT_VERSIONS.has(eventVersion)) {
    log('WARNING', 'drop_unknown_event_version', { messageId, eventVersion, expected: [...ACCEPTED_EVENT_VERSIONS].join(','), metric: 'sync_dropped' });
    return; // ack
  }

  // --- Decode body. ---
  let payload;
  try {
    const raw = Buffer.from(message.data || '', 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch (err) {
    log('ERROR', 'bad_payload', { messageId, error: String(err.message), metric: 'sync_invalid' });
    return; // unparseable → ack (retry won't help)
  }

  // --- Validate SF-owned fields only. ---
  const uid = payload && payload.uid;
  if (!uid || typeof uid !== 'string') {
    log('ERROR', 'missing_uid', { messageId, metric: 'sync_invalid' });
    return; // ack
  }
  const status = payload.status;
  if (status !== undefined && status !== 'Active' && status !== 'Hidden') {
    log('ERROR', 'bad_status', { messageId, uid, status, metric: 'sync_invalid' });
    return; // ack
  }
  const replyRaw = payload.reply;
  if (replyRaw != null && (typeof replyRaw !== 'string' || replyRaw.length > MAX_REPLY_LEN)) {
    log('ERROR', 'bad_reply', { messageId, uid, replyLen: replyRaw && replyRaw.length, metric: 'sync_invalid' });
    return; // ack
  }
  const incomingMillis = toMillis(payload.sourceUpdatedAt);
  if (incomingMillis === null) {
    log('ERROR', 'bad_source_updated_at', { messageId, uid, sourceUpdatedAt: payload.sourceUpdatedAt, metric: 'sync_invalid' });
    return; // ack
  }

  const ref = db.collection(COLLECTION).doc(uid);

  try {
    const snap = await ref.get();

    // --- No orphan docs: SF-origin records with no site submission never sync. ---
    if (!snap.exists) {
      log('WARNING', 'doc_not_found', { messageId, uid, metric: 'sync_orphan' });
      return; // ack — do not create / DLQ / retry
    }

    // --- Idempotency fence: apply iff strictly newer than what we already have. ---
    const existingMillis = toMillis(snap.get('sourceUpdatedAt'));
    if (existingMillis !== null && incomingMillis <= existingMillis) {
      log('INFO', 'stale_drop', { messageId, uid, incomingMillis, existingMillis, metric: 'sync_stale' });
      return; // ack — drop on tie (>= semantics) and on older
    }

    // --- Merge-write only the SF-owned fields (+ updatedAt marker). ---
    const update = {
      reply: replyRaw != null ? String(replyRaw).slice(0, MAX_REPLY_LEN) : null,
      // repliedAt moves with reply; convert ISO → Firestore Timestamp (read model calls .toMillis()).
      repliedAt: payload.repliedAt ? Timestamp.fromDate(new Date(payload.repliedAt)) : null,
      sourceUpdatedAt: Timestamp.fromMillis(incomingMillis),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (status !== undefined) update.status = status;

    await ref.set(update, { merge: true });
    log('INFO', 'applied', { messageId, uid, status: status || null, hasReply: replyRaw != null, incomingMillis, metric: 'sync_applied' });
  } catch (err) {
    if (isTransient(err)) {
      // Throw → Eventarc/Pub/Sub redelivers (backoff 10s–600s, up to 5 attempts → DLQ).
      log('ERROR', 'transient_error', { messageId, uid, error: String(err.message), metric: 'sync_error' });
      throw err;
    }
    // Non-transient (e.g. permission/programming) → ack to avoid poison redelivery storms.
    log('ERROR', 'permanent_error', { messageId, uid, error: String(err.message), metric: 'sync_error' });
  }
});
