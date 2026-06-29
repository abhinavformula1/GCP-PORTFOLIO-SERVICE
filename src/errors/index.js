'use strict';

/**
 * Application error hierarchy.
 *
 * Using custom error classes (instead of raw Error) lets the global
 * errorHandler distinguish between operational errors (safe to expose
 * to the client) and programmer errors (should never reach the client).
 *
 * Pattern used at Google, Stripe, and Salesforce backend services.
 */

/** Base class for all application errors. */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name       = this.constructor.name;
    this.statusCode = statusCode;
    this.code       = code;
    // Operational = expected failure (bad input, external API down).
    // Non-operational = programmer mistake (null ref, etc.).
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Caller sent invalid input. */
class ValidationError extends AppError {
  constructor(message, fields = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.fields = fields;
  }
}

/** 502 — Downstream Salesforce API call failed. */
class SalesforceError extends AppError {
  constructor(message, detail = '') {
    super(message, 502, 'SALESFORCE_ERROR');
    this.detail = detail;
  }
}

/** 401 — Salesforce token invalid or expired (triggers retry). */
class SalesforceAuthError extends AppError {
  constructor(message = 'Salesforce authentication failed.') {
    super(message, 401, 'SALESFORCE_AUTH_ERROR');
  }
}

module.exports = {
  AppError,
  ValidationError,
  SalesforceError,
  SalesforceAuthError,
};
