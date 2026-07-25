'use strict';

/**
 * Google Cloud Storage service.
 *
 * Handles all media uploads for the portfolio:
 *   - System Design article image blocks
 *   - Home-page sponsorship banners
 *   - Article thumbnails
 *
 * Files are stored at:
 *   gs://<MEDIA_BUCKET>/media/<timestamp>-<safeName>
 *
 * The bucket MUST have `allUsers` Storage Object Viewer IAM binding
 * (uniform bucket-level access) so every uploaded file is publicly readable
 * without a signed URL.
 *
 * Local dev: set MEDIA_BUCKET in .env.  Cloud Run: inject as env var.
 */

const { Storage } = require('@google-cloud/storage');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const ALLOWED_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/svg+xml',
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function createMediaStorage({ runtime, storage = new Storage() }) {
if (!runtime || typeof runtime !== 'object') {
  throw new TypeError('mediaStorage.runtime is required');
}
if (!storage || typeof storage.bucket !== 'function') {
  throw new TypeError('mediaStorage.storage.bucket is required');
}
function getBucket() {
  let name = runtime.mediaBucket;
  // Local preview convenience: let the admin UI work without env wiring.
  // Production (Cloud Run) must always be explicitly configured.
  const isProd = runtime.nodeEnv === 'production' || runtime.isCloudRuntime;
  const isLocalPreview = runtime.adminLocalPreview && !isProd;
  if (!name && isLocalPreview) name = 'portfolio-service-media';
  if (!name) {
    const err = new Error('MEDIA_BUCKET is not configured on this server.');
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
  return storage.bucket(name);
}

async function listMediaObjects({ prefix = 'media/' } = {}) {
  const bucket = getBucket();
  const [files] = await bucket.getFiles({ prefix });
  return files.map((f) => {
    const meta = f.metadata || {};
    const size = meta.size ? Number(meta.size) : 0;
    const updatedAt = meta.updated ? Date.parse(meta.updated) : null;
    const contentType = meta.contentType || '';
    return {
      name: f.name,
      url: `https://storage.googleapis.com/${bucket.name}/${f.name}`,
      size,
      updatedAt,
      contentType,
    };
  });
}

async function deleteMediaObject(objectName) {
  const name = String(objectName || '').trim();
  if (!name.startsWith('media/')) {
    const err = new Error('Invalid media object name.');
    err.statusCode = 400;
    throw err;
  }
  const bucket = getBucket();
  const file = bucket.file(name);
  // ignoreNotFound avoids turning cleanup into a noisy failure
  await file.delete({ ignoreNotFound: true });
  return { deleted: true, name };
}

/**
 * Upload a file buffer to GCS and return its public URL + metadata.
 *
 * @param {object} opts
 * @param {Buffer}  opts.buffer    File content
 * @param {string}  opts.mimetype  MIME type from multer (already validated)
 * @param {string}  opts.originalname  Original filename from the client
 * @param {number}  opts.size      Byte length
 * @returns {Promise<{ url: string, mimeType: string, size: number }>}
 */
async function uploadMedia({ buffer, mimetype, originalname, size, preset }) {
  if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
    const err = new Error(`Unsupported file type: ${mimetype}. Allowed: JPEG, PNG, WebP, SVG.`);
    err.statusCode = 400;
    throw err;
  }

  if (size > MAX_BYTES) {
    const err = new Error(`File too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 8 MB.`);
    err.statusCode = 400;
    throw err;
  }

  const safeName = path.basename(originalname, path.extname(originalname))
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase()
    .slice(0, 40);

  const selectedPreset = preset === 'thumb' ? 'thumb' : (preset === 'hero' ? 'hero' : 'article');
  const maxWidth = selectedPreset === 'thumb' ? 1200 : 1600;

  const img = mimetype === 'image/svg+xml'
    ? sharp(buffer, { density: 300 })
    : sharp(buffer);

  const jpegPipeline = img.rotate();
  if (selectedPreset === 'hero') {
    // Hero images are always 16:9 for consistent tiles/headers.
    jpegPipeline.resize({
      width: 1600,
      height: 900,
      fit: 'cover',
      position: 'attention',
    });
  } else {
    jpegPipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  const jpegBuffer = await jpegPipeline
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();

  const digest = crypto.createHash('sha256').update(jpegBuffer).digest('hex').slice(0, 16);
  const destName = `media/${digest}.jpg`;

  const bucket = getBucket();
  const file = bucket.file(destName);

  const [exists] = await file.exists();
  if (!exists) {
    await file.save(jpegBuffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          originalName: originalname || safeName,
          preset: selectedPreset,
        },
      },
      resumable: false,
    });
  }

  await file.setMetadata({
    metadata: {
      lastSeenAt: String(Date.now()),
    },
  }).catch(function () { /* non-fatal */ });

  const url = `https://storage.googleapis.com/${bucket.name}/${destName}`;
  return { url, mimeType: 'image/jpeg', size: jpegBuffer.length };
}

  return Object.freeze({
    uploadMedia,
    listMediaObjects,
    deleteMediaObject,
    ALLOWED_MIME_TYPES,
    MAX_BYTES,
  });
}

module.exports = { createMediaStorage, ALLOWED_MIME_TYPES, MAX_BYTES };
