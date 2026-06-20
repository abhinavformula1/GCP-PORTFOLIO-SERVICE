'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { AppError }             = require('../errors');
const { getSystemDesignArticle } = require('../services/firestore');
const { buildPrintDocument }   = require('../services/articleHtml');
const { generatePdfFromHtml, resolveChromePath } = require('../services/pdf');

const router = express.Router();

const pdfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', error: 'Too many PDF exports. Try again in 15 minutes.' },
});

// Chrome health-check
router.get('/health', async (_req, res) => {
  try {
    const puppeteer      = require('puppeteer-core');
    const executablePath = resolveChromePath();
    const browser = await puppeteer.launch({
      executablePath, headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    res.json({ ok: true, chrome: executablePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// System Design article PDF export
router.get('/export', pdfLimiter, async (req, res, next) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
      return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'Missing or invalid article id.' });
    }

    // 1. Fetch article from Firestore (same DB the live page uses).
    const article = await getSystemDesignArticle(id);
    if (!article) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Article not found.' });
    }

    // 2. Build self-contained HTML (CSS embedded, no external requests needed).
    const html = buildPrintDocument(article);

    // 3. Render to PDF via headless Chrome — no URL navigation, no frame issues.
    const pdfBuffer = await generatePdfFromHtml(html);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-system-design.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(new AppError('PDF generation failed: ' + err.message, 500, 'PDF_ERROR'));
  }
});

module.exports = router;
