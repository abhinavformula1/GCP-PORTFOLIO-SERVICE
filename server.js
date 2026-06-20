'use strict';

// Load .env in development (no-op in production — Cloud Run injects env vars directly)
require('dotenv').config();

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
const systemDesignRoute   = require('./src/routes/systemDesign');
const mediaRoute          = require('./src/routes/media');
const pdfRoute            = require('./src/routes/pdf');
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
