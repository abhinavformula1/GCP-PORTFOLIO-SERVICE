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
  body('status').optional().trim().isIn(['Draft', 'Published', 'Coming soon']).withMessage('Status must be Draft, Published, or Coming soon.'),
  body('tags').optional().isArray({ max: 12 }).withMessage('Tags must be an array.'),
  body('readMinutes').optional().isInt({ min: 1, max: 60 }).withMessage('Read time must be between 1 and 60 minutes.'),
  body('order').optional().isInt({ min: 1, max: 9999 }).withMessage('Order must be a positive number.'),
  body('en.title').trim().isLength({ min: 3, max: 140 }).withMessage('English title is required.'),
  body('en.subtitle').optional().trim().isLength({ max: 240 }),
  body('en.body').trim().isLength({ min: 1, max: BODY_MAX_LEN }).withMessage('Article body is required.'),
  body('fr.title').optional().trim().isLength({ max: 140 }),
  body('fr.subtitle').optional().trim().isLength({ max: 240 }),
  body('fr.body').optional().trim().isLength({ max: BODY_MAX_LEN }),
];

function validateDomains(domains) {
  if (!Array.isArray(domains)) throw new ValidationError('Allowed domains must be an array.');
  const clean = contactPolicy.normaliseDomains(domains);
  if (clean.length > 20) throw new ValidationError('Allowed domain list cannot exceed 20 entries.');
  for (const domain of clean) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes('..')) {
      throw new ValidationError('Allowed domains must be valid domain names.');
    }
  }
  return Array.from(new Set(clean));
}

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
    const allowedDomains = validateDomains(req.body?.allowedDomains);
    if (canUseLocalSeedFallback()) {
      return res.status(200).json({
        success: true,
        policy: {
          source: 'local-dev',
          allowedDomains,
          updatedBy: req.user.email,
          updatedAt: Date.now(),
          privatePhoneConfigured: !!config.contactPolicy.privatePhone,
        },
      });
    }
    const saved = await firestore.upsertContactPolicyConfig({
      allowedDomains,
      updatedBy: req.user.email,
    });
    return res.status(200).json({
      success: true,
      policy: {
        source: 'firestore',
        allowedDomains: saved.allowedDomains,
        updatedBy: saved.updatedBy,
        updatedAt: saved.updatedAt,
        privatePhoneConfigured: !!config.contactPolicy.privatePhone,
      },
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

    const article = Object.assign({}, req.body, { id: req.params.id });
    const result = await firestore.upsertSystemDesignArticle(article, {
      publishedBy: req.user.email,
    });
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

module.exports = router;
