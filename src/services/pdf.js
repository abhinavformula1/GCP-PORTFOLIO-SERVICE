'use strict';

/**
 * Generic server-side PDF generation via headless Chrome (Puppeteer).
 *
 * Decoupled from any specific page or route — the caller passes:
 *   - url          : full URL to render
 *   - readySelector: CSS selector to wait for before capturing (default: 'body')
 *   - printClass   : CSS class to add to <body> for print-mode styles (optional)
 *   - filename     : suggested download filename
 *
 * Why server-side instead of window.print()?
 *   window.print() cannot suppress Chrome's built-in URL/date/page-number headers.
 *   Puppeteer's page.pdf() exposes displayHeaderFooter: false — zero browser chrome.
 *
 * Chrome path resolution:
 *   1. CHROME_PATH env var  (set in .env for local macOS dev)
 *   2. /usr/bin/google-chrome-stable  (Dockerfile, Cloud Run)
 *   3. /usr/bin/google-chrome
 *   4. /usr/bin/chromium / chromium-browser
 *   5. macOS app bundle (local fallback)
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
  '--disable-dev-shm-usage',       // use /tmp instead of /dev/shm (Cloud Run limit)
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
  format:               'A4',
  printBackground:      true,
  displayHeaderFooter:  false,   // zero browser chrome (URL, date, page numbers)
  headerTemplate:       '',
  footerTemplate:       '',
  margin: { top: '18mm', right: '18mm', bottom: '22mm', left: '18mm' },
};

/**
 * Render any URL on this service to a PDF.
 *
 * @param {object} opts
 * @param {string}   opts.url           - Full URL to render.
 * @param {string}  [opts.readySelector]- Wait for this selector before capture.
 * @param {string}  [opts.printClass]   - CSS class to add to <body> for print styles.
 * @param {string}  [opts.headerHtml]   - HTML string injected before the ready element.
 * @param {number}  [opts.settleMs]     - Extra ms to wait after selector (default 2400).
 * @returns {Promise<Buffer>}            - Raw PDF bytes.
 */
async function generatePdf({ url, readySelector = 'body', printClass, headerHtml, settleMs = 2400 }) {
  const executablePath = resolveChromePath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();

    // A4 width at 96 dpi ≈ 794 px; deviceScaleFactor 1.5 for sharper text.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    // Navigate. 'load' is more stable than 'networkidle0' on Cloud Run gVisor.
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

    // Wait for the content the caller cares about.
    await page.waitForSelector(readySelector, { timeout: 20_000 });

    // Extra settle time: lets images/fonts load from GCS / CDN.
    // Fixed delay is more stable than Promise-based event listeners inside evaluate.
    await new Promise(r => setTimeout(r, settleMs));

    // Inject print class + branded header.
    // Wrapped in try/catch — a frame hiccup here must not abort the PDF job.
    if (printClass || headerHtml) {
      const cls        = printClass  || '';
      const headerFrag = headerHtml  || '';
      try {
        await page.evaluate(`(function () {
          if ('${cls}') document.body.classList.add('${cls}');

          if (${JSON.stringify(Boolean(headerHtml))}) {
            var existing = document.getElementById('pdf-injected-header');
            if (existing) existing.remove();
            var hdr = document.createElement('div');
            hdr.id = 'pdf-injected-header';
            hdr.innerHTML = ${JSON.stringify(headerFrag)};
            var first = document.body.firstElementChild;
            if (first) document.body.insertBefore(hdr, first);
            else document.body.prepend(hdr);
          }
        })()`);
      } catch (_) { /* frame hiccup — continue without header */ }
    }

    // Final CSS settle.
    await new Promise(r => setTimeout(r, 400));

    // page.pdf() returns Uint8Array in Puppeteer v21+.
    // Buffer.from() is required so Express res.send() sends binary, not JSON.
    return Buffer.from(await page.pdf(PDF_OPTIONS));
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf, resolveChromePath };
