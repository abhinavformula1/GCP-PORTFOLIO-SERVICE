'use strict';

/**
 * Server-rendered print page for System Design articles.
 *
 * GET /print/system-design/:id
 *
 * Returns a self-contained HTML page with the article content and full CSS
 * embedded. Puppeteer navigates to this real HTTP URL — no hash routing, no
 * SPA, no detached frames — and GCS images load normally in a proper HTTP
 * origin context.
 */

const express = require('express');
const { buildPrintDocument }     = require('../../rendering/articleHtml');
const crypto = require('crypto');

function createRouter(dependencies) {
  const {
    getArticle, requestSecret,
  } = dependencies.print;

  const router = express.Router();

function verifyInternalPrintToken(id, exp, token) {
  const secret = String(requestSecret || '').trim();
  if (!secret) return false;
  const e = Number(exp || 0);
  if (!e || !isFinite(e)) return false;
  if (e < Date.now() - 10 * 1000) return false; // small clock skew
  if (e > Date.now() + 10 * 60 * 1000) return false; // don't accept far-future
  const base = `${id}:${e}`;
  const sig = crypto.createHmac('sha256', secret).update(base).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(String(token || '')));
  } catch (_) {
    return false;
  }
}

router.get('/system-design/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || !/^[\w-]+$/.test(id)) {
      return res.status(400).send('Invalid article id.');
    }

    const article = await getArticle(id);
    if (!article) {
      return res.status(404).send('Article not found.');
    }

    const tier = String(article?.tier || '').trim().toLowerCase();
    const isPremium = tier === 'premium';
    if (isPremium) {
      const ok = verifyInternalPrintToken(id, req.query.e, req.query.t);
      if (!ok) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Robots-Tag', 'noindex');
        return res.status(403).send('<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Premium</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:48px;color:#111} .card{max-width:720px;border:1px solid rgba(0,0,0,.14);border-radius:16px;padding:18px;background:rgba(0,0,0,.03)} h1{margin:0 0 8px;font-size:22px} p{margin:0;color:rgba(0,0,0,.72)}</style></head><body><div class="card"><h1>Premium article</h1><p>This print view is protected. Please export PDFs from the app after subscribing.</p></div></body></html>');
      }
    }

    const mode = String(req.query.mode || '').toLowerCase();
    const html = buildPrintDocument(article, { mode: mode === 'lite' ? 'lite' : 'full' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

  return router;
}

module.exports = { createRouter };
