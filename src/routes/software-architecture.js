'use strict';

/**
 * Software Architecture content routes.
 *
 * Firestore is used as a lightweight CMS so article edits can be published
 * without rebuilding the Cloud Run image. The frontend keeps checked-in
 * fallback content for local/dev outages or an empty CMS collection.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth, optionalAuth, requireAdmin } = require('../middleware/auth');
const config = require('../config');
const firestore = require('../services/firestore');
const adminConfig = require('../services/adminConfig');
const billing = require('../services/billing');
const contactPolicy = require('../services/contactPolicy');
const sponsorships = require('../services/sponsorships');
const localPreviewContent = require('../services/localPreviewContent');
const { indexArticle, removeArticleChunks } = require('../services/rag');
const { evaluateRetrieval }                 = require('../services/rag/evaluate');
const { GOLDEN_SET }                        = require('../services/rag/goldenSet');
const googleAuth                            = require('../services/googleAuth');
const { generateChatResponse }              = require('../services/gemini');
const { ValidationError } = require('../errors');

const router = express.Router();
const BODY_MAX_LEN = 60000;

/**
 * Fire-and-forget RAG indexing after an article save.
 *
 * Rules:
 *   Published  → index (create / refresh chunks)
 *   Everything else (Draft, Retired, Coming soon) → remove chunks
 *
 * Never blocks the HTTP response. Failures are logged and swallowed so a
 * Gemini embedding outage never prevents an admin from saving an article.
 */
function triggerRagIndexing(article) {
  if (!article || !article.id) return;
  const isPublished = String(article.status || '').toLowerCase() === 'published';
  if (isPublished) {
    indexArticle(article).catch((err) =>
      console.warn('[rag] background indexArticle failed:', article.id, err.message)
    );
  } else {
    removeArticleChunks(article.id).catch((err) =>
      console.warn('[rag] background removeArticleChunks failed:', article.id, err.message)
    );
  }
}

function isLocalDev() {
  return config.server.env !== 'production' && !process.env.K_SERVICE;
}

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

function validatePrivatePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 40) throw new ValidationError('Private phone is too long.');
  // Allow common formatting chars: + digits spaces hyphens parentheses
  if (!/^[+\d\s().-]+$/.test(raw)) throw new ValidationError('Private phone contains invalid characters.');
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 8) throw new ValidationError('Private phone must contain at least 8 digits.');
  return raw;
}

function looksConfiguredPhone(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/[xX]/.test(v)) return false;
  return v.replace(/[^\d]/g, '').length >= 8;
}

// ── Tier config (public read, admin write) ────────────────────────────────────
router.get('/system-design/tier-config', async (_req, res) => {
  try {
    const config = await adminConfig.getTierConfig();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, config });
  } catch (err) {
    console.warn('[tier-config] Firestore read failed:', err.message);
    return res.status(200).json({ success: true, config: { free: { items: [] }, premium: { items: [] } } });
  }
});

// ── SEO / AEO configuration (public read, admin write) ────────────────────────
router.get('/system-design/seo-config', async (_req, res) => {
  try {
    const config = await adminConfig.getSeoConfig();
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, config });
  } catch (err) {
    console.warn('[seo-config] Firestore read failed:', err.message);
    return res.status(200).json({ success: true, config: {} });
  }
});

router.put('/admin/system-design/seo-config', requireAdmin, [
  body('siteUrl').isURL({ require_protocol: true }).withMessage('siteUrl must be a valid URL.'),
  body('siteDescription').isString().notEmpty().withMessage('siteDescription is required.'),
  body('adsensePublisherId').optional({ checkFalsy: true })
    .matches(/^ca-pub-\d+$/).withMessage('AdSense Publisher ID must match ca-pub-XXXXXXXXXX.'),
  body('jsonLdEnabled').isBoolean().withMessage('jsonLdEnabled must be a boolean.'),
  body('sitemapEnabled').isBoolean().withMessage('sitemapEnabled must be a boolean.'),
  body('robotsNoindex').isBoolean().withMessage('robotsNoindex must be a boolean.'),
  body('hreflangFrEnabled').isBoolean().withMessage('hreflangFrEnabled must be a boolean.'),
  body('llmsTxtEnabled').isBoolean().withMessage('llmsTxtEnabled must be a boolean.'),
  body('aiCrawlersAllowed').isBoolean().withMessage('aiCrawlersAllowed must be a boolean.'),
  body('eeatSignalsEnabled').isBoolean().withMessage('eeatSignalsEnabled must be a boolean.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    await adminConfig.upsertSeoConfig(req.body);
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Component registry (public read, admin write) ─────────────────────────────
router.get('/system-design/component-registry', async (_req, res) => {
  try {
    const enabled = await adminConfig.getComponentRegistry();
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
    await adminConfig.upsertComponentRegistry(req.body.enabled);
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
    await adminConfig.upsertTierConfig(req.body);
    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

function sanitisePremiumArticle(article) {
  if (!article || typeof article !== 'object') return article;
  const a = Object.assign({}, article);
  // Remove any content-bearing fields.
  a.blocks = [];
  if (a.en && typeof a.en === 'object') a.en = Object.assign({}, a.en, { body: '' });
  if (a.fr && typeof a.fr === 'object') a.fr = Object.assign({}, a.fr, { body: '' });
  if (Object.prototype.hasOwnProperty.call(a, 'bodyHtml')) a.bodyHtml = '';
  return a;
}

router.get('/system-design/articles', optionalAuth, async (req, res) => {
  try {
    const forceLocked = config.admin.localPreview && String(req.query.forceLocked || '') === '1';
    const uid = String(req.user?.uid || '').trim();
    const entitlement = uid ? await billing.getUserSubscriptionEntitlement(uid) : { active: false };
    const canAccessPremium = forceLocked ? false : (config.admin.localPreview ? true : !!entitlement.active);

    const articles = await firestore.listPublishedSystemDesignArticles();
    const safe = (Array.isArray(articles) ? articles : []).map(function (a) {
      const tier = String(a?.tier || '').trim().toLowerCase();
      const premium = tier === 'premium';
      const hasAccess = !premium || canAccessPremium;
      const out = hasAccess ? a : sanitisePremiumArticle(a);
      return Object.assign({}, out, { hasAccess });
    });
    // User-specific access flags must not be served from a shared CDN cache.
    if (uid) {
      res.set('Cache-Control', 'private, no-store');
    } else {
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    }
    return res.status(200).json({ success: true, articles: safe });
  } catch (err) {
    console.warn('[system-design] Firestore list failed:', err.message);
    if (config.admin.localPreview) {
      const forceLocked = String(req.query.forceLocked || '') === '1';
      const canAccessPremium = true;
      const articles = localPreviewContent.getLocalPreviewArticles();
      const safe = articles.map(function (a) {
        const tier = String(a?.tier || '').trim().toLowerCase();
        const premium = tier === 'premium';
        const hasAccess = forceLocked ? false : (!premium || canAccessPremium);
        const out = hasAccess ? a : sanitisePremiumArticle(a);
        return Object.assign({}, out, { hasAccess });
      });
      return res.status(200).json({
        success: true,
        articles: safe,
        degraded: true,
        degradedReason: 'FIRESTORE_NOT_CONFIGURED',
      });
    }
    return res.status(200).json({ success: true, articles: [], degraded: true });
  }
});

router.get('/system-design/articles/:id', optionalAuth, async (req, res) => {
  try {
    const article = await firestore.getSystemDesignArticle(req.params.id);
    if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
    const tier = String(article?.tier || '').trim().toLowerCase();
    const premium = tier === 'premium';
    if (premium) {
      const forceLocked = config.admin.localPreview && String(req.query.forceLocked || '') === '1';
      const uid = String(req.user?.uid || '').trim();
      const entitlement = uid ? await billing.getUserSubscriptionEntitlement(uid) : { active: false };
      const hasAccess = forceLocked ? false : (config.admin.localPreview ? true : !!entitlement.active);
      const out = hasAccess ? article : sanitisePremiumArticle(article);
      // User-specific access must not be shared across CDN cache keys.
      res.set('Cache-Control', uid ? 'private, no-store' : 'public, max-age=60, s-maxage=300');
      return res.status(200).json({ success: true, article: Object.assign({}, out, { hasAccess }) });
    }
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json({ success: true, article });
  } catch (err) {
    console.warn('[system-design] Firestore read failed:', err.message);
    if (config.admin.localPreview) {
      const article = localPreviewContent.getLocalPreviewArticle(req.params.id);
      if (!article) return res.status(404).json({ success: false, error: 'Article not found.' });
      const tier = String(article?.tier || '').trim().toLowerCase();
      const premium = tier === 'premium';
      if (premium) {
        const forceLocked = String(req.query.forceLocked || '') === '1';
        const hasAccess = forceLocked ? false : true;
        const out = hasAccess ? article : sanitisePremiumArticle(article);
        return res.status(200).json({ success: true, article: Object.assign({}, out, { hasAccess }), degraded: true });
      }
      return res.status(200).json({ success: true, article, degraded: true });
    }
    return res.status(503).json({ success: false, error: 'System Design content is unavailable.' });
  }
});

router.get('/admin/system-design/articles', requireAdmin, async (_req, res, next) => {
  try {
    const articles = await firestore.listSystemDesignArticles();
    return res.status(200).json({ success: true, articles });
  } catch (err) {
    // Local preview mode is used to iterate on UX without requiring live GCP
    // credentials. If Firestore isn't configured locally, degrade gracefully
    // so the admin UI still loads.
    if (config.admin.localPreview) {
      console.warn('[admin] Firestore unavailable in local preview:', err.message);
      return res.status(200).json({
        success: true,
        articles: [],
        degraded: true,
        degradedReason: 'FIRESTORE_NOT_CONFIGURED',
      });
    }
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
    const privatePhone = validatePrivatePhone(req.body?.privatePhone || '');
    const allowedDomains = validateDomains(req.body?.allowedDomains || []);
    const personalDomains = validateDomains(req.body?.personalDomains || []);
    const allowedEmails = validateEmails(req.body?.allowedEmails || []);
    const blockedDomains = validateDomains(req.body?.blockedDomains || []);
    if (isLocalDev()) {
      return res.status(200).json({
        success: true,
        policy: {
          source: 'local-dev',
          privatePhone,
          allowedDomains,
          personalDomains,
          allowedEmails,
          blockedDomains,
          updatedBy: req.user.email,
          updatedAt: Date.now(),
          privatePhoneConfigured: looksConfiguredPhone(privatePhone || config.contactPolicy.privatePhone),
        },
      });
    }
    const saved = await adminConfig.upsertContactPolicyConfig({
      privatePhone,
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
        privatePhone: saved.privatePhone || '',
        allowedDomains: saved.allowedDomains,
        personalDomains: saved.personalDomains,
        allowedEmails: saved.allowedEmails,
        blockedDomains: saved.blockedDomains,
        updatedBy: saved.updatedBy,
        updatedAt: saved.updatedAt,
        privatePhoneConfigured: looksConfiguredPhone(saved.privatePhone || config.contactPolicy.privatePhone),
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
    if (!article.contentType) article.contentType = 'system-design';
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
      // Old article ID is gone — remove its orphan chunks too.
      removeArticleChunks(previousId).catch((err) =>
        console.warn('[rag] removeArticleChunks (id-change) failed:', previousId, err.message)
      );
    }
    const saved = await firestore.getSystemDesignArticle(result.id);
    // Index or de-index in the background — never blocks the save response.
    triggerRagIndexing(saved);
    return res.status(200).json({ success: true, article: saved, version: result.version });
  } catch (err) {
    return next(err);
  }
});

// ── Sponsorship routes ────────────────────────────────────────────────────────

// Public: get active sponsors for a placement (used by public page)
router.get('/sponsorships/active', async (req, res) => {
  try {
    const placement = req.query.placement || null;
    const sponsors = await sponsorships.listActiveSponsorships(placement);
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
    const sponsors = await sponsorships.listSponsorships();
    return res.status(200).json({ success: true, sponsors });
  } catch (err) { next(err); }
});

// Admin: create sponsor
router.post('/admin/sponsorships', requireAdmin, [
  body('company').notEmpty().withMessage('Company name is required.'),
  body('headline').notEmpty().withMessage('Headline is required.'),
  body('ctaUrl').notEmpty().withMessage('CTA URL is required.'),
  body('placement').isIn(['homepage', 'homepage-left', 'sticky-corner', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    const sponsor = await sponsorships.upsertSponsorship(null, req.body);
    return res.status(201).json({ success: true, sponsor });
  } catch (err) { next(err); }
});

// Admin: update sponsor
router.put('/admin/sponsorships/:id', requireAdmin, [
  body('company').notEmpty().withMessage('Company name is required.'),
  body('placement').isIn(['homepage', 'homepage-left', 'sticky-corner', 'sidebar', 'article-footer']).withMessage('Invalid placement.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    const sponsor = await sponsorships.upsertSponsorship(req.params.id, req.body);
    return res.status(200).json({ success: true, sponsor });
  } catch (err) { next(err); }
});

// Admin: delete sponsor
router.delete('/admin/sponsorships/:id', requireAdmin, async (req, res, next) => {
  try {
    await sponsorships.deleteSponsorship(req.params.id);
    return res.status(200).json({ success: true });
  } catch (err) { next(err); }
});

// ── Atlas config (admin read/write) ──────────────────────────────────────────
router.get('/admin/atlas/config', requireAdmin, async (_req, res, next) => {
  try {
    const cfg = await adminConfig.getAtlasConfig();
    return res.status(200).json({ success: true, config: cfg });
  } catch (err) { return next(err); }
});

router.put('/admin/atlas/config', requireAdmin, [
  body('enabledModels').isArray({ min: 1 }).withMessage('enabledModels must be a non-empty array.'),
  body('enabledModels.*').isString().notEmpty(),
  body('defaultModel').isString().notEmpty().withMessage('defaultModel is required.'),
  body('budgetCapInr').isFloat({ min: 0 }).withMessage('budgetCapInr must be a non-negative number.'),
  body('modelSelectorVisible').isBoolean().withMessage('modelSelectorVisible must be a boolean.'),
  body('ragEnabled').optional().isBoolean().withMessage('ragEnabled must be a boolean.'),
  body('ragTopK').optional().isInt({ min: 1, max: 20 }).withMessage('ragTopK must be between 1 and 20.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', errors: errors.array() });
  try {
    await adminConfig.upsertAtlasConfig({
      enabledModels:        req.body.enabledModels,
      defaultModel:         req.body.defaultModel,
      budgetCapInr:         Number(req.body.budgetCapInr),
      modelSelectorVisible: req.body.modelSelectorVisible,
      ragEnabled:           req.body.ragEnabled === true || req.body.ragEnabled === 'true',
      ragTopK:              req.body.ragTopK ? Number(req.body.ragTopK) : 5,
    });
    return res.status(200).json({ success: true });
  } catch (err) { return next(err); }
});

// ── RAG Evaluation SSE endpoint ─────────────────────────────────────────────
//
// GET /api/admin/atlas/rag-eval?token=<idToken>
//
// EventSource cannot send custom headers so we accept the Bearer token as a
// query parameter and validate it here.  The stream sends three event types:
//
//   progress  { index, total, question, hit, rank }  — after each question
//   result    { metrics, details }                   — final summary
//   done      {}                                     — signals stream end
//   error     { message }                            — on failure
//
router.get('/admin/atlas/rag-eval', async (req, res) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  try {
    if (!config.admin.localPreview) {
      const token = String(req.query.token || '');
      if (!token) {
        res.status(401).json({ success: false, error: 'Missing token.' });
        return;
      }
      const user  = await googleAuth.verifyIdToken(token);
      const email = String(user?.email || '').toLowerCase();
      if (config.admin.allowedEmails.length && !config.admin.allowedEmails.includes(email)) {
        res.status(403).json({ success: false, error: 'Admin access not allowed.' });
        return;
      }
    }
  } catch (_authErr) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
    return;
  }

  // ── SSE headers ───────────────────────────────────────────────────────────
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const send = (eventName, data) => {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const k = Math.max(1, Math.min(Number(req.query.k) || 5, 20));

  try {
    const { metrics, details } = await evaluateRetrieval(GOLDEN_SET, {
      k,
      delayMs: 300,
      onProgress({ index, total, question, hit, rank }) {
        send('progress', { index, total, question, hit, rank });
      },
    });

    // ── Persist run to Firestore for audit history ─────────────────────────
    try {
      const hits  = details.filter(d => d.hit).length;
      const total = details.length;
      await firestore.getDb().collection('ragEvalRuns').add({
        ranAt:     new Date(),
        k,
        metrics,
        hits,
        misses:    total - hits,
        total,
        passRate:  total > 0 ? Math.round((hits / total) * 100) : 0,
        passed:    metrics.recall >= 0.8,
        details,
      });
    } catch (saveErr) {
      // Non-fatal — log but don't fail the SSE stream.
      console.error('[rag-eval] failed to save run history:', saveErr.message);
    }

    send('result', { metrics, details });
  } catch (err) {
    send('error', { message: err.message || 'Evaluation failed.' });
  } finally {
    send('done', {});
    res.end();
  }
});

// ── RAG Evaluation History ────────────────────────────────────────────────
//
// GET /api/admin/atlas/rag-eval/history
// Returns the last N evaluation runs ordered by most recent first.
//
router.get('/admin/atlas/rag-eval/history', async (req, res) => {
  try {
    if (!config.admin.localPreview) {
      const auth  = String(req.headers.authorization || '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : String(req.query.token || '');
      if (!token) { res.status(401).json({ success: false, error: 'Missing token.' }); return; }
      const user  = await googleAuth.verifyIdToken(token);
      const email = String(user?.email || '').toLowerCase();
      if (config.admin.allowedEmails.length && !config.admin.allowedEmails.includes(email)) {
        res.status(403).json({ success: false, error: 'Admin access not allowed.' }); return;
      }
    }
  } catch (_) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' }); return;
  }

  const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));

  try {
    const snap = await firestore.getDb()
      .collection('ragEvalRuns')
      .orderBy('ranAt', 'desc')
      .limit(limit)
      .get();

    const runs = snap.docs.map(doc => {
      const d = doc.data();
      return {
        id:       doc.id,
        ranAt:    d.ranAt?.toDate?.()?.toISOString() || null,
        k:        d.k,
        metrics:  d.metrics,
        hits:     d.hits,
        misses:   d.misses,
        total:    d.total,
        passRate: d.passRate,
        passed:   d.passed,
      };
    });

    res.json({ success: true, runs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
