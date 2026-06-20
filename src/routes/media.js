'use strict';

/**
 * Media routes.
 *
 * POST /api/media/upload          Upload an image → GCS, returns { url, mimeType, size }
 * GET  /api/media/sponsorship      Returns the active sponsorship banner (public)
 * PUT  /api/media/sponsorship      Upsert the sponsorship banner (admin-only)
 * DELETE /api/media/sponsorship    Remove the active sponsorship (admin-only)
 */

const express = require('express');
const multer  = require('multer');
const { body, validationResult } = require('express-validator');
const { requireAdmin } = require('../middleware/auth');
const { uploadMedia, MAX_BYTES } = require('../services/gcs');
const { getSponsorship, upsertSponsorship, deleteSponsorship } = require('../services/firestore');
const { ValidationError } = require('../errors');

const router = express.Router();

// Memory storage — buffer lives only for the duration of the request.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter(_req, file, cb) {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/;
    cb(null, allowed.test(file.mimetype));
  },
});

// ── POST /api/media/upload ───────────────────────────────────────────────────
router.post(
  '/media/upload',
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ValidationError('No file provided or file type not allowed (JPEG, PNG, GIF, WebP, SVG only).');
      }
      const result = await uploadMedia(req.file);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/media/sponsorship ───────────────────────────────────────────────
router.get('/media/sponsorship', async (_req, res, next) => {
  try {
    const sponsorship = await getSponsorship();
    res.json({ ok: true, sponsorship: sponsorship || null });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/media/sponsorship ───────────────────────────────────────────────
router.put(
  '/media/sponsorship',
  requireAdmin,
  [
    body('url').isURL().withMessage('url must be a valid URL.'),
    body('alt').trim().notEmpty().withMessage('alt text is required.'),
    body('link').optional({ checkFalsy: true }).isURL().withMessage('link must be a valid URL.'),
    body('cta').optional().trim(),
    body('expiresAt').optional({ checkFalsy: true }).isISO8601().withMessage('expiresAt must be ISO 8601.'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
      const { url, alt, link, cta, expiresAt } = req.body;
      const data = {
        url,
        alt: String(alt).trim(),
        link: link || '',
        cta: cta ? String(cta).trim() : '',
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        updatedAt: new Date(),
      };
      await upsertSponsorship(data);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/media/sponsorship ────────────────────────────────────────────
router.delete('/media/sponsorship', requireAdmin, async (_req, res, next) => {
  try {
    await deleteSponsorship();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
