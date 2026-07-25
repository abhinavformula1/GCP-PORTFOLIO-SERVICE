'use strict';

function createStripeGateway({ stripeClient }) {
  if (!stripeClient
    || typeof stripeClient.getStripe !== 'function'
    || typeof stripeClient.isStripeConfigured !== 'function') {
    throw new TypeError('stripeGateway.stripeClient requires getStripe and isStripeConfigured');
  }
  const { getStripe, isStripeConfigured } = stripeClient;
  return Object.freeze({
    isConfigured: isStripeConfigured,
    retrievePrice(id) {
      return getStripe().prices.retrieve(id);
    },
    listPromotionCodes(options) {
      return getStripe().promotionCodes.list(options);
    },
    createCheckoutSession(options) {
      return getStripe().checkout.sessions.create(options);
    },
    retrieveCheckoutSession(id) {
      return getStripe().checkout.sessions.retrieve(id);
    },
    updateSubscription(id, changes) {
      return getStripe().subscriptions.update(id, changes);
    },
    retrieveSubscription(id) {
      return getStripe().subscriptions.retrieve(id);
    },
    createBillingPortalSession(options) {
      return getStripe().billingPortal.sessions.create(options);
    },
    constructWebhookEvent(rawBody, signature, secret) {
      return getStripe().webhooks.constructEvent(rawBody, signature, secret);
    },
  });
}

module.exports = { createStripeGateway };
