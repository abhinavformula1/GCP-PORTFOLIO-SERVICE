'use strict';

const { AppError } = require('../../../domain/errors');

function createBillingWebhookHandler({ billing, webhookSecret }) {
function assertWebhookConfigured() {
  if (!billing.isStripeConfigured()) {
    throw new AppError('Stripe is not configured.', 503, 'STRIPE_NOT_CONFIGURED');
  }
  if (!webhookSecret) {
    throw new AppError('Missing STRIPE_WEBHOOK_SECRET.', 503, 'STRIPE_WEBHOOK_NOT_CONFIGURED');
  }
}

async function handleStripeEvent(evt) {
  const type = String(evt.type || '');
  const obj = evt.data && evt.data.object ? evt.data.object : {};

  if (type === 'checkout.session.completed') {
    // Checkout session includes subscription + customer IDs.
    await billing.upsertStripeCheckoutCompleted(obj);
    return;
  }

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    await billing.upsertStripeSubscription(obj);
    return;
  }

  if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
    await billing.appendStripeInvoiceEvent(obj, type);
    return;
  }

  // Ignore other events for now.
}

async function billingWebhookHandler(req, res, next) {
  try {
    assertWebhookConfigured();
    const sig = req.headers['stripe-signature'];
    if (!sig) throw new AppError('Missing Stripe-Signature header.', 400, 'BAD_REQUEST');

    // req.body MUST be the raw Buffer here (wired in src/main/server.js).
    const event = billing.constructWebhookEvent(req.body, sig, webhookSecret);

    await handleStripeEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    return next(err);
  }
}

  return billingWebhookHandler;
}

module.exports = { createBillingWebhookHandler };

