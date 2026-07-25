'use strict';

const express = require('express');

function createRouter({ sfApiKey }) {
const router  = express.Router();
// Middleware: validate X-API-Key header on all /salesforce/* routes
const validateApiKey = (req, res, next) => {
  const incoming = req.headers['x-api-key'];
  const expected = sfApiKey;

  if (!expected) {
    console.error('[salesforce] SF_API_KEY env var is not set — rejecting all requests');
    return res.status(500).json({ error: 'Server misconfiguration.' });
  }

  if (!incoming || incoming !== expected) {
    console.warn('[salesforce] Rejected request — invalid or missing X-API-Key');
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  next();
};

// POST /api/salesforce/account
// Receives Account data from Salesforce @future(callout=true)
router.post('/salesforce/account', validateApiKey, (req, res) => {
  const payload = req.body;

  console.log('[salesforce] Account received:', JSON.stringify(payload, null, 2));

  return res.status(200).json({
    success:  true,
    message:  'Account received successfully.',
    received: payload,
  });
});

  return router;
}

module.exports = { createRouter };
