'use strict';

const { ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createInquiryUseCases(dependencies) {
  assertDependencies(dependencies, 'application.inquiries', {
    salesforce: ['createInquiry', 'upsertQuestion', 'isConfigured'],
    randomUUID: 'function',
    logger: 'value',
  });
  const { salesforce, randomUUID, logger } = dependencies;

  async function submitHire(input) {
    const { name, email, company, description, role, contractType, urgency, slot } = input;
    const guided = [
      role && `Role: ${role}`,
      contractType && `Type: ${contractType}`,
      urgency && `Urgency: ${urgency}`,
      slot && `Requested slot: ${slot}`,
    ].filter(Boolean).join('\n');
    const notes = [description, guided].filter(Boolean).join('\n\n—\n').slice(0, 255);
    let recordId = null;
    let alreadySubmitted = false;
    if (salesforce.isConfigured()) {
      const result = await salesforce.createInquiry(
        { name, email, company, notes },
        { transactionId: randomUUID() }
      );
      recordId = result.id;
      alreadySubmitted = !!result.duplicate;
    } else {
      logger.log('[hire] Salesforce not configured — logging inquiry:', { name, email, company, notes });
    }
    return {
      success: true,
      alreadySubmitted,
      message: alreadySubmitted
        ? "Looks like you've already reached out — thanks! I'll get back to you within 1–2 business days."
        : 'Inquiry submitted successfully.',
      recordId,
    };
  }

  async function submitQuestion(input, idempotencyHeader) {
    const headerKey = String(idempotencyHeader || '').trim();
    const bodyKey = String(input.gcpQuestionId || '').trim();
    if (headerKey && bodyKey && headerKey !== bodyKey) {
      throw new ValidationError('Idempotency-Key header and gcpQuestionId body must match if both are provided.');
    }
    let gcpQuestionId = headerKey || bodyKey;
    if (gcpQuestionId && !UUID_RE.test(gcpQuestionId)) {
      throw new ValidationError('Idempotency-Key must be a UUID v1–v5.');
    }
    if (!gcpQuestionId) gcpQuestionId = randomUUID();
    const transactionId = randomUUID();
    let result;
    if (salesforce.isConfigured()) {
      result = await salesforce.upsertQuestion({
        gcpQuestionId,
        name: input.name,
        email: input.email,
        company: input.company,
        question: input.question,
      }, { transactionId });
    } else {
      logger.log('[question] Salesforce not configured — logging question:', {
        gcpQuestionId,
        email: input.email,
        transactionId,
      });
      result = {
        skipped: true,
        id: null,
        gcpQuestionId,
        created: true,
        status: 'New',
        answer: null,
      };
    }
    return {
      statusCode: result.created ? 201 : 200,
      body: {
        success: true,
        idempotent: !result.created && !result.skipped,
        gcpQuestionId: result.gcpQuestionId,
        questionId: result.id,
        status: result.status || 'New',
        answer: result.answer || null,
        transactionId,
        message: result.created
          ? "Got it — your question is in. I'll respond by email within a couple of business days."
          : 'Updated — your latest question replaces the previous version.',
      },
    };
  }

  return Object.freeze({ submitHire, submitQuestion });
}

module.exports = { createInquiryUseCases, UUID_RE };
