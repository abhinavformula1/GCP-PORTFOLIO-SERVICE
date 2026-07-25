'use strict';

const express = require('express');
const path = require('path');
const { buildComposition } = require('./composition');
const { createRuntime } = require('./runtime');
const { createCloseController } = require('./lifecycle');
const { validateRouteCapabilities } = require('./validateComposition');
const { createAuthMiddleware } = require('../interfaces/http/middleware/auth');
const { createRateLimiters } = require('../interfaces/http/middleware/rateLimiter');
const { errorHandler } = require('../interfaces/http/middleware/errorHandler');
const { createBillingWebhookHandler } = require('../interfaces/http/routes/billing-webhook');
const routeFactories = {
  hire: require('../interfaces/http/routes/hire').createRouter,
  question: require('../interfaces/http/routes/question').createRouter,
  recommendation: require('../interfaces/http/routes/recommendation').createRouter,
  summarise: require('../interfaces/http/routes/summarise').createRouter,
  salesforce: require('../interfaces/http/routes/salesforce').createRouter,
  session: require('../interfaces/http/routes/session').createRouter,
  chat: require('../interfaces/http/routes/chat').createRouter,
  atlas: require('../interfaces/http/routes/atlas').createRouter,
  systemDesign: require('../interfaces/http/routes/software-architecture').createRouter,
  media: require('../interfaces/http/routes/media').createRouter,
  pdf: require('../interfaces/http/routes/pdf').createRouter,
  print: require('../interfaces/http/routes/print').createRouter,
  analytics: require('../interfaces/http/routes/analytics').createRouter,
  billing: require('../interfaces/http/routes/billing').createRouter,
};
const appState = new WeakMap();

function createApp(options = {}) {
  const config = options.config
    || (options.services && options.services.config)
    || require('../infrastructure/config');
  const runtime = options.runtime || createRuntime(config);
  const services = options.services || buildComposition(runtime, { config });
  const { repositories } = services;
  const readiness = options.readiness || services.readiness;
  const auth = createAuthMiddleware({ authorization: services.authorization });
  const limits = createRateLimiters(config);
  const billingWebhookHandler = createBillingWebhookHandler({
    billing: services.billing,
    webhookSecret: config.stripe.webhookSecret,
  });
  const atlas = services.atlasChat;
  const software = services.softwareArchitecture;
  const media = services.mediaUseCases;
  const pdf = Object.freeze({
    generatePdf: services.httpCapabilities.pdf.generatePdf,
    checkChrome: services.httpCapabilities.pdf.checkChrome,
    getArticle: services.httpCapabilities.pdf.getArticle,
    getEntitlement: services.billing.getUserSubscriptionEntitlement,
    verifyIdToken: services.googleAuth.verifyIdToken,
    requestSecret: config.internal.requestSecret,
    siteUrl: config.stripe.siteUrl,
  });
  const print = Object.freeze({
    getArticle: services.httpCapabilities.print.getArticle,
    requestSecret: config.internal.requestSecret,
  });
  const billing = services.billingUseCases;
  validateRouteCapabilities({ auth, limits, atlas, software, media, pdf, print, billing });
  const routes = {
    hire: routeFactories.hire({ hireLimiter: limits.hireLimiter, submitHire: services.inquiries.submitHire }),
    question: routeFactories.question({ questionLimiter: limits.questionLimiter, submitQuestion: services.inquiries.submitQuestion }),
    recommendation: routeFactories.recommendation({ recommendationLimiter: limits.recommendationLimiter, recommendations: services.recommendationUseCases }),
    summarise: routeFactories.summarise({ summariseConversation: services.llm.summariseConversation }),
    salesforce: routeFactories.salesforce({ sfApiKey: runtime.sfApiKey }),
    session: routeFactories.session({ startSession: services.session.startSession }),
    chat: routeFactories.chat({ requireAuth: auth.requireAuth, chat: services.chat }),
    atlas: routeFactories.atlas({ requireAuth: auth.requireAuth, atlasLimiter: limits.atlasLimiter, atlas }),
    systemDesign: routeFactories.systemDesign({ requireAuth: auth.requireAuth, optionalAuth: auth.optionalAuth, requireAdmin: auth.requireAdmin, requireAdminAccess: auth.requireAdminAccess, software }),
    media: routeFactories.media({ requireAdmin: auth.requireAdmin, media }),
    pdf: routeFactories.pdf({ pdf }),
    print: routeFactories.print({ print }),
    analytics: routeFactories.analytics({ requireAdmin: auth.requireAdmin, analyticsTrackLimiter: limits.analyticsTrackLimiter, analytics: services.analytics }),
    billing: routeFactories.billing({ requireAuth: auth.requireAuth, requireAdmin: auth.requireAdmin, billing }),
  };

  const app = express();
  app.locals.readiness = Object.freeze({ initialized: true });
  appState.set(app, { closeHooks: services.closeHooks || [] });
  const publicDir = path.resolve(__dirname, '..', '..', 'public');

// Trust Cloud Run's load balancer (fixes X-Forwarded-For for rate limiting)
app.set('trust proxy', 1);

// ── Stripe webhook (raw body required for signature verification) ─────────────
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookHandler);

// ── Request parsing ───────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Public route redirects ────────────────────────────────────────────────────
// Software Architecture UI moved from /system-design → /software-architecture.
// Keep legacy URLs working for old bookmarks + SEO.
app.get(/^\/system-design(\/.*)?$/, (req, res) => {
  const target = req.originalUrl.replace(/^\/system-design/, '/software-architecture');
  res.redirect(301, target);
});

// ── Admin route ───────────────────────────────────────────────────────────────
// Legacy /admin/system-design URLs still work via a 301 redirect.
app.get(/^\/admin\/system-design(\/.*)?$/, (req, res) => {
  const target = req.originalUrl.replace(/^\/admin\/system-design/, '/admin/software-architecture');
  res.redirect(301, target);
});
app.use('/admin/software-architecture', express.static(path.join(publicDir, 'admin', 'software-architecture')));

// ── Static assets (everything in public/ is served automatically) ─────────────
app.use(express.static(publicDir));

// ── Health check (Cloud Run / Kubernetes liveness probe) ──────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', env: config.server.env });
});
app.get('/ready', async (_req, res) => {
  try {
    const result = await readiness.check();
    if (!result || result.ready !== true) {
      return res.status(503).json({ status: 'not-ready' });
    }
    return res.status(200).json({ status: 'ready' });
  } catch (_) {
    return res.status(503).json({ status: 'not-ready' });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', routes.hire);
app.use('/api', routes.question);
app.use('/api', routes.recommendation);
app.use('/api', routes.summarise);
app.use('/api', routes.salesforce);
app.use('/api', routes.session);
app.use('/api', routes.chat);
app.use('/api', routes.atlas);
app.use('/api', routes.systemDesign);
app.use('/api', routes.media);
app.use('/api', routes.analytics);
app.use('/api', routes.billing);
app.use('/api/pdf', routes.pdf);
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'API route not found.' });
});
app.use('/print',   routes.print);

// ── Sitemap ───────────────────────────────────────────────────────────────────
// Dynamic sitemap that includes static pages + all published Software Architecture
// articles so Google can discover every /software-architecture/<id> page.
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const adminConfig = services.adminConfig;
    const articlesRepository = repositories.articles;
    // Respect admin SEO toggle — return 404 if sitemap is disabled
    let seoConfig = {};
    try { seoConfig = await adminConfig.getSeoConfig(); } catch (_) {}
    if (seoConfig.sitemapEnabled === false) {
      return res.status(404).send('Not found');
    }
    const base = seoConfig.siteUrl
      || runtime.siteUrl
      || 'https://portfolio-service-647206478056.asia-southeast1.run.app';
    let articles = [];
    try {
      articles = await articlesRepository.listPublishedArticles();
    } catch (_) { /* non-fatal — sitemap still serves static pages */ }

    const now = new Date().toISOString().slice(0, 10);
    const articleUrls = articles
      .filter((a) => !a.stub)
      .map((a) => `  <url>
    <loc>${base}/software-architecture/${a.id}</loc>
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
    <loc>${base}/software-architecture</loc>
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

// ── LLMs.txt ─────────────────────────────────────────────────────────────────
// Emerging standard (analogous to robots.txt) that tells AI crawlers
// (ChatGPT, Claude, Perplexity, Gemini) which content to index and summarise.
// Only served when the admin has enabled it in SEO settings.
app.get('/llms.txt', async (_req, res) => {
  try {
    const adminConfig = services.adminConfig;
    const articlesRepository = repositories.articles;
    let seoConfig = {};
    try { seoConfig = await adminConfig.getSeoConfig(); } catch (_) {}
    if (!seoConfig.llmsTxtEnabled) {
      return res.status(404).send('Not found');
    }
    const base = seoConfig.siteUrl
      || runtime.siteUrl
      || 'https://portfolio-service-647206478056.asia-southeast1.run.app';
    let articles = [];
    try { articles = await articlesRepository.listPublishedArticles(); } catch (_) {}

    const articleLines = articles
      .filter((a) => !a.stub && a.tier !== 'premium')
      .map((a) => {
        const title = (a.en && a.en.title) || a.title || a.id;
        return `- [${title}](${base}/software-architecture/${a.id})`;
      })
      .join('\n');

    const txt = [
      `# ${base}`,
      '',
      '## Abhinav Kumar — Senior Salesforce Application Engineer',
      '',
      '> Portfolio and system design articles by Abhinav Kumar. 12+ years across',
      '> Salesforce, GCP, MuleSoft, and API-driven integrations.',
      '',
      '## Free articles (fully accessible)',
      '',
      articleLines || '- (No published free articles yet)',
      '',
      '## Notes for AI crawlers',
      '',
      '- Premium articles require a subscription and are not included here.',
      '- Content is written by Abhinav Kumar. Please attribute correctly.',
      `- Canonical site: ${base}`,
    ].join('\n');

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(txt);
  } catch (_err) {
    res.status(500).send('Error generating llms.txt');
  }
});


// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Global error handler (must be last) ───────────────────────────────────────
app.use(errorHandler);

  return app;
}

function startServer(options = {}) {
  const config = options.config
    || (options.services && options.services.config)
    || require('../infrastructure/config');
  const runtime = options.runtime || createRuntime(config);
  const app = createApp(Object.assign({}, options, { runtime }));
  const port = options.port == null ? config.server.port : options.port;
  const server = app.listen(port, () => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? address.port : port;
    (options.logger || console).log(`ATLAS Server running on port ${boundPort} [${config.server.env}]`);
  });
  const closeHooks = options.closeHooks || appState.get(app)?.closeHooks || [];
  const close = createCloseController({ server, closeHooks, logger: options.logger || console });
  return {
    app,
    server,
    ready: new Promise((resolve, reject) => {
      server.once('listening', () => resolve(server.address()));
      server.once('error', reject);
    }),
    address() {
      return server.address();
    },
    close,
  };
}

module.exports = { createApp, startServer };
