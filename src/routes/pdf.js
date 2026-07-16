'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { AppError }           = require('../errors');
const { generatePdf, resolveChromePath } = require('../services/print');
const config = require('../config');
const { getArticle } = require('../repositories/articlesRepository');
const billing = require('../services/billing');
const googleAuth = require('../services/auth/google');

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

    const article = await getArticle(id);
    if (!article) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'Article not found.' });
    }
    const tier = String(article?.tier || '').trim().toLowerCase();
    const isPremium = tier === 'premium';

    // Premium PDFs require an active subscription.
    let allowFull = !isPremium;
    if (isPremium) {
      const header = req.headers.authorization || '';
      const m = /^Bearer\s+(.+)$/i.exec(header);
      if (!m) {
        return res.status(401).json({ success: false, code: 'UNAUTHORIZED', error: 'Sign in required to export premium PDFs.' });
      }
      const user = await googleAuth.verifyIdToken(m[1]);
      const ent = await billing.getUserSubscriptionEntitlement(user.uid);
      if (!ent || !ent.active) {
        return res.status(403).json({ success: false, code: 'SUBSCRIPTION_REQUIRED', error: 'Premium subscription required to export this PDF.' });
      }
      allowFull = true;
    }

    const proto   = req.headers['x-forwarded-proto'] || req.protocol;
    const host    = req.headers['x-forwarded-host']  || req.get('host');
    let printUrl = `${proto}://${host}/print/system-design/${encodeURIComponent(id)}`;

    // For premium: print endpoint must be protected; pass a short-lived signed token.
    if (allowFull && isPremium) {
      const secret = String(config.internal?.requestSecret || '').trim();
      if (!secret) {
        return res.status(503).json({ success: false, code: 'INTERNAL_SECRET_MISSING', error: 'Server is missing INTERNAL_REQUEST_SECRET.' });
      }
      const exp = Date.now() + 5 * 60 * 1000;
      const base = `${id}:${exp}`;
      const sig = crypto.createHmac('sha256', secret).update(base).digest('hex');
      printUrl += `?e=${encodeURIComponent(String(exp))}&t=${encodeURIComponent(sig)}`;
    }

    const pdfBuffer = await generatePdf(printUrl);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-software-architecture.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(new AppError('PDF generation failed: ' + err.message, 500, 'PDF_ERROR'));
  }
});

module.exports = router;
