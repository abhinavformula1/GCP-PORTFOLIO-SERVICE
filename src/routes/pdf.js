'use strict';

/**
 * PDF export route.
 *
 * Public endpoints — content is already public, PDFs are too.
 * Rate-limited to 10 requests / 15 min per IP to protect Cloud Run CPU.
 *
 * ── Endpoints ──────────────────────────────────────────────────────────────
 *
 * GET /api/pdf/health
 *   Chrome startup health-check. Returns { ok, chrome } or { ok: false, error }.
 *
 * GET /api/pdf/export?id=<article-slug>
 *   Export a System Design article. Shorthand — builds the URL internally.
 *   e.g. /api/pdf/export?id=salesforce-mulesoft-authentication
 *
 * ── Future expansion (same service, zero changes needed) ───────────────────
 *   To PDF any other page just call generatePdf({ url, readySelector, ... })
 *   from a new route. The PDF engine is fully decoupled from page structure.
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { AppError }    = require('../errors');
const { generatePdf, resolveChromePath } = require('../services/pdf');

const router = express.Router();

const pdfLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, code: 'RATE_LIMITED', error: 'Too many PDF exports. Try again in 15 minutes.' },
});

// ── Chrome health-check ──────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const puppeteer      = require('puppeteer-core');
    const executablePath = resolveChromePath();
    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    res.json({ ok: true, chrome: executablePath });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── System Design article export ─────────────────────────────────────────────
router.get('/export', pdfLimiter, async (req, res, next) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
      return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'Missing or invalid article id.' });
    }

    const proto   = req.headers['x-forwarded-proto'] || req.protocol;
    const host    = req.headers['x-forwarded-host']  || req.get('host');
    const baseUrl = `${proto}://${host}`;

    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const headerHtml =
      '<div class="sd-print-header" aria-hidden="true">' +
        '<span class="sd-print-header-brand">Abhinav Kumar \u2014 System Design</span>' +
        '<span class="sd-print-header-date">' + dateStr + '</span>' +
      '</div>';

    const pdfBuffer = await generatePdf({
      baseUrl,
      hash:          `#/system-design/${encodeURIComponent(id)}`,
      readySelector: '.sd-article-body',
      printClass:    'sd-printing',
      headerHtml,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-system-design.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(new AppError('PDF generation failed: ' + err.message, 500, 'PDF_ERROR'));
  }
});

module.exports = router;
