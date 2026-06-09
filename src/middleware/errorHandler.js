'use strict';

const { AppError } = require('../errors');

/**
 * Global Express error handler — must be registered LAST in server.js.
 *
 * Catches every error passed via next(err) or thrown inside async routes.
 * Separates operational errors (safe to expose) from programmer errors
 * (log only, return generic 500).
 */
function errorHandler(err, req, res, _next) {
  // Operational errors — known, safe to surface to the client
  const isOperational = (err instanceof AppError && err.isOperational) || err.isOperational === true;

  if (isOperational) {
    const statusCode = err.statusCode || 500;
    const code       = err.code       || 'ERROR';

    // 503 specifically means a required service (e.g. Salesforce) is not configured
    const message = statusCode === 503
      ? 'Service temporarily unavailable. Please try again later.'
      : err.message;

    return res.status(statusCode).json({
      success: false,
      code,
      error: message,
      ...(err.fields && { fields: err.fields }),
    });
  }

  // Programmer / unexpected errors — log everything, expose nothing.
  // `err.upstream` carries truncated upstream-service response bodies
  // (e.g. raw Gemini error JSON) that we deliberately do NOT show to
  // the user, but want available in server logs for debugging.
  console.error('[ERROR]', {
    message:  err.message,
    code:     err.code,
    stack:    err.stack,
    upstream: err.upstream,
    url:      req.originalUrl,
    method:   req.method,
  });

  return res.status(500).json({
    success: false,
    code:    'INTERNAL_ERROR',
    error:   'Something went wrong on our end. Please try again later.',
  });
}

module.exports = { errorHandler };
