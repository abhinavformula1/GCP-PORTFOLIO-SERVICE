'use strict';

/**
 * System Design content routes.
 *
 * Firestore is used as a lightweight CMS so article edits can be published
 * without rebuilding the Cloud Run image. The frontend keeps checked-in
 * fallback content for local/dev outages or an empty CMS collection.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const firestore = require('../services/firestore');
const { ValidationError } = require('../errors');

const router = express.Router();
const BODY_MAX_LEN = 60000;

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

router.get('/system-design/articles', async (_req, res) => {
  try {
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
    const articles = await firestore.listSystemDesignArticles();
    return res.status(200).json({ success: true, articles });
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

module.exports = router;
