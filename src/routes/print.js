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
const { getSystemDesignArticle } = require('../services/firestore');
const { buildPrintDocument }     = require('../services/articleHtml');

const router = express.Router();

router.get('/system-design/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || !/^[\w-]+$/.test(id)) {
      return res.status(400).send('Invalid article id.');
    }

    const article = await getSystemDesignArticle(id);
    if (!article) {
      return res.status(404).send('Article not found.');
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

module.exports = router;
