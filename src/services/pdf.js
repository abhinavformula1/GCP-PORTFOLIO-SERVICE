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
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    // Real HTTP URL — no hash routing, no SPA, no frame detachment.
    // networkidle0 waits until ALL requests (including GCS images) finish.
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
    await new Promise(r => setTimeout(r, settleMs));

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
