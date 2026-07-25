'use strict';

const Stripe = require('stripe');
const { AppError } = require('../../domain/errors');

function createStripeClient({ config, createClient = (key) => new Stripe(key, { apiVersion: '2024-06-20' }) }) {
if (!config || !config.stripe) {
  throw new TypeError('stripeClient.config.stripe is required');
}
if (typeof createClient !== 'function') {
  throw new TypeError('stripeClient.createClient must be a function');
}
let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!config.stripe.secretKey) {
    throw new AppError('Stripe is not configured. Missing STRIPE_SECRET_KEY.', 503, 'STRIPE_NOT_CONFIGURED');
  }
  _stripe = createClient(config.stripe.secretKey);
  return _stripe;
}

function isStripeConfigured() {
  return !!config.stripe.secretKey;
}

  return Object.freeze({ getStripe, isStripeConfigured });
}

module.exports = { createStripeClient };
