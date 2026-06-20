'use strict';

/**
 * Server-side PDF generation via headless Chrome (Puppeteer).
 *
 * Uses page.setContent(html) instead of page.goto(url).
 *
 * Why this matters:
 *   page.goto() on a hash-route SPA URL causes Puppeteer v25 to track the
 *   hash fragment as a navigation event, which invalidates the execution
 *   context and throws "detached frame" on every subsequent page call.
 *
 *   page.setContent() does NOT navigate — it writes HTML directly into the
 *   page.  No URL changes, no frame detachment, no race conditions.
 *   The full site CSS is embedded in the HTML by articleHtml.js, so
 *   @media print styles apply exactly as in the browser.
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

/**
 * @param {string} html      - Complete HTML document to render.
 * @param {number} [settleMs]- Ms to wait after setContent (default 1500).
 * @returns {Promise<Buffer>}
 */
async function generatePdfFromHtml(html, settleMs = 1500) {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    // setContent writes HTML directly — no URL navigation, no frame detachment.
    await page.setContent(html, { waitUntil: 'load' });

    // Wait for images (GCS URLs embedded in the HTML) to load.
    await new Promise(r => setTimeout(r, settleMs));

    // page.pdf() returns Uint8Array in Puppeteer v21+.
    // Buffer.from() required so Express res.send() sends binary data.
    return Buffer.from(await page.pdf({
      format:              'A4',
      printBackground:     true,
      displayHeaderFooter: false,
      headerTemplate:      '',
      footerTemplate:      '',
      margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
    }));
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdfFromHtml, resolveChromePath };
