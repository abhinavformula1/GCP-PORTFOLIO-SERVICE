'use strict';

/**
 * Server-side PDF generation via headless Chrome (Puppeteer).
 *
 * Why server-side instead of window.print()?
 *   window.print() cannot suppress Chrome's built-in "Headers and footers"
 *   (URL, date, page number) — that is a browser UI control outside CSS.
 *   Puppeteer's page.pdf() exposes displayHeaderFooter: false, giving us a
 *   completely clean, branded output every time with zero user steps.
 *
 * Chrome path resolution order:
 *   1. CHROME_PATH env var  (set this in .env for local macOS dev)
 *   2. /usr/bin/chromium    (Alpine/Debian Docker image)
 *   3. /usr/bin/chromium-browser (some Alpine builds)
 */

const puppeteer = require('puppeteer-core');
const fs        = require('fs');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  // macOS fallback for local dev
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

/**
 * Generate a PDF for a single System Design article.
 *
 * @param {string} articleId  - The article slug / Firestore document ID.
 * @param {string} baseUrl    - The base URL of this service (e.g. https://…run.app)
 * @returns {Promise<Buffer>} - Raw PDF bytes.
 */
async function generateArticlePdf(articleId, baseUrl) {
  const executablePath = resolveChromePath();

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-zygote',
      // Note: --single-process is intentionally excluded; it corrupts PDF output.
    ],
  });

  try {
    const page = await browser.newPage();

    // Viewport matches A4 width at 96 dpi ≈ 794px
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1.5 });

    const url = `${baseUrl}/#/system-design/${encodeURIComponent(articleId)}`;

    // 1. Navigate to the article; networkidle0 catches the Firestore fetch.
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });

    // 2. Wait until the article body has actually rendered into the DOM.
    await page.waitForSelector('.sd-article-body', { timeout: 15_000 });

    // 3. Activate the print-mode class (applies our @media print stylesheet).
    //    Passed as a string so ESLint (Node context) does not flag browser globals
    //    like `document` — this code executes inside headless Chrome, not Node.
    await page.evaluate(`(function () {
      document.body.classList.add('sd-printing');

      var existing = document.getElementById('sd-print-header');
      if (existing) existing.remove();

      var dateStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      var header = document.createElement('div');
      header.id = 'sd-print-header';
      header.className = 'sd-print-header';
      header.setAttribute('aria-hidden', 'true');
      header.innerHTML =
        '<span class="sd-print-header-brand">Abhinav Kumar \u2014 System Design</span>' +
        '<span class="sd-print-header-date">' + dateStr + '</span>';

      var article = document.querySelector('.sd-article');
      if (article) article.insertAdjacentElement('beforebegin', header);
      else document.body.prepend(header);
    })()`);

    // Brief settle for CSS transitions and print-class reflows.
    await new Promise(r => setTimeout(r, 400));

    // 4. Generate PDF — no browser chrome, exact A4, background colors preserved.
    // page.pdf() returns Uint8Array in Puppeteer v21+. Wrap with Buffer.from()
    // so Express res.send() treats it as binary, not a JSON-serialised object.
    const pdfBuffer = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,   // ← this is the key: zero browser chrome
      headerTemplate: '',
      footerTemplate: '',
      margin: {
        top:    '18mm',
        right:  '18mm',
        bottom: '22mm',
        left:   '18mm',
      },
    }));

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = { generateArticlePdf };
