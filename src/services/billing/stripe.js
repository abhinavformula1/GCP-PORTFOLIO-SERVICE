'use strict';

const Stripe = require('stripe');
const config = require('../../config');
const { AppError } = require('../../errors');

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!config.stripe.secretKey) {
    throw new AppError('Stripe is not configured. Missing STRIPE_SECRET_KEY.', 503, 'STRIPE_NOT_CONFIGURED');
  }
  _stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2024-06-20' });
  return _stripe;
}

function isStripeConfigured() {
  return !!config.stripe.secretKey;
}

module.exports = { getStripe, isStripeConfigured };
