'use strict';

const { AppError, ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createMediaUseCases(dependencies) {
  assertDependencies(dependencies, 'application.media', {
    storage: ['uploadMedia', 'listMediaObjects', 'deleteMediaObject'],
    articles: ['listArticles'],
    sponsorBanner: ['getSponsorBanner', 'upsertSponsorBanner', 'deleteSponsorBanner'],
    runtime: 'value',
    clock: ['now'],
    maxUploadBytes: 'value',
  });
  const { storage, articles, sponsorBanner, runtime, clock, maxUploadBytes } = dependencies;

  function bucketName() {
    let name = runtime.mediaBucket;
    const production = runtime.nodeEnv === 'production' || runtime.isCloudRuntime;
    if (!name && runtime.adminLocalPreview && !production) name = 'portfolio-service-media';
    return name || '';
  }

  function normalizeProviderError(error) {
    if (!String(error?.message || '').includes('Could not load the default credentials')) return error;
    return new AppError(
      'Local preview needs GCP credentials to read Firestore/GCS. Run: gcloud auth application-default login',
      503,
      'GCP_AUTH_REQUIRED'
    );
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function referenceMap(bucket) {
    const rows = await articles.listArticles();
    const references = new Map();
    function add(name, reference) {
      if (!name) return;
      references.set(name, (references.get(name) || []).concat(reference));
    }
    const prefix = `https://storage.googleapis.com/${bucket}/`;
    const pattern = new RegExp(`https:\\/\\/storage\\.googleapis\\.com\\/${escapeRegExp(bucket)}\\/media\\/[^"\\s\\)\\>]+`, 'g');
    for (const article of rows) {
      const title = String(article?.en?.title || article?.id || '');
      if (typeof article.thumbnail === 'string' && article.thumbnail.startsWith(prefix)) {
        add(article.thumbnail.slice(prefix.length), { articleId: article.id, title, field: 'thumbnail' });
      }
      for (const url of JSON.stringify(article || {}).match(pattern) || []) {
        if (url.startsWith(prefix)) {
          add(url.slice(prefix.length), { articleId: article.id, title, field: 'body' });
        }
      }
    }
    return references;
  }

  async function upload(file, preset) {
    if (!file) throw new ValidationError('No file provided or file type not allowed (JPEG, PNG, WebP, SVG only).');
    return { ok: true, ...await storage.uploadMedia({ ...file, preset: String(preset || '').trim() }) };
  }

  async function audit() {
    const bucket = bucketName();
    if (!bucket) throw new ValidationError('MEDIA_BUCKET is not configured on this server.');
    try {
      const [objects, references] = await Promise.all([
        storage.listMediaObjects({ prefix: 'media/' }),
        referenceMap(bucket),
      ]);
      const rows = objects.map((object) => {
        const referencedBy = references.get(object.name) || [];
        return {
          name: object.name, url: object.url, size: object.size,
          updatedAt: object.updatedAt, contentType: object.contentType,
          referencedBy, isOrphan: referencedBy.length === 0,
        };
      }).sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
      const totalBytes = objects.reduce((sum, object) => sum + (Number(object.size) || 0), 0);
      const orphanObjects = rows.filter((row) => row.isOrphan).length;
      return {
        success: true, ok: true, bucket, prefix: 'media/',
        summary: {
          totalObjects: rows.length, totalBytes, orphanObjects,
          referencedObjects: rows.length - orphanObjects,
        },
        objects: rows,
      };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }

  async function removeObject(nameInput) {
    const bucket = bucketName();
    if (!bucket) throw new ValidationError('MEDIA_BUCKET is not configured on this server.');
    const name = String(nameInput || '').trim();
    if (!name) throw new ValidationError('name is required.');
    if (!name.startsWith('media/')) throw new ValidationError('Only media/ objects can be deleted.');
    let references;
    try {
      references = (await referenceMap(bucket)).get(name) || [];
    } catch (error) {
      throw normalizeProviderError(error);
    }
    if (references.length) {
      return {
        statusCode: 409,
        body: {
          success: false,
          code: 'MEDIA_IN_USE',
          error: 'This media file is still referenced by an article and cannot be deleted.',
          referencedBy: references,
        },
      };
    }
    return {
      statusCode: 200,
      body: { success: true, ok: true, ...await storage.deleteMediaObject(name) },
    };
  }

  async function getSponsorship() {
    return { ok: true, sponsorship: await sponsorBanner.getSponsorBanner() || null };
  }

  async function saveSponsorship(input) {
    const { url, alt, link, cta, expiresAt } = input;
    await sponsorBanner.upsertSponsorBanner({
      url,
      alt: String(alt).trim(),
      link: link || '',
      cta: cta ? String(cta).trim() : '',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      updatedAt: new Date(clock.now()),
    });
    return { ok: true };
  }

  async function deleteSponsorship() {
    await sponsorBanner.deleteSponsorBanner();
    return { ok: true };
  }

  return Object.freeze({
    maxUploadBytes,
    upload, audit, removeObject, getSponsorship, saveSponsorship, deleteSponsorship,
  });
}

module.exports = { createMediaUseCases };
