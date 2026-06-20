'use strict';

/**
 * Server-side PDF via headless Chrome.
 *
 * page.pdf() applies @media print rules automatically — no page.evaluate()
 * needed.  Removing all evaluate() calls eliminates the "detached frame"
 * errors that Puppeteer v25 throws when the URL hash changes during SPA
 * routing.
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
 * @param {object} opts
 * @param {string}  opts.url           - Full URL to render (including hash for SPAs).
 * @param {string} [opts.readySelector]- CSS selector to wait for before capture.
 * @param {number} [opts.settleMs]     - Extra ms after selector fires (default 2500).
 * @returns {Promise<Buffer>}
 */
async function generatePdf({ url, readySelector = 'body', settleMs = 2500 }) {
  const browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

    if (readySelector !== 'body') {
      await page.waitForSelector(readySelector, { timeout: 20_000 });
    }

    // Let images / late API calls finish before capturing.
    await new Promise(r => setTimeout(r, settleMs));

    // page.pdf() triggers @media print automatically — no evaluate() needed.
    // Buffer.from() required: Puppeteer v21+ returns Uint8Array, not Buffer;
    // Express res.send() would JSON-serialise a Uint8Array as { "0":37, ... }.
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

module.exports = { generatePdf, resolveChromePath };
