'use strict';

// Load .env in development (no-op in production — Cloud Run injects env vars directly)
require('dotenv').config();

// Prevent Firestore's background gRPC auth probe from crashing the process
// in local dev where GCP credentials are not configured.
// On Cloud Run the service account provides credentials automatically.
process.on('unhandledRejection', (reason) => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[dev] Unhandled rejection (non-fatal locally):', reason?.message || reason);
  } else {
    throw reason;
  }
});

const express      = require('express');
const path         = require('path');
const config       = require('./src/config');
const hireRoute           = require('./src/routes/hire');
const questionRoute       = require('./src/routes/question');
const recommendationRoute = require('./src/routes/recommendation');
const summariseRoute      = require('./src/routes/summarise');
const salesforceRoute     = require('./src/routes/salesforce');
const sessionRoute        = require('./src/routes/session');
const chatRoute           = require('./src/routes/chat');
const atlasRoute          = require('./src/routes/atlas');
const systemDesignRoute   = require('./src/routes/software-architecture');
const mediaRoute          = require('./src/routes/media');
const pdfRoute            = require('./src/routes/pdf');
const printRoute          = require('./src/routes/print');
const { errorHandler } = require('./src/middleware/errorHandler');

const app  = express();
const PORT = config.server.port;

// Trust Cloud Run's load balancer (fixes X-Forwarded-For for rate limiting)
app.set('trust proxy', 1);

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Static assets (everything in public/ is served automatically) ─────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check (Cloud Run / Kubernetes liveness probe) ──────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', env: config.server.env });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', hireRoute);
app.use('/api', questionRoute);
app.use('/api', recommendationRoute);
app.use('/api', summariseRoute);
app.use('/api', salesforceRoute);
app.use('/api', sessionRoute);
app.use('/api', chatRoute);
app.use('/api', atlasRoute);
app.use('/api', systemDesignRoute);
app.use('/api', mediaRoute);
app.use('/api/pdf', pdfRoute);
app.use('/print',   printRoute);

// ── Sitemap ───────────────────────────────────────────────────────────────────
// Dynamic sitemap that includes static pages + all published System Design
// articles so Google can discover every /system-design/<id> page.
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const firestore = require('./src/services/firestore');
    // Respect admin SEO toggle — return 404 if sitemap is disabled
    let seoConfig = {};
    try { seoConfig = await firestore.getSeoConfig(); } catch (_) {}
    if (seoConfig.sitemapEnabled === false) {
      return res.status(404).send('Not found');
    }
    const base = seoConfig.siteUrl
      || process.env.SITE_URL
      || 'https://portfolio-service-647206478056.asia-southeast1.run.app';
    let articles = [];
    try {
      articles = await firestore.listPublishedSystemDesignArticles();
    } catch (_) { /* non-fatal — sitemap still serves static pages */ }

    const now = new Date().toISOString().slice(0, 10);
    const articleUrls = articles
      .filter((a) => !a.stub)
      .map((a) => `  <url>
    <loc>${base}/system-design/${a.id}</loc>
    <lastmod>${a.updatedAt ? new Date(a.updatedAt).toISOString().slice(0, 10) : now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${base}/system-design</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
${articleUrls}
</urlset>`;
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} [${config.server.env}]`);
});
