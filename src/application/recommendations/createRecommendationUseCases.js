'use strict';

const { AppError, ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createRecommendationUseCases(dependencies) {
  assertDependencies(dependencies, 'application.recommendations', {
    repository: ['listActiveRecommendations', 'upsertRecommendation', 'deleteRecommendation', 'writeRecommendationReply'],
    salesforce: ['upsertRecommendation', 'deleteRecommendation'],
    identity: ['verifyIdToken'],
    randomUUID: 'function',
    secureCompare: 'function',
    nowIso: 'function',
    logger: 'value',
    callbackSecret: 'value',
  });
  const {
    repository, salesforce, identity, randomUUID, secureCompare,
    nowIso, logger, callbackSecret,
  } = dependencies;

  async function list() {
    try {
      return { success: true, recommendations: await repository.listActiveRecommendations() };
    } catch (error) {
      logger.error('[recommendations] Firestore read failed (returning empty list):', error.message);
      return { success: true, recommendations: [], degraded: true };
    }
  }

  async function submit({ token, text }) {
    if (!token) throw new AppError('Sign in with Google to leave a recommendation.', 401, 'UNAUTHORIZED');
    const { uid, email, name, picture } = await identity.verifyIdToken(token);
    const domain = email.split('@')[1] || '';
    const company = domain.replace(/\.[a-z]{2,}$/i, '').replace(/^./, (character) => character.toUpperCase());
    const transactionId = randomUUID();
    const normalizedText = String(text || '').trim();
    const firestore = await repository.upsertRecommendation({
      uid, email, emailVerified: true, hostedDomain: domain,
      name, company, avatarUrl: picture, text: normalizedText,
    });
    let salesforceResult = { skipped: true, id: null };
    try {
      salesforceResult = await salesforce.upsertRecommendation({
        googleUid: uid, name, email, company, avatarUrl: picture, text: normalizedText,
      }, { transactionId });
    } catch (error) {
      logger.error(`[recommendation] SF upsert FAILED after retries (uid=${uid} txId=${transactionId}): ${error.message}`);
    }
    return {
      statusCode: firestore.isNew ? 201 : 200,
      body: {
        success: true,
        isNew: firestore.isNew,
        uid,
        salesforceId: salesforceResult.id,
        salesforceSynced: !salesforceResult.skipped && !!salesforceResult.id,
        transactionId,
        message: firestore.isNew
          ? "Thanks for the recommendation — it's on the page now."
          : 'Updated — your latest recommendation replaces the previous version.',
      },
    };
  }

  async function remove({ token }) {
    if (!token) throw new AppError('Sign in with Google to delete your recommendation.', 401, 'UNAUTHORIZED');
    const { uid } = await identity.verifyIdToken(token);
    const transactionId = randomUUID();
    const firestore = await repository.deleteRecommendation(uid);
    let salesforceResult = { skipped: true, deleted: false };
    try {
      salesforceResult = await salesforce.deleteRecommendation({ googleUid: uid }, { transactionId });
    } catch (error) {
      logger.error(`[recommendation] SF soft-delete FAILED after retries (uid=${uid} txId=${transactionId}): ${error.message}`);
    }
    return {
      success: true,
      uid,
      firestoreDeleted: firestore.deleted,
      salesforceSynced: !salesforceResult.skipped && !!salesforceResult.deleted,
      transactionId,
      message: firestore.deleted
        ? 'Your recommendation has been removed.'
        : "There was nothing to delete — you didn't have an active recommendation.",
    };
  }

  async function applyReply({ apiKey, uid, reply, repliedAt }) {
    if (!callbackSecret) {
      throw new AppError('Salesforce callback is not configured on this environment.', 503, 'SF_CALLBACK_NOT_CONFIGURED');
    }
    if (!secureCompare(String(apiKey || '').trim(), callbackSecret)) {
      throw new AppError('Invalid callback signature.', 401, 'UNAUTHORIZED');
    }
    const normalizedUid = String(uid || '').trim();
    const normalizedReply = String(reply || '').trim();
    if (!normalizedUid) throw new ValidationError('uid path param is required.');
    if (!normalizedReply) throw new ValidationError('reply body field is required.');
    if (normalizedReply.length > 1000) {
      throw new ValidationError('reply must be 1000 characters or fewer.');
    }
    const result = await repository.writeRecommendationReply(normalizedUid, {
      reply: normalizedReply,
      repliedAt: repliedAt || nowIso(),
    });
    if (!result.applied) {
      return {
        statusCode: 409,
        body: {
          success: false,
          code: 'RECOMMENDATION_NOT_FOUND',
          error: `No recommendation found for uid=${normalizedUid}; SF should retry.`,
        },
      };
    }
    return { statusCode: 200, body: { success: true, uid: normalizedUid } };
  }

  return Object.freeze({ list, submit, remove, applyReply });
}

module.exports = { createRecommendationUseCases };
