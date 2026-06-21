'use strict';

/**
 * System Design content routes.
 *
 * Firestore is used as a lightweight CMS so article edits can be published
 * without rebuilding the Cloud Run image. The frontend keeps checked-in
 * fallback content for local/dev outages or an empty CMS collection.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const config = require('../config');
const firestore = require('../services/firestore');
const contactPolicy = require('../services/contactPolicy');
const { generateChatResponse } = require('../services/gemini');
const { ValidationError } = require('../errors');

const router = express.Router();
const BODY_MAX_LEN = 60000;
const SEED_FILE = path.join(__dirname, '../../content/system-design/articles.seed.json');

function canUseLocalSeedFallback() {
  return config.server.env !== 'production' && !process.env.K_SERVICE;
}

async function loadSeedArticles({ publishedOnly } = {}) {
  const raw = await fs.readFile(SEED_FILE, 'utf8');
  const articles = JSON.parse(raw);
  if (!Array.isArray(articles)) throw new ValidationError('Seed file must contain an article array.');
  return articles
    .filter((article) => {
      if (!publishedOnly) return true;
      const status = String(article.status || 'Published').toLowerCase();
      return status === 'published' || article.stub;
    })
    .sort((a, b) => Number(a.order || 999) - Number(b.order || 999)
      || String(a.en?.title || a.id || '').localeCompare(String(b.en?.title || b.id || '')));
}

async function localSeedFallback(res, { publishedOnly, articleId } = {}) {
  if (!canUseLocalSeedFallback()) return false;
  const articles = await loadSeedArticles({ publishedOnly });
  if (articleId) {
    const article = articles.find((item) => item.id === articleId);
    if (!article) return false;
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, article, source: 'local-seed' });
    return true;
  }
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ success: true, articles, source: 'local-seed' });
  return true;
}

const validateArticle = [
  body('id').trim().matches(/^[a-z0-9-]{3,80}$/).withMessage('Slug must use lowercase letters, numbers, and hyphens.'),
  body('category').trim().isLength({ min: 2, max: 40 }).withMessage('Category is required.'),
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

function localWritingAssist({ sectionBody, mode }) {
  const bodyText = String(sectionBody || '').trim().replace(/\s+/g, ' ');
  if (mode === 'concise') {
    return bodyText.split('. ').slice(0, 2).join('. ') + (bodyText.includes('.') ? '.' : '');
  }
  if (mode === 'grammar') {
    return bodyText
      .replace(/\bwa[mn]\b/gi, 'was')
      .replace(/\bfro\b/gi, 'for')
      .replace(/\s+/g, ' ');
  }
  return [
    bodyText,
    '',
    'This section now reads as a clearer system-design narrative while preserving the original technical decision and risk focus.',
  ].join('\n');
}

function stripSectionHeading(text, sectionLabel) {
  const label = String(sectionLabel || '').trim();
  let value = String(text || '').trim();
  if (!label) return value;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp('^(?:#{1,6}\\s*)?(?:\\*\\*)?' + escaped + '(?:\\*\\*)?\\s*\\n+', 'i');
  value = value.replace(headingPattern, '').trim();
  return value;
}

async function generateWritingAssist(payload) {
  if (config.admin.localPreview) {
    return {
      suggestion: stripSectionHeading(localWritingAssist(payload), payload.sectionLabel),
      usage: null,
      source: 'local-preview',
    };
  }

  const mode = payload.mode || 'improve';
  const modeInstruction = mode === 'concise'
    ? 'Make the section shorter and sharper. Remove repetition. Keep only the strongest points.'
    : mode === 'grammar'
      ? 'Fix grammar, spelling, punctuation, and flow. Do not change the technical meaning or add new content.'
      : 'Improve clarity, structure, and executive readability while keeping it technically accurate.';

  const systemPrompt = [
    'You are an expert system-design editor for an enterprise engineering portfolio.',
    'Rewrite only the provided article section.',
    'Do not include the section heading or article title in the response.',
    'Preserve the author intent and technical facts. Do not invent systems, metrics, vendors, claims, or diagrams.',
    'Return plain Markdown only. No HTML. No preamble. No code fences unless the user provided code.',
    'Prefer crisp sentences, clear bullets where useful, and language suitable for Google, Salesforce, Meta, or Palantir reviewers.',
  ].join(' ');

  const userMessage = [
    'Article title: ' + (payload.articleTitle || 'Untitled article'),
    'Article subtitle: ' + (payload.articleSubtitle || 'No subtitle'),
    'Section: ' + (payload.sectionLabel || payload.sectionType),
    '',
    'Current section draft:',
    payload.sectionBody,
    '',
    modeInstruction,
  ].join('\n');

  const result = await generateChatResponse({
    model: 'flash-lite',
    systemPrompt,
    userMessage,
    generationConfig: { temperature: 0.35, topP: 0.85, maxOutputTokens: 900 },
  });
  return { suggestion: stripSectionHeading(result.text, payload.sectionLabel), usage: result.usage, source: 'gemini' };
}

function validateDomains(domains) {
  if (!Array.isArray(domains)) throw new ValidationError('Domains must be an array.');
  const clean = contactPolicy.normaliseDomains(domains);
  if (clean.length > 50) throw new ValidationError('Domain lists cannot exceed 50 entries.');
  for (const domain of clean) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes('..')) {
      throw new ValidationError('Domains must be valid domain names.');
    }
  }
  return Array.from(new Set(clean));
}

function validateEmails(emails) {
  if (!Array.isArray(emails)) throw new ValidationError('Allowed emails must be an array.');
  const clean = contactPolicy.normaliseEmails(emails);
  if (clean.length > 50) throw new ValidationError('Allowed email list cannot exceed 50 entries.');
  for (const email of clean) {
    if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      throw new ValidationError('Allowed emails must be valid email addresses.');
    }
  }
  return Array.from(new Set(clean));
}

// ── Tier config (public read, admin write) ────────────────────────────────────
router.get('/system-design/tier-config', async (_req, res) => {
  try {
    const config = await firestore.getTierConfig();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, config });
  } catch (err) {
    console.warn('[tier-config] Firestore read failed:', err.message);
    return res.status(200).json({ success: true, config: { free: { items: [] }, premium: { items: [] } } });
  }
});

// ── Component registry (public read, admin write) ─────────────────────────────
router.get('/system-design/component-registry', async (_req, res) => {
  try {
    const enabled = await firestore.getComponentRegistry();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, enabled });
  } catch (err) {
    console.warn('[component-registry] Firestore read failed:', err.message);
    return res.status(200).json({ success: true, enabled: {} });
  }
});

router.put('/admin/system-design/component-registry', requireAdmin, [
  body('enabled').isObject().withMessage('enabled must be an object.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    await firestore.upsertComponentRegistry(req.body.enabled);
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put('/admin/system-design/tier-config', requireAdmin, [
  body('free.items').isArray().withMessage('free.items must be an array.'),
  body('premium.items').isArray().withMessage('premium.items must be an array.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    await firestore.upsertTierConfig(req.body);
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get('/system-design/articles', async (_req, res) => {
  try {
    if (await localSeedFallback(res, { publishedOnly: true })) return;
    const articles = await firestore.listPublishedSystemDesignArticles();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, articles });
  } catch (err) {
    console.warn('[system-design] Firestore list failed:', err.message);
    return res.status(200).json({ success: true, articles: [], degraded: true });
  }
});

router.get('/system-design/articles/:id', async (req, res) => {
  try {
    if (await localSeedFallback(res, { publishedOnly: true, articleId: req.params.id })) return;
    const article = await firestore.getSystemDesignArticle(req.params.id);
    if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, article });
  } catch (err) {
    console.warn('[system-design] Firestore read failed:', err.message);
    return res.status(503).json({ success: false, error: 'System Design content is unavailable.' });
  }
});

router.get('/admin/system-design/articles', requireAdmin, async (_req, res, next) => {
  try {
    if (await localSeedFallback(res)) return;
    const articles = await firestore.listSystemDesignArticles();
    return res.status(200).json({ success: true, articles });
  } catch (err) {
    return next(err);
  }
});

router.get('/admin/me', requireAuth, async (req, res) => {
  const email = String(req.user?.email || '').toLowerCase();
  return res.status(200).json({
    success: true,
    isAdmin: config.admin.allowedEmails.includes(email),
  });
});

router.get('/local-preview', (_req, res) => {
  return res.status(200).json({
    success: true,
    enabled: config.admin.localPreview,
  });
});

router.get('/admin/contact-policy', requireAdmin, async (_req, res, next) => {
  try {
    const policy = await contactPolicy.getContactPolicyConfig();
    return res.status(200).json({ success: true, policy });
  } catch (err) {
    return next(err);
  }
});

router.put('/admin/contact-policy', requireAdmin, async (req, res, next) => {
  try {
    const allowedDomains = validateDomains(req.body?.allowedDomains || []);
    const personalDomains = validateDomains(req.body?.personalDomains || []);
    const allowedEmails = validateEmails(req.body?.allowedEmails || []);
    const blockedDomains = validateDomains(req.body?.blockedDomains || []);
    if (canUseLocalSeedFallback()) {
      return res.status(200).json({
        success: true,
        policy: {
          source: 'local-dev',
          allowedDomains,
          personalDomains,
          allowedEmails,
          blockedDomains,
          updatedBy: req.user.email,
          updatedAt: Date.now(),
          privatePhoneConfigured: !!config.contactPolicy.privatePhone,
        },
      });
    }
    const saved = await firestore.upsertContactPolicyConfig({
      allowedDomains,
      personalDomains,
      allowedEmails,
      blockedDomains,
      updatedBy: req.user.email,
    });
    return res.status(200).json({
      success: true,
      policy: {
        source: 'firestore',
        allowedDomains: saved.allowedDomains,
        personalDomains: saved.personalDomains,
        allowedEmails: saved.allowedEmails,
        blockedDomains: saved.blockedDomains,
        updatedBy: saved.updatedBy,
        updatedAt: saved.updatedAt,
        privatePhoneConfigured: !!config.contactPolicy.privatePhone,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/system-design/writing-assist', requireAdmin, validateWritingAssist, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(
        errors.array()[0].msg,
        errors.array().map((e) => ({ field: e.path, message: e.msg }))
      );
    }

    const result = await generateWritingAssist({
      articleTitle:    req.body.articleTitle,
      articleSubtitle: req.body.articleSubtitle,
      sectionType:     req.body.sectionType,
      sectionLabel:    req.body.sectionLabel,
      sectionBody:     req.body.sectionBody,
      mode:            req.body.mode || 'improve',
    });

    return res.status(200).json({
      success: true,
      suggestion: result.suggestion,
      usage: result.usage,
      source: result.source,
    });
  } catch (err) {
    return next(err);
  }
});

router.put('/admin/system-design/articles/:id', requireAdmin, validateArticle, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(
        errors.array()[0].msg,
        errors.array().map((e) => ({ field: e.path, message: e.msg }))
      );
    }

    const previousId = String(req.params.id || '').trim();
    const article = Object.assign({}, req.body, { id: String(req.body.id || previousId).trim() });
    if (config.admin.localPreview) {
      return res.status(200).json({
        success: true,
        article: Object.assign({}, article, {
          updatedAt: Date.now(),
          updatedBy: req.user.email,
        }),
        version: 'local-preview',
        source: 'local-preview',
      });
    }

    const result = await firestore.upsertSystemDesignArticle(article, {
      publishedBy: req.user.email,
    });
    if (previousId && previousId !== result.id) {
      await firestore.deleteSystemDesignArticle(previousId);
    }
    const saved = await firestore.getSystemDesignArticle(result.id);
    return res.status(200).json({ success: true, article: saved, version: result.version });
  } catch (err) {
    return next(err);
  }
});

router.post('/admin/system-design/seed', requireAdmin, async (req, res, next) => {
  try {
    const raw = await fs.readFile(SEED_FILE, 'utf8');
    const articles = JSON.parse(raw);
    if (!Array.isArray(articles)) throw new ValidationError('Seed file must contain an article array.');

    if (config.admin.localPreview) {
      return res.status(200).json({
        success: true,
        imported: articles.length,
        results: articles.map((article) => ({ id: article.id, version: 'local-preview' })),
        source: 'local-preview',
      });
    }

    const results = [];
    for (const article of articles) {
      results.push(await firestore.upsertSystemDesignArticle(article, {
        publishedBy: req.user.email,
      }));
    }

    return res.status(200).json({ success: true, imported: results.length, results });
  } catch (err) {
    return next(err);
  }
});

// ── Sponsorship routes ────────────────────────────────────────────────────────

// Public: get active sponsors for a placement (used by public page)
router.get('/sponsorships/active', async (req, res) => {
  try {
    const placement = req.query.placement || null;
    const sponsors = await firestore.listActiveSponsorships(placement);
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
    return res.status(200).json({ success: true, sponsors });
  } catch (err) {
    console.warn('[sponsorships] list active failed:', err.message);
    return res.status(200).json({ success: true, sponsors: [] });
  }
});

// Admin: list all sponsors
router.get('/admin/sponsorships', requireAdmin, async (_req, res, next) => {
  try {
    const sponsors = await firestore.listSponsorships();
    return res.status(200).json({ success: true, sponsors });
  } catch (err) { next(err); }
});

// Admin: create sponsor
router.post('/admin/sponsorships', requireAdmin, [
  body('company').notEmpty().withMessage('Company name is required.'),
  body('headline').notEmpty().withMessage('Headline is required.'),
  body('ctaUrl').notEmpty().withMessage('CTA URL is required.'),
  body('placement').isIn(['homepage', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    const sponsor = await firestore.upsertSponsorship(null, req.body);
    return res.status(201).json({ success: true, sponsor });
  } catch (err) { next(err); }
});

// Admin: update sponsor
router.put('/admin/sponsorships/:id', requireAdmin, [
  body('company').notEmpty().withMessage('Company name is required.'),
  body('placement').isIn(['homepage', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    const sponsor = await firestore.upsertSponsorship(req.params.id, req.body);
    return res.status(200).json({ success: true, sponsor });
  } catch (err) { next(err); }
});

// Admin: delete sponsor
router.delete('/admin/sponsorships/:id', requireAdmin, async (req, res, next) => {
  try {
    await firestore.deleteSponsorship(req.params.id);
    return res.status(200).json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
