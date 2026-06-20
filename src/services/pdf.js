'use strict';

/**
 * Generic server-side PDF generation via headless Chrome (Puppeteer).
 *
 * Decoupled from any specific page — the caller passes the URL, a CSS selector
 * to wait for, an optional print class, and optional header HTML.
 *
 * KEY DESIGN DECISION — two-step SPA navigation:
 *   page.goto('https://host/#/some/path') causes Puppeteer v25 to track a
 *   secondary frame for the hash fragment.  When page.pdf() fires later,
 *   that frame is marked "detached" → "Execution context is not available".
 *
 *   Fix: navigate to the base URL first (stable frame), then set window.location.hash
 *   via page.evaluate().  Changing the hash does NOT trigger a full Puppeteer
 *   navigation — it only fires hashchange, which the SPA handles internally.
 *   Puppeteer keeps the same frame throughout.
 *
 * Chrome path resolution:
 *   1. CHROME_PATH env var  (set in .env for local macOS dev)
 *   2. /usr/bin/google-chrome-stable  (Dockerfile / Cloud Run)
 *   3. /usr/bin/google-chrome
 *   4. /usr/bin/chromium / chromium-browser
 *   5. macOS app bundle  (local dev fallback)
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
  '--disable-dev-shm-usage',        // use /tmp instead of /dev/shm (Cloud Run limit)
  '--disable-gpu',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  // --no-zygote    : removed — crashes renderer on Cloud Run gVisor sandbox
  // --single-process: removed — corrupts PDF output
];

const PDF_OPTIONS = {
  format:              'A4',
  printBackground:     true,
  displayHeaderFooter: false,   // zero browser chrome (URL, date, page numbers)
  headerTemplate:      '',
  footerTemplate:      '',
  margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
};

/**
 * Render a page to PDF.
 *
 * @param {object} opts
 * @param {string}   opts.baseUrl      - Origin only: https://host (no path/hash).
 * @param {string}  [opts.hash]        - Hash fragment to set after load: '#/some/path'.
 *                                       Setting the hash via JS avoids the Puppeteer
 *                                       detached-frame bug with hash-based SPAs.
 * @param {string}  [opts.readySelector] - Wait for this selector before capture.
 * @param {string}  [opts.printClass]  - CSS class to add to <body> for print styles.
 * @param {string}  [opts.headerHtml]  - HTML prepended to <body> before capture.
 * @param {number}  [opts.settleMs]    - Extra ms after selector (default 2000).
 * @returns {Promise<Buffer>}           - Raw PDF bytes.
 */
async function generatePdf({ baseUrl, hash, readySelector = 'body', printClass, headerHtml, settleMs = 2000 }) {
  const executablePath = resolveChromePath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();

    // A4 width at 96 dpi ≈ 794 px; deviceScaleFactor 1.5 for sharp text/borders.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    // ── Step 1: navigate to base URL — Puppeteer gets a stable, non-detaching frame.
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 30_000 });

    // ── Step 2: if a hash is provided, set it via JS (hashchange, not navigation).
    //    This triggers the SPA routing without Puppeteer creating a new frame.
    if (hash) {
      await page.evaluate('window.location.hash = ' + JSON.stringify(hash));
    }

    // ── Step 3: wait for the content the caller cares about.
    if (readySelector !== 'body') {
      await page.waitForSelector(readySelector, { timeout: 20_000 });
    }

    // ── Step 4: let images (GCS), fonts, and late API calls finish.
    await new Promise(r => setTimeout(r, settleMs));

    // ── Step 5: inject print class + branded header.
    //    try/catch: a transient evaluate hiccup must not abort the PDF job.
    if (printClass || headerHtml) {
      const addClassScript = printClass
        ? `document.body.classList.add(${JSON.stringify(printClass)});`
        : '';
      const addHeaderScript = headerHtml ? `
        var _existing = document.getElementById('pdf-injected-header');
        if (_existing) _existing.remove();
        var _hdr = document.createElement('div');
        _hdr.id = 'pdf-injected-header';
        _hdr.innerHTML = ${JSON.stringify(headerHtml)};
        var _first = document.body.firstElementChild;
        if (_first) document.body.insertBefore(_hdr, _first);
        else document.body.prepend(_hdr);
      ` : '';

      try {
        await page.evaluate(`(function(){${addClassScript}${addHeaderScript}})()`);
      } catch (_) { /* frame hiccup — PDF continues without injected header */ }
    }

    // ── Step 6: final CSS reflow settle.
    await new Promise(r => setTimeout(r, 400));

    // ── Step 7: generate PDF.
    // page.pdf() returns Uint8Array in Puppeteer v21+; Buffer.from() ensures
    // Express res.send() treats it as binary data, not a JSON-serialised object.
    return Buffer.from(await page.pdf(PDF_OPTIONS));

  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf, resolveChromePath };
