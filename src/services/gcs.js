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

const storage = new Storage();

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function getBucket() {
  const name = process.env.MEDIA_BUCKET;
  if (!name) {
    const err = new Error('Media storage is not configured on this server. Set the MEDIA_BUCKET environment variable.');
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
  return storage.bucket(name);
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
async function uploadMedia({ buffer, mimetype, originalname, size }) {
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    const err = new Error(`Unsupported file type: ${mimetype}. Allowed: JPEG, PNG, GIF, WebP, SVG.`);
    err.statusCode = 400;
    throw err;
  }

  if (size > MAX_BYTES) {
    const err = new Error(`File too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 8 MB.`);
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(originalname).toLowerCase() || '.' + mimetype.split('/')[1];
  const safeName = path.basename(originalname, path.extname(originalname))
    .replace(/[^a-z0-9_-]/gi, '-')
    .toLowerCase()
    .slice(0, 40);

  const uid = crypto.randomBytes(6).toString('hex');
  const destName = `media/${Date.now()}-${uid}-${safeName}${ext}`;

  const bucket = getBucket();
  const file = bucket.file(destName);

  await file.save(buffer, {
    metadata: {
      contentType: mimetype,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    resumable: false,
  });

  // Make file publicly readable.
  await file.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${destName}`;
  return { url, mimeType: mimetype, size };
}

module.exports = { uploadMedia, ALLOWED_MIME_TYPES, MAX_BYTES };
