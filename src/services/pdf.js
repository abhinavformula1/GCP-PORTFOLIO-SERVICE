'use strict';

/**
 * Server-side PDF generation via headless Chrome (Puppeteer).
 *
 * Uses page.goto(printUrl) where printUrl is a real HTTP URL served by our
 * own /print/system-design/:id route — NOT the SPA hash URL.
 *
 * Why this matters:
 *   - Real HTTP origin → GCS images load normally (no about:blank restrictions)
 *   - No hash routing → no Puppeteer v25 frame detachment
 *   - networkidle0 waits for ALL images to finish loading before pdf()
 */

const puppeteer = require('puppeteer-core');
const fs        = require('fs');

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
  // Best-effort: fonts + images. If anything times out, we still proceed to PDF
  // because a partial render is better than a hard failure.
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
  } catch (_) { /* ignore */ }
}

/**
 * Generate a PDF by navigating to a real server-rendered URL.
 *
 * @param {string} url      - Full URL of the print page (e.g. https://host/print/system-design/id)
 * @param {number} settleMs - Extra ms to wait after networkidle0 (default 1000)
 * @returns {Promise<Buffer>}
 */
async function generatePdf(url, settleMs = 1000) {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: LAUNCH_ARGS,
  });

  try {
    // Some pages can crash headless Chrome during navigation/print (e.g. image-heavy
    // articles). When that happens Puppeteer commonly throws:
    // - "Navigating frame was detached"
    // - "Protocol error (Page.printToPDF): Target closed"
    //
    // Retry once with a lighter render strategy (lower DPR + less strict goto wait).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const page = await browser.newPage();
      try {
        const deviceScaleFactor = attempt === 1 ? 1.5 : 1;
        await page.setViewport({ width: 794, height: 1123, deviceScaleFactor });
        // Make sure print CSS applies consistently.
        try { await page.emulateMediaType('print'); } catch (_) {}

        const waitUntil = attempt === 1 ? 'networkidle0' : 'domcontentloaded';
        await page.goto(url, { waitUntil, timeout: 60_000 });

        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, settleMs));
        } else {
          await waitForPageAssets(page, 15_000);
        }

        const pdf = await page.pdf({
          format:              'A4',
          printBackground:     true,
          displayHeaderFooter: false,
          headerTemplate:      '',
          footerTemplate:      '',
          margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
        });
        return Buffer.from(pdf);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        const retriable = /frame was detached|Target closed|Protocol error \(Page\.printToPDF\)|Navigation failed because browser has disconnected/i.test(msg);
        if (!retriable || attempt === 2) throw err;
      } finally {
        try { await page.close(); } catch (_) {}
      }
    }
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf, resolveChromePath };
