'use strict';

const { ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createSessionService(dependencies) {
  assertDependencies(dependencies, 'application.session', {
    users: ['upsertUserVisit'],
    billing: ['getUserSubscriptionEntitlement'],
    salesforce: ['upsertSiteVisitor'],
    identity: ['verifyIdToken'],
    contactPolicy: ['resolveContactViewAsync'],
    randomUUID: 'function',
    now: 'function',
    logger: 'value',
    runtime: 'value',
  });
  const {
    users, billing, salesforce, identity, contactPolicy,
    randomUUID, now, logger, runtime,
  } = dependencies;

  function canUseLocalPreview(host, credential) {
    const safeRuntime = runtime.nodeEnv !== 'production' && !runtime.isCloudRuntime;
    const localHost = String(host || '').toLowerCase().startsWith('localhost')
      || String(host || '').toLowerCase().startsWith('127.0.0.1');
    return safeRuntime && localHost && credential === 'local-admin-preview';
  }

  async function startSession({ credential, host }) {
    if (!credential || typeof credential !== 'string') {
      throw new ValidationError('Missing Google credential.');
    }
    if (canUseLocalPreview(host, credential)) {
      return {
        success: true, isReturning: true, sub: 'local-admin-preview',
        name: 'Local Admin Preview', email: 'local-admin@localhost', picture: null,
        tier: 'free', visitCount: 1, firstSeenAt: null, lastSeenAt: null,
        contact: { canSeePhone: false, phone: null, matchedDomain: null },
        subscription: { active: false, status: 'guest', currentPeriodEnd: null, cancelAtPeriodEnd: false },
      };
    }

    const { uid, email, name, picture } = await identity.verifyIdToken(credential);
    let visit = { isReturning: false, visitCount: 1, firstSeenAt: null, lastSeenAt: null, tier: 'free' };
    try {
      visit = await users.upsertUserVisit({ uid, email, name, picture });
    } catch (error) {
      logger.error('[session] Firestore upsert failed (continuing without persistence):', error.message);
    }

    const timestamp = now();
    Promise.resolve().then(() => salesforce.upsertSiteVisitor({
      uid,
      email,
      name,
      firstSeenAt: visit.isReturning ? null : timestamp,
      lastSeenAt: timestamp,
      visitCount: visit.visitCount,
      transactionId: randomUUID(),
    })).catch((error) => {
      logger.error('[session] Salesforce Site_Visitor upsert failed (non-fatal):', error.message);
    });

    const contact = await contactPolicy.resolveContactViewAsync({ email });
    let subscription = { active: false, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false };
    try {
      subscription = await billing.getUserSubscriptionEntitlement(uid);
    } catch (_) {}

    return {
      success: true,
      isReturning: visit.isReturning,
      sub: uid,
      name: name || '',
      email,
      picture: picture || null,
      tier: String(visit.tier || 'free'),
      visitCount: visit.visitCount,
      firstSeenAt: visit.firstSeenAt == null ? null : Number(visit.firstSeenAt),
      lastSeenAt: visit.lastSeenAt == null ? null : Number(visit.lastSeenAt),
      contact,
      subscription,
    };
  }

  return Object.freeze({ startSession });
}

module.exports = { createSessionService };
