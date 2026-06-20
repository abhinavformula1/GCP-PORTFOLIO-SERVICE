'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const { AppError }                   = require('../errors');
const { generatePdf, resolveChromePath } = require('../services/pdf');

const router = express.Router();

const pdfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', error: 'Too many PDF exports. Try again in 15 minutes.' },
});

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

router.get('/export', pdfLimiter, async (req, res, next) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== 'string' || !/^[\w-]+$/.test(id)) {
      return res.status(400).json({ success: false, code: 'BAD_REQUEST', error: 'Missing or invalid article id.' });
    }

    const proto   = req.headers['x-forwarded-proto'] || req.protocol;
    const host    = req.headers['x-forwarded-host']  || req.get('host');
    const baseUrl = `${proto}://${host}`;

    const pdfBuffer = await generatePdf({
      url:           `${baseUrl}/#/system-design/${encodeURIComponent(id)}`,
      readySelector: '.sd-article-body',
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
