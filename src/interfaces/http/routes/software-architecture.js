'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { ValidationError } = require('../../../domain/errors');
const { assertDependencies } = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.softwareArchitecture', {
    requireAuth: 'function',
    optionalAuth: 'function',
    requireAdmin: 'function',
    requireAdminAccess: 'function',
    software: [
      'getTierConfig', 'getSeoConfig', 'saveSeoConfig', 'getComponentRegistry',
      'saveComponentRegistry', 'saveTierConfig', 'listPublished', 'getPublished',
      'listAdminArticles', 'adminIdentity', 'localPreview', 'getContactPolicy',
      'saveContactPolicy', 'writingAssist', 'saveArticle', 'activeSponsors',
      'allSponsors', 'saveSponsor', 'deleteSponsor', 'systemHealth', 'atlasConfig',
      'saveAtlasObservability', 'saveAtlasConfig', 'goldenDataset', 'resetGoldenDataset',
      'saveGoldenDataset', 'runEvaluation', 'reindex', 'evaluationHistory', 'deleteEvaluation',
    ],
  });
  const { requireAuth, optionalAuth, requireAdmin, requireAdminAccess, software } = dependencies;
  const router = express.Router();
  const BODY_MAX_LEN = 60000;
  const validateArticle = [
    body('id').trim().matches(/^[a-z0-9-]{3,80}$/).withMessage('Slug must use lowercase letters, numbers, and hyphens.'),
    body('contentType').optional().trim().isIn(['system-design', 'architecture', 'case-study']).withMessage('contentType must be system-design, architecture, or case-study.'),
    body('icon').optional().trim().isLength({ max: 40 }),
    body('status').optional().trim().isIn(['Draft', 'Published', 'Retired', 'Coming soon']).withMessage('Status must be Draft, Published, Retired, or Coming soon.'),
    body('tags').optional().isArray({ max: 12 }).withMessage('Tags must be an array.'),
    body('readMinutes').optional({ nullable: true }).isInt({ min: 0, max: 60 }).withMessage('Read time must be between 0 and 60 minutes.'),
    body('order').optional().isInt({ min: 1, max: 9999 }).withMessage('Order must be a positive number.'),
    body('blocks').optional().isArray({ max: 200 }).withMessage('Blocks must be an array.'),
    body('en.title').trim().isLength({ min: 3, max: 140 }).withMessage('English title is required.'),
    body('en.subtitle').optional().trim().isLength({ max: 240 }),
    body('en.body').optional({ checkFalsy: false }).trim().isLength({ max: BODY_MAX_LEN }),
    body('fr.title').optional().trim().isLength({ max: 140 }),
    body('fr.subtitle').optional().trim().isLength({ max: 240 }),
    body('fr.body').optional().trim().isLength({ max: BODY_MAX_LEN }),
  ];
  const validateWritingAssist = [
    body('articleTitle').optional().trim().isLength({ max: 140 }),
    body('articleSubtitle').optional().trim().isLength({ max: 240 }),
    body('sectionType').trim().isLength({ min: 2, max: 60 }).withMessage('Section type is required.'),
    body('sectionLabel').optional().trim().isLength({ max: 80 }),
    body('sectionBody').trim().isLength({ min: 1, max: 8000 }).withMessage('Section body is required.'),
    body('mode').optional().trim().isIn(['improve', 'concise', 'grammar']).withMessage('Writing mode is invalid.'),
  ];
  const validateAtlasConfig = [
    body('enabledModels').isArray({ min: 1 }).withMessage('enabledModels must be a non-empty array.'),
    body('enabledModels.*').isString().notEmpty(),
    body('defaultModel').isString().notEmpty().withMessage('defaultModel is required.'),
    body('modelSelectorVisible').isBoolean().withMessage('modelSelectorVisible must be a boolean.'),
    body('modelOptions').optional().isObject().withMessage('modelOptions must be an object.'),
    body('temperature').optional().isFloat({ min: 0, max: 2 }),
    body('topP').optional().isFloat({ min: 0, max: 1 }),
    body('maxOutputTokens').optional().isInt({ min: 100, max: 8192 }),
    body('streamingEnabled').optional().isBoolean(),
    body('embeddingBatchSize').optional().isInt({ min: 1, max: 50 }),
    body('chunkSize').optional().isInt({ min: 500, max: 8000 }),
    body('chunkOverlap').optional().isInt({ min: 0, max: 1000 }),
    body('splitterType').optional().isIn(['recursive', 'markdown']),
    body('ragEnabled').optional().isBoolean(),
    body('ragTopK').optional().isInt({ min: 1, max: 20 }),
    body('hybridSearchEnabled').optional().isBoolean(),
    body('rerankerEnabled').optional().isBoolean(),
    body('similarityThreshold').optional().isFloat({ min: 0, max: 1 }),
    body('keywordSearchProvider').optional().isIn(['none', 'meilisearch']),
    body('fusionStrategy').optional().isIn(['rrf']),
    body('rrfK').optional().isInt({ min: 1, max: 200 }),
    body('rerankerProvider').optional().isIn(['none', 'cohere']),
    body('rerankerModel').optional().isString().isLength({ min: 1, max: 60 }),
    body('rerankerTopN').optional().isInt({ min: 5, max: 100 }),
    body('guardrailsEnabled').optional().isBoolean(),
    body('conversationMemoryTurns').optional().isInt({ min: 0, max: 20 }),
    body('executionMode').optional().isIn(['pure-model', 'single-agent', 'multiagent']),
    body('routingStrategy').optional().isIn(['default', 'rule-based', 'classifier']),
    body('recallThreshold').optional().isFloat({ min: 0, max: 1 }),
    body('faithfulnessThreshold').optional().isFloat({ min: 0, max: 1 }),
    body('tracingEnabled').optional().isBoolean(),
    body('langsmithTracingEnabled').optional().isBoolean(),
    body('capturePrompts').optional().isBoolean(),
    body('captureChunks').optional().isBoolean(),
    body('captureTokens').optional().isBoolean(),
    body('budgetCapInr').optional().isFloat({ min: 0 }),
    body('dailyBudgetCapInr').optional().isFloat({ min: 0 }),
    body('tokenLimitPerQuery').optional().isInt({ min: 100, max: 8192 }),
    body('budgetAlertThreshold').optional().isFloat({ min: 0, max: 1 }),
    body('piiRedactionEnabled').optional().isBoolean(),
    body('promptInjectionDetection').optional().isBoolean(),
    body('rateLimitPerMinute').optional().isInt({ min: 1, max: 600 }),
    body('contentModerationEnabled').optional().isBoolean(),
  ];

  function invalid(req, res) {
    const errors = validationResult(req);
    if (errors.isEmpty()) return false;
    res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
    return true;
  }
  function assertValid(req) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(
        errors.array()[0].msg,
        errors.array().map((error) => ({ field: error.path, message: error.msg }))
      );
    }
  }
  const cache = (_req, res, next) => {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    next();
  };

  router.get('/system-design/tier-config', cache, async (_req, res) => res.status(200).json(await software.getTierConfig()));
  router.get('/system-design/seo-config', cache, async (_req, res) => res.status(200).json(await software.getSeoConfig()));
  router.put('/admin/system-design/seo-config', requireAdmin, [
    body('siteUrl').isURL({ require_protocol: true }).withMessage('siteUrl must be a valid URL.'),
    body('siteDescription').isString().notEmpty().withMessage('siteDescription is required.'),
    body('adsensePublisherId').optional({ checkFalsy: true }).matches(/^ca-pub-\d+$/).withMessage('AdSense Publisher ID must match ca-pub-XXXXXXXXXX.'),
    ...['jsonLdEnabled', 'sitemapEnabled', 'robotsNoindex', 'hreflangFrEnabled', 'llmsTxtEnabled', 'aiCrawlersAllowed', 'eeatSignalsEnabled']
      .map((field) => body(field).isBoolean().withMessage(`${field} must be a boolean.`)),
  ], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveSeoConfig(req.body)); } catch (error) { next(error); }
  });
  router.get('/system-design/component-registry', cache, async (_req, res) => res.status(200).json(await software.getComponentRegistry()));
  router.put('/admin/system-design/component-registry', requireAdmin, [body('enabled').isObject().withMessage('enabled must be an object.')], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveComponentRegistry(req.body.enabled)); } catch (error) { next(error); }
  });
  router.put('/admin/system-design/tier-config', requireAdmin, [
    body('free.items').isArray().withMessage('free.items must be an array.'),
    body('premium.items').isArray().withMessage('premium.items must be an array.'),
  ], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveTierConfig(req.body)); } catch (error) { next(error); }
  });

  router.get('/system-design/articles', optionalAuth, async (req, res) => {
    const result = await software.listPublished({
      uid: String(req.user?.uid || '').trim(),
      forceLocked: String(req.query.forceLocked || '') === '1',
    });
    res.set('Cache-Control', result.cacheControl);
    return res.status(200).json(result.body);
  });
  router.get('/system-design/articles/:id', optionalAuth, async (req, res) => {
    const result = await software.getPublished({
      id: req.params.id,
      uid: String(req.user?.uid || '').trim(),
      forceLocked: String(req.query.forceLocked || '') === '1',
    });
    if (result.cacheControl) res.set('Cache-Control', result.cacheControl);
    return res.status(result.statusCode).json(result.body);
  });
  router.get('/admin/system-design/articles', requireAdmin, async (_req, res, next) => {
    try { res.status(200).json(await software.listAdminArticles()); } catch (error) { next(error); }
  });
  router.get('/admin/me', requireAuth, (req, res) => res.status(200).json(software.adminIdentity(req.user?.email)));
  router.get('/local-preview', (_req, res) => res.status(200).json(software.localPreview()));
  router.get('/admin/contact-policy', requireAdmin, async (_req, res, next) => {
    try { res.status(200).json(await software.getContactPolicy()); } catch (error) { next(error); }
  });
  router.put('/admin/contact-policy', requireAdmin, async (req, res, next) => {
    try { res.status(200).json(await software.saveContactPolicy(req.body, req.user.email)); } catch (error) { next(error); }
  });
  router.post('/admin/system-design/writing-assist', requireAdmin, validateWritingAssist, async (req, res, next) => {
    try { assertValid(req); res.status(200).json(await software.writingAssist(req.body)); } catch (error) { next(error); }
  });
  router.put('/admin/system-design/articles/:id', requireAdmin, validateArticle, async (req, res, next) => {
    try { assertValid(req); res.status(200).json(await software.saveArticle(req.params.id, req.body, req.user.email)); } catch (error) { next(error); }
  });

  router.get('/sponsorships/active', async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
    return res.status(200).json(await software.activeSponsors(req.query.placement));
  });
  router.get('/admin/sponsorships', requireAdmin, async (_req, res, next) => {
    try { res.status(200).json(await software.allSponsors()); } catch (error) { next(error); }
  });
  router.post('/admin/sponsorships', requireAdmin, [
    body('company').notEmpty().withMessage('Company name is required.'),
    body('headline').notEmpty().withMessage('Headline is required.'),
    body('ctaUrl').notEmpty().withMessage('CTA URL is required.'),
    body('placement').isIn(['homepage', 'homepage-left', 'sticky-corner', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
  ], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(201).json(await software.saveSponsor(null, req.body)); } catch (error) { next(error); }
  });
  router.put('/admin/sponsorships/:id', requireAdmin, [
    body('company').notEmpty().withMessage('Company name is required.'),
    body('placement').isIn(['homepage', 'homepage-left', 'sticky-corner', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
  ], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveSponsor(req.params.id, req.body)); } catch (error) { next(error); }
  });
  router.delete('/admin/sponsorships/:id', requireAdmin, async (req, res, next) => {
    try { res.status(200).json(await software.deleteSponsor(req.params.id)); } catch (error) { next(error); }
  });
  router.get('/admin/system/health', requireAdmin, (_req, res) => res.status(200).json(software.systemHealth()));
  router.get('/admin/atlas/config', requireAdmin, async (_req, res, next) => {
    try { res.status(200).json(await software.atlasConfig()); } catch (error) { next(error); }
  });
  router.put('/admin/atlas/observability', requireAdmin, [
    body('langsmithTracingEnabled').isBoolean().withMessage('langsmithTracingEnabled must be a boolean.'),
  ], async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveAtlasObservability(req.body.langsmithTracingEnabled)); } catch (error) { next(error); }
  });
  router.put('/admin/atlas/config', requireAdmin, validateAtlasConfig, async (req, res, next) => {
    if (invalid(req, res)) return;
    try { res.status(200).json(await software.saveAtlasConfig(req.body)); } catch (error) { next(error); }
  });

  router.get('/admin/atlas/golden-dataset', requireAdminAccess(), async (_req, res) => res.json(await software.goldenDataset()));
  router.delete('/admin/atlas/golden-dataset', requireAdminAccess(), async (_req, res) => res.json(await software.resetGoldenDataset()));
  router.put('/admin/atlas/golden-dataset', requireAdminAccess(), async (req, res) => {
    const result = await software.saveGoldenDataset(req.body?.rows);
    return res.status(result.statusCode).json(result.body);
  });

  function openEventStream(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  router.get('/admin/atlas/rag-eval', requireAdminAccess({ allowQueryToken: true, allowHeaderToken: false }), async (req, res) => {
    const send = openEventStream(res);
    try {
      const result = await software.runEvaluation(
        { kInput: req.query.k, modeInput: req.query.mode },
        (progress) => send('progress', progress)
      );
      send('result', result);
    } catch (error) {
      send('error', { message: error.message || 'Evaluation failed.' });
    } finally {
      send('done', {});
      res.end();
    }
  });
  router.get('/admin/atlas/rag-reindex', requireAdminAccess({ allowQueryToken: true, allowHeaderToken: false }), async (req, res) => {
    const send = openEventStream(res);
    let aborted = false;
    req.on('close', () => { aborted = true; });
    for await (const event of software.reindex(() => aborted)) send(event.event, event.data);
    send('done', {});
    res.end();
  });
  router.get('/admin/atlas/rag-eval/history', requireAdminAccess({ allowQueryToken: true }), async (req, res) => {
    const result = await software.evaluationHistory(req.query.limit);
    res.status(result.statusCode).json(result.body);
  });
  router.delete('/admin/atlas/rag-eval/history/:id', requireAdminAccess({ allowQueryToken: true }), async (req, res) => {
    const result = await software.deleteEvaluation(req.params.id);
    res.status(result.statusCode).json(result.body);
  });

  return router;
}

module.exports = { createRouter };
