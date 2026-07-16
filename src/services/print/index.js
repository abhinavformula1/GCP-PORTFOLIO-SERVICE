'use strict';

/**
 * Server-side PDF generation via headless Chrome (Puppeteer).
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function resolveChromePath() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    'No Chrome/Chromium executable found. ' +
    'Set CHROME_PATH in your environment or install Chromium in the Docker image.'
  );
}

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
];

async function waitForPageAssets(page, timeoutMs = 15_000) {
  try {
    await page.evaluate(async (timeout) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const withTimeout = (p) => Promise.race([p, sleep(timeout)]);

      const doc = globalThis.document;
      if (doc && doc.fonts && doc.fonts.ready) {
        await withTimeout(doc.fonts.ready);
      }

      const imgs = Array.from((doc && doc.images) || []);
      await Promise.all(imgs.map((img) => {
        if (img.complete) return null;
        return withTimeout(new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }));
      }));
    }, timeoutMs);
  } catch (_) {}
}

async function generatePdf(url, settleMs = 1000) {
  function isRetriablePdfError(message) {
    const msg = String(message || '');
    return /frame was detached|Target closed|Protocol error \(Page\.printToPDF\)|Navigation failed because browser has disconnected|Execution context is not available|context is not available in detached frame|Execution context was destroyed|Cannot find context with specified id/i.test(msg);
  }

  function withLiteMode(u) {
    const s = String(u || '');
    return s.includes('?') ? (s + '&mode=lite') : (s + '?mode=lite');
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const browser = await puppeteer.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: LAUNCH_ARGS,
    });

    const page = await browser.newPage();
    try {
      const deviceScaleFactor = attempt === 1 ? 1.5 : 1;
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor });
      try { await page.emulateMediaType('print'); } catch (_) {}

      const waitUntil = attempt === 1 ? 'networkidle0' : 'domcontentloaded';
      const navUrl = attempt === 3 ? withLiteMode(url) : url;
      if (attempt === 3) {
        try { await page.setJavaScriptEnabled(false); } catch (_) {}
      }
      await page.goto(navUrl, { waitUntil, timeout: 60_000 });

      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, settleMs));
      } else if (attempt === 2) {
        await waitForPageAssets(page, 15_000);
      } else {
        await new Promise((r) => setTimeout(r, 250));
      }

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        headerTemplate: '',
        footerTemplate: '',
        margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
      });
      return Buffer.from(pdf);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      const retriable = isRetriablePdfError(msg);
      if (!retriable || attempt === 3) throw err;
    } finally {
      try { await page.close(); } catch (_) {}
      try { await browser.close(); } catch (_) {}
    }
  }
}

module.exports = { generatePdf, resolveChromePath };
