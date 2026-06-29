/**
 * Billing / Stripe checkout UI controller.
 *
 * Single responsibility: show Embedded Checkout in an M3 modal, and help the
 * user claim/unlock after payment. This module is intentionally UI-only:
 * - It does NOT know about Software Architecture topics rendering.
 * - Callers inject callbacks for auth + post-claim refresh.
 */
import { showToast } from './toast.js';

let _stripePublishableKey = null;
let _embeddedCheckout = null;
let _stripeDialog = null;
let _billingSupportDialog = null;
let _billingSuccessDialog = null;

async function getStripePublishableKey() {
  if (_stripePublishableKey !== null) return _stripePublishableKey;
  try {
    const res = await fetch('/api/billing/public-config', { credentials: 'same-origin' });
    const data = await res.json().catch(function () { return null; });
    _stripePublishableKey = (data && data.publishableKey) ? String(data.publishableKey) : '';
  } catch (_) {
    _stripePublishableKey = '';
  }
  return _stripePublishableKey;
}

function ensureStripeDialog() {
  if (_stripeDialog && _stripeDialog.isConnected) return _stripeDialog;

  const dlg = document.createElement('md-dialog');
  dlg.className = 'stripe-checkout-dialog';
  dlg.id = 'stripeCheckoutDialog';
  dlg.innerHTML = `
    <div slot="headline" class="stripe-checkout-head">
      <span>Complete payment</span>
      <button type="button" class="stripe-checkout-close" aria-label="Close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <div slot="content" class="stripe-checkout-body">
      <div id="stripeCheckoutMount" class="stripe-checkout-mount"></div>
    </div>
  `;
  document.body.appendChild(dlg);

  const closeBtn = dlg.querySelector('.stripe-checkout-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
  });

  dlg.addEventListener('close', function () {
    try {
      if (_embeddedCheckout && typeof _embeddedCheckout.destroy === 'function') _embeddedCheckout.destroy();
    } catch (_) {}
    _embeddedCheckout = null;
    const mount = dlg.querySelector('#stripeCheckoutMount');
    if (mount) mount.replaceChildren();
  });

  _stripeDialog = dlg;
  return dlg;
}

function ensureBillingSupportDialog(openContactInfo) {
  if (_billingSupportDialog && _billingSupportDialog.isConnected) return _billingSupportDialog;
  const dlg = document.createElement('md-dialog');
  dlg.className = 'stripe-checkout-dialog';
  dlg.id = 'billingSupportDialog';
  dlg.innerHTML = `
    <div slot="headline" class="stripe-checkout-head">
      <span>Payments unavailable</span>
      <button type="button" class="stripe-checkout-close" aria-label="Close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <div slot="content" class="stripe-checkout-body">
      <p class="billing-support-copy" id="billingSupportCopy">
        We couldn’t start checkout right now. Please try again. If it continues, contact me and I’ll help you get access.
      </p>
    </div>
    <div slot="actions">
      <md-text-button id="billingSupportContactBtn">Contact</md-text-button>
      <md-filled-button id="billingSupportRetryBtn">Try again</md-filled-button>
    </div>
  `;
  document.body.appendChild(dlg);

  const closeBtn = dlg.querySelector('.stripe-checkout-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
  });

  const contactBtn = dlg.querySelector('#billingSupportContactBtn');
  if (contactBtn) contactBtn.addEventListener('click', function () {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
    if (typeof openContactInfo === 'function') openContactInfo();
  });

  _billingSupportDialog = dlg;
  return dlg;
}

function ensureBillingSuccessDialog() {
  if (_billingSuccessDialog && _billingSuccessDialog.isConnected) return _billingSuccessDialog;

  const dlg = document.createElement('md-dialog');
  dlg.className = 'billing-success-dialog';
  dlg.id = 'billingSuccessDialog';
  dlg.innerHTML = `
    <div slot="headline" class="billing-success-head">
      <span class="billing-success-title" id="billingSuccessTitle">Subscription updated</span>
      <button type="button" class="stripe-checkout-close" aria-label="Close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <div slot="content" class="billing-success-body">
      <div class="billing-success-icon" aria-hidden="true">
        <span class="material-symbols-outlined">verified</span>
      </div>
      <p class="billing-success-copy" id="billingSuccessCopy"></p>
    </div>
    <div slot="actions" class="billing-success-actions">
      <md-text-button id="billingSuccessSecondaryBtn" hidden></md-text-button>
      <md-filled-button id="billingSuccessPrimaryBtn">Continue</md-filled-button>
    </div>
  `;
  document.body.appendChild(dlg);

  const closeBtn = dlg.querySelector('.stripe-checkout-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
  });

  _billingSuccessDialog = dlg;
  return dlg;
}

function showBillingSuccess(state, deps) {
  const dlg = ensureBillingSuccessDialog();
  const title = dlg.querySelector('#billingSuccessTitle');
  const copy = dlg.querySelector('#billingSuccessCopy');
  const primary = dlg.querySelector('#billingSuccessPrimaryBtn');
  const secondary = dlg.querySelector('#billingSuccessSecondaryBtn');

  const safeState = String(state || '').trim();

  let titleText = 'Subscription updated';
  let copyText = 'You’re all set.';
  let primaryText = 'Continue';
  let secondaryText = '';
  let showSecondary = false;
  let secondaryAction = null;

  if (safeState === 'payment_received') {
    titleText = 'Payment received';
    copyText = 'Sign in to link this subscription to your account and unlock premium articles on this device.';
    primaryText = 'Sign in';
    secondaryText = 'Not now';
    showSecondary = true;
    secondaryAction = function () {};
  } else if (safeState === 'activated') {
    titleText = 'Thanks for subscribing';
    copyText = 'Premium is now unlocked. You can continue reading immediately.';
    primaryText = 'Continue reading';
    if (deps && typeof deps.openBillingPortal === 'function') {
      secondaryText = 'Manage billing';
      showSecondary = true;
      secondaryAction = function () { deps.openBillingPortal(); };
    }
  }

  if (title) title.textContent = titleText;
  if (copy) copy.textContent = copyText;

  if (secondary) {
    secondary.textContent = secondaryText || '';
    secondary.hidden = !showSecondary;
    secondary.onclick = showSecondary ? function () {
      try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
      try { if (typeof secondaryAction === 'function') secondaryAction(); } catch (_) {}
    } : null;
  }

  if (primary) {
    primary.textContent = primaryText;
    primary.onclick = function () {
      try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
      if (safeState === 'payment_received') {
        const showWelcomeOverlay = deps && deps.showWelcomeOverlay;
        if (typeof showWelcomeOverlay === 'function') showWelcomeOverlay();
      }
    };
  }

  if (typeof dlg.show === 'function') dlg.show();
  else dlg.removeAttribute('hidden');
}

function showBillingSupport(message, deps) {
  const dlg = ensureBillingSupportDialog(deps && deps.openContactInfo);
  const copy = dlg.querySelector('#billingSupportCopy');
  if (copy) copy.textContent = message || 'We couldn’t start checkout right now. Please try again.';

  const retry = dlg.querySelector('#billingSupportRetryBtn');
  if (retry) {
    retry.onclick = function () {
      try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
      openBillingCheckoutModal(deps).catch(function (err) {
        if (err && !err.toastShown) showToast(err.message || 'Checkout failed.', { kind: 'error' });
      });
    };
  }

  if (typeof dlg.show === 'function') dlg.show();
  else dlg.removeAttribute('hidden');
}

/**
 * Opens Stripe Embedded Checkout in a modal.
 *
 * Uses the guest checkout-session endpoint for robustness.
 * The purchase is linked to a user account later via `claimCheckoutSession()`.
 */
export async function openBillingCheckoutModal(deps) {
  const plan = deps && deps.plan ? String(deps.plan) : 'monthly';
  const pk = await getStripePublishableKey();
  if (!pk) {
    // Local-dev fallback: allow redirect checkout without Stripe.js publishable key.
    const isLocalhost = (location && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
    if (isLocalhost) {
      const resp = await fetch('/api/billing/checkout-session-guest-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ plan, uiMode: 'redirect' }),
      });
      const data = await resp.json().catch(function () { return null; });
      if (resp.ok && data && data.url) {
        showToast('Opening Stripe Checkout (local dev fallback).', { kind: 'info', duration: 3500 });
        location.href = String(data.url);
        return;
      }
      showToast('Stripe publishable key missing (set STRIPE_PUBLISHABLE_KEY).', { kind: 'error', duration: 7000 });
      const e = new Error('Stripe publishable key missing.');
      e.toastShown = true;
      throw e;
    }

    showToast('Stripe publishable key is missing on this environment (set STRIPE_PUBLISHABLE_KEY).', { kind: 'error', duration: 7000 });
    const e = new Error('Stripe publishable key missing.');
    e.toastShown = true;
    throw e;
  }
  if (!window.Stripe) {
    showToast('Stripe.js failed to load. Please refresh and try again.', { kind: 'error' });
    const e = new Error('Stripe.js missing.');
    e.toastShown = true;
    throw e;
  }

  async function fetchClientSecret() {
    const resp = await fetch('/api/billing/checkout-session-guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ plan, uiMode: 'embedded' }),
    });
    const data = await resp.json().catch(function () { return null; });
    if (!resp.ok || !data || !data.clientSecret) {
      const msg = (data && (data.error || data.message)) || 'Checkout failed.';
      const looksLikeStripeMissing = resp.status === 503 && /stripe/i.test(msg);
      if (looksLikeStripeMissing) throw new Error('Stripe billing isn’t enabled yet on this environment.');
      throw new Error(msg);
    }
    return String(data.clientSecret);
  }

  const dlg = ensureStripeDialog();
  if (typeof dlg.show === 'function') dlg.show();
  else dlg.removeAttribute('hidden');

  try {
    const stripe = window.Stripe(pk);
    if (typeof stripe.createEmbeddedCheckoutPage === 'function') {
      _embeddedCheckout = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret });
    } else if (typeof stripe.initEmbeddedCheckout === 'function') {
      const cs = await fetchClientSecret();
      _embeddedCheckout = await stripe.initEmbeddedCheckout({ clientSecret: cs });
    } else {
      throw new Error('Embedded Checkout is not supported by this Stripe.js version.');
    }
    const mount = dlg.querySelector('#stripeCheckoutMount');
    if (!mount) throw new Error('Checkout mount missing.');
    _embeddedCheckout.mount(mount);
  } catch (err) {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
    showBillingSupport((err && err.message) ? err.message : 'We couldn’t start checkout right now. Please try again.', deps);
    const e = err instanceof Error ? err : new Error('Checkout init failed.');
    e.toastShown = true;
    throw e;
  }
}

export async function claimCheckoutSession(sessionId, deps) {
  const getAuthTokenOrNull = deps && deps.getAuthTokenOrNull;
  const showWelcomeOverlay = deps && deps.showWelcomeOverlay;
  const token = typeof getAuthTokenOrNull === 'function' ? await getAuthTokenOrNull() : '';
  if (!token) {
    try { sessionStorage.setItem('pending_claim_session_id', String(sessionId || '')); } catch (_) {}
    if (typeof showWelcomeOverlay === 'function') showWelcomeOverlay();
    showBillingSuccess('payment_received', deps);
    showToast('Sign in to unlock your purchase.', { kind: 'warning', duration: 6000 });
    return false;
  }

  const resp = await fetch('/api/billing/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    credentials: 'same-origin',
    body: JSON.stringify({ sessionId }),
  });
  const data = await resp.json().catch(function () { return null; });
  if (!resp.ok || !data || data.success !== true) {
    const msg = (data && (data.error || data.message)) || 'Claim failed.';
    showToast(msg, { kind: 'error', duration: 7000 });
    return false;
  }

  showToast('Subscription activated. Premium is now unlocked.', { kind: 'success', duration: 6000 });
  showBillingSuccess('activated', deps);
  try { sessionStorage.removeItem('pending_claim_session_id'); } catch (_) {}
  return true;
}

/**
 * Handles Stripe return_url and auto-claim behavior.
 * Call this once on page init.
 */
export function initBillingClaimFlow(deps) {
  const getCredential = deps && deps.getCredential;
  const onClaimed = deps && deps.onClaimed;
  const showWelcomeOverlay = deps && deps.showWelcomeOverlay;

  // On return from Stripe, capture session_id and prompt sign-in/claim.
  try {
    const qs = new URLSearchParams(location.search || '');
    const checkout = qs.get('checkout');
    const sessionId = qs.get('session_id');
    if (checkout === 'return' && sessionId) {
      try { sessionStorage.setItem('pending_claim_session_id', sessionId); } catch (_) {}
      qs.delete('checkout');
      qs.delete('session_id');
      const clean = location.pathname + (qs.toString() ? '?' + qs.toString() : '');
      history.replaceState({}, '', clean);

      const cred = typeof getCredential === 'function' ? getCredential() : null;
      if (cred) {
        claimCheckoutSession(sessionId, deps).then(function (ok) {
          if (ok && typeof onClaimed === 'function') onClaimed();
        }).catch(function () {});
      } else if (typeof showWelcomeOverlay === 'function') {
        showBillingSuccess('payment_received', deps);
        showToast('Payment received. Sign in to unlock premium on this account.', { kind: 'success', duration: 8000 });
        showWelcomeOverlay();
      }
    }
  } catch (_) {}

  // If payment completed earlier, auto-claim once the user signs in.
  try {
    let tries = 0;
    const timer = setInterval(function () {
      tries += 1;
      let pending = '';
      try { pending = sessionStorage.getItem('pending_claim_session_id') || ''; } catch (_) {}
      if (!pending) { clearInterval(timer); return; }
      const cred = typeof getCredential === 'function' ? getCredential() : null;
      if (cred) {
        clearInterval(timer);
        claimCheckoutSession(pending, deps).then(function (ok) {
          if (ok && typeof onClaimed === 'function') onClaimed();
        }).catch(function () {});
        return;
      }
      if (tries > 180) clearInterval(timer); // ~90s
    }, 500);
  } catch (_) {}
}

