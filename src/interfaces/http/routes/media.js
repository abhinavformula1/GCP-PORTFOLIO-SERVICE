'use strict';

const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const { ValidationError } = require('../../../domain/errors');
const { assertDependencies } = require('../../../application/ports/assert');

function createRouter(dependencies) {
  assertDependencies(dependencies, 'interfaces.routes.media', {
    requireAdmin: 'function',
    media: ['upload', 'audit', 'removeObject', 'getSponsorship', 'saveSponsorship', 'deleteSponsorship'],
  });
  const { requireAdmin, media } = dependencies;
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: media.maxUploadBytes },
    fileFilter(_req, file, callback) {
      callback(null, /^image\/(jpeg|jpg|png|webp|svg\+xml)$/.test(file.mimetype));
    },
  });

  router.post('/media/upload', requireAdmin, upload.single('file'), async (req, res, next) => {
    try {
      return res.json(await media.upload(req.file, req.query?.preset));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/admin/media/audit', requireAdmin, async (_req, res, next) => {
    try {
      return res.json(await media.audit());
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/admin/media/object', requireAdmin, async (req, res, next) => {
    try {
      const result = await media.removeObject(req.query?.name || req.body?.name);
      return res.status(result.statusCode).json(result.body);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/media/sponsorship', async (_req, res, next) => {
    try {
      return res.json(await media.getSponsorship());
    } catch (error) {
      return next(error);
    }
  });

  router.put('/media/sponsorship', requireAdmin, [
    body('url').isURL().withMessage('url must be a valid URL.'),
    body('alt').trim().notEmpty().withMessage('alt text is required.'),
    body('link').optional({ checkFalsy: true }).isURL().withMessage('link must be a valid URL.'),
    body('cta').optional().trim(),
    body('expiresAt').optional({ checkFalsy: true }).isISO8601().withMessage('expiresAt must be ISO 8601.'),
  ], async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);
      return res.json(await media.saveSponsorship(req.body));
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/media/sponsorship', requireAdmin, async (_req, res, next) => {
    try {
      return res.json(await media.deleteSponsorship());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createRouter };
