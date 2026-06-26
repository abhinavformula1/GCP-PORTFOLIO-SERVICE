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
const { uploadMedia, listMediaObjects, deleteMediaObject, MAX_BYTES } = require('../services/gcs');
const { getSponsorship, upsertSponsorship, deleteSponsorship, listSystemDesignArticles } = require('../services/firestore');
const { AppError, ValidationError } = require('../errors');

const router = express.Router();

// Memory storage — buffer lives only for the duration of the request.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter(_req, file, cb) {
    const allowed = /^image\/(jpeg|jpg|png|webp|svg\+xml)$/;
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
        throw new ValidationError('No file provided or file type not allowed (JPEG, PNG, WebP, SVG only).');
      }
      const preset = String(req.query?.preset || '').trim();
      const result = await uploadMedia(Object.assign({}, req.file, { preset }));
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/admin/media/audit ────────────────────────────────────────────────
// Returns:
//   - all objects under gs://<MEDIA_BUCKET>/media/
//   - which articles reference which objects
//   - which objects are orphaned (safe-to-delete candidates)
router.get('/admin/media/audit', requireAdmin, async (_req, res, next) => {
  try {
    const bucket = resolveMediaBucketName();
    if (!bucket) throw new ValidationError('MEDIA_BUCKET is not configured on this server.');

    let objects;
    let refMap;
    try {
      objects = await listMediaObjects({ prefix: 'media/' });
      refMap = await buildMediaReferenceMap({ bucket });
    } catch (err) {
      throwAdcHelpIfNeeded(err);
      throw err;
    }

    const rows = objects.map((o) => {
      const refs = refMap.get(o.name) || [];
      return {
        name: o.name,
        url: o.url,
        size: o.size,
        updatedAt: o.updatedAt,
        contentType: o.contentType,
        referencedBy: refs,
        isOrphan: refs.length === 0,
      };
    });

    const totalBytes = objects.reduce((sum, o) => sum + (Number(o.size) || 0), 0);
    const orphanCount = rows.reduce((n, r) => n + (r.isOrphan ? 1 : 0), 0);

    return res.json({
      success: true,
      ok: true,
      bucket,
      prefix: 'media/',
      summary: {
        totalObjects: rows.length,
        totalBytes,
        orphanObjects: orphanCount,
        referencedObjects: rows.length - orphanCount,
      },
      objects: rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    });
  } catch (err) {
    next(err);
  }
});

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveMediaBucketName() {
  let name = process.env.MEDIA_BUCKET;
  const isProd = (process.env.NODE_ENV || 'development') === 'production' || !!process.env.K_SERVICE;
  const isLocalPreview = process.env.ADMIN_LOCAL_PREVIEW === 'true' && !isProd;
  if (!name && isLocalPreview) name = 'portfolio-service-media';
  return name || '';
}

function isMissingAdc(err) {
  const msg = String(err?.message || '');
  return msg.includes('Could not load the default credentials');
}

function throwAdcHelpIfNeeded(err) {
  if (!isMissingAdc(err)) return;
  throw new AppError(
    'Local preview needs GCP credentials to read Firestore/GCS. Run: gcloud auth application-default login',
    503,
    'GCP_AUTH_REQUIRED'
  );
}

async function buildMediaReferenceMap({ bucket }) {
  const articles = await listSystemDesignArticles();
  const refMap = new Map(); // objectName -> [{ articleId, title, field }]

  function addRef(objectName, ref) {
    if (!objectName) return;
    const list = refMap.get(objectName) || [];
    list.push(ref);
    refMap.set(objectName, list);
  }

  const urlPrefix = `https://storage.googleapis.com/${bucket}/`;
  const urlRe = new RegExp(`https:\\/\\/storage\\.googleapis\\.com\\/${escapeRegExp(bucket)}\\/media\\/[^"\\s\\)\\>]+`, 'g');

  for (const a of articles) {
    const title = (a?.en?.title || a?.id || '').toString();

    if (a.thumbnail && typeof a.thumbnail === 'string' && a.thumbnail.startsWith(urlPrefix)) {
      const objectName = a.thumbnail.slice(urlPrefix.length);
      addRef(objectName, { articleId: a.id, title, field: 'thumbnail' });
    }

    const blob = JSON.stringify(a || {});
    const matches = blob.match(urlRe) || [];
    for (const url of matches) {
      if (!url.startsWith(urlPrefix)) continue;
      const objectName = url.slice(urlPrefix.length);
      addRef(objectName, { articleId: a.id, title, field: 'body' });
    }
  }

  return refMap;
}

// ── DELETE /api/admin/media/object ────────────────────────────────────────────
// Deletes a single media object, but only if it's still orphaned at delete time.
router.delete('/admin/media/object', requireAdmin, async (req, res, next) => {
  try {
    const bucket = resolveMediaBucketName();
    if (!bucket) throw new ValidationError('MEDIA_BUCKET is not configured on this server.');

    const name = String(req.query?.name || req.body?.name || '').trim();
    if (!name) throw new ValidationError('name is required.');
    if (!name.startsWith('media/')) throw new ValidationError('Only media/ objects can be deleted.');

    // Re-check references at the moment of delete (race-safe).
    let refMap;
    try {
      refMap = await buildMediaReferenceMap({ bucket });
    } catch (err) {
      throwAdcHelpIfNeeded(err);
      throw err;
    }
    const refs = refMap.get(name) || [];
    if (refs.length) {
      return res.status(409).json({
        success: false,
        code: 'MEDIA_IN_USE',
        error: 'This media file is still referenced by an article and cannot be deleted.',
        referencedBy: refs,
      });
    }

    const result = await deleteMediaObject(name);
    return res.json({ success: true, ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

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
