'use strict';

/**
 * System design articles repository.
 *
 * Domain-facing article reads/writes. Storage currently uses Firestore.
 */

const { FieldValue } = require('@google-cloud/firestore');
const firestore = require('../services/firestore');

const SYSTEM_DESIGN_COLLECTION = 'systemDesignArticles';
const ALLOWED_CONTENT_TYPES = new Set(['system-design', 'architecture', 'case-study']);

function normaliseContentType(raw, categoryFallback) {
  const explicit = String(raw || '').trim();
  if (ALLOWED_CONTENT_TYPES.has(explicit)) return explicit;
  const category = String(categoryFallback || '').trim().toLowerCase();
  if (category === 'case-study' || category === 'case_study' || category === 'casestudy') return 'case-study';
  if (category === 'architecture') return 'architecture';
  return 'system-design';
}

function sanitiseArticleBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return null;
      let plain;
      try {
        plain = JSON.parse(JSON.stringify(block));
      } catch {
        return null;
      }
      if (!plain || typeof plain !== 'object') return null;
      plain.id = String(plain.id || '');
      plain.type = String(plain.type || 'paragraph');
      if (plain.type === 'matrix' && Array.isArray(plain.rows)) {
        plain.rows = plain.rows.map((row) =>
          Array.isArray(row) ? { cells: row.map(String) } : row
        );
      }
      return plain;
    })
    .filter(Boolean)
    .slice(0, 200);
}

function normaliseArticle(id, data) {
  const v = data || {};
  const en = v.en && typeof v.en === 'object' ? v.en : {};
  const fr = v.fr && typeof v.fr === 'object' ? v.fr : {};
  const blocks = sanitiseArticleBlocks(v.blocks);
  return {
    id,
    category: v.category != null ? String(v.category) : '',
    contentType: normaliseContentType(v.contentType, v.category),
    icon: String(v.icon || 'article'),
    status: String(v.status || 'Published'),
    tags: Array.isArray(v.tags) ? v.tags.map(String).slice(0, 12) : [],
    readMinutes: v.readMinutes ? Number(v.readMinutes) : null,
    tier: String(v.tier || 'free'),
    stub: !!v.stub,
    order: Number(v.order || 999),
    blocks,
    thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : '',
    updatedAt: v.updatedAt?.toMillis ? v.updatedAt.toMillis() : null,
    en: {
      title: String(en.title || v.title || id),
      subtitle: String(en.subtitle || v.subtitle || ''),
      body: String(en.body || v.bodyHtml || ''),
    },
    fr: {
      title: String(fr.title || en.title || v.title || id),
      subtitle: String(fr.subtitle || en.subtitle || v.subtitle || ''),
      body: String(fr.body || en.body || v.bodyHtml || ''),
    },
  };
}

async function listPublishedArticles() {
  const snap = await firestore.getDb().collection(SYSTEM_DESIGN_COLLECTION).get();
  return snap.docs
    .map((doc) => normaliseArticle(doc.id, doc.data()))
    .filter((article) => article.status.toLowerCase() === 'published' || article.stub)
    .sort((a, b) => a.order - b.order || a.en.title.localeCompare(b.en.title));
}

async function listArticles() {
  const snap = await firestore.getDb().collection(SYSTEM_DESIGN_COLLECTION).get();
  return snap.docs
    .map((doc) => normaliseArticle(doc.id, doc.data()))
    .sort((a, b) => a.order - b.order || a.en.title.localeCompare(b.en.title));
}

async function getArticle(id) {
  const snap = await firestore.getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return normaliseArticle(snap.id, snap.data());
}

async function upsertArticle(article, { publishedBy } = {}) {
  if (!article || typeof article !== 'object') {
    throw new Error('upsertArticle: article object is required.');
  }
  const id = String(article.id || article.slug || '').trim();
  if (!id) throw new Error('upsertArticle: id or slug is required.');

  const ref = firestore.getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(id);
  return firestore.getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data() || {}) : {};
    const nextVersion = Number(previous.version || 0) + 1;
    const now = FieldValue.serverTimestamp();

    const contentType = normaliseContentType(
      article.contentType !== undefined ? article.contentType : previous.contentType,
      article.category !== undefined ? article.category : previous.category
    );
    const tags = article.tags !== undefined
      ? (Array.isArray(article.tags) ? article.tags.map(String).slice(0, 12) : [])
      : (Array.isArray(previous.tags) ? previous.tags.map(String).slice(0, 12) : []);
    const blocks = article.blocks !== undefined
      ? sanitiseArticleBlocks(article.blocks)
      : sanitiseArticleBlocks(previous.blocks);
    const thumbnail = article.thumbnail !== undefined
      ? (typeof article.thumbnail === 'string' ? article.thumbnail : '')
      : (typeof previous.thumbnail === 'string' ? previous.thumbnail : '');
    const enDoc = (article.en && typeof article.en === 'object')
      ? article.en
      : (previous.en && typeof previous.en === 'object' ? previous.en : {});
    const frDoc = (article.fr && typeof article.fr === 'object')
      ? article.fr
      : (previous.fr && typeof previous.fr === 'object' ? previous.fr : {});

    const payload = {
      contentType,
      icon: String(article.icon || previous.icon || 'article'),
      status: String(article.status || previous.status || 'Published'),
      tags,
      readMinutes: article.readMinutes !== undefined
        ? (article.readMinutes ? Number(article.readMinutes) : null)
        : (previous.readMinutes ? Number(previous.readMinutes) : null),
      tier: String(article.tier || previous.tier || 'free'),
      stub: article.stub !== undefined ? !!article.stub : !!previous.stub,
      order: Number(article.order || previous.order || 999),
      blocks,
      thumbnail,
      en: enDoc,
      fr: frDoc,
      version: nextVersion,
      updatedAt: now,
      updatedBy: String(publishedBy || 'local-script'),
    };
    if (article.category !== undefined) payload.category = String(article.category || '');
    else if (previous.category !== undefined) payload.category = String(previous.category || '');
    if (!snap.exists) payload.createdAt = now;

    tx.set(ref, payload, { merge: true });
    tx.set(ref.collection('versions').doc(String(nextVersion)), {
      ...payload,
      capturedAt: now,
    });
    return { id, version: nextVersion };
  });
}

async function deleteArticle(id) {
  const articleId = String(id || '').trim();
  if (!articleId) return;
  await firestore.getDb().collection(SYSTEM_DESIGN_COLLECTION).doc(articleId).delete();
}

module.exports = {
  listPublishedArticles,
  listArticles,
  getArticle,
  upsertArticle,
  deleteArticle,
};
