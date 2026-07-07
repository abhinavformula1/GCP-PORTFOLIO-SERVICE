/**
 * pricing.js — Pricing page controller.
 *
 * Responsibilities:
 *   1. Bootstrap shared app header (language, theme toggle, sign-in button)
 *   2. Bootstrap shared tech footer
 *   3. Render price cards via the reusable price-card.js component
 *   4. Load tier feature labels from /api/system-design/tier-config
 *   5. Wire Subscribe button → Stripe guest checkout redirect
 *   6. Wire Sign-in buttons → reusable welcome overlay with Google Sign-In
 */

import { initTheme }                                    from '/assets/core/theme.js';
import { renderAppHeader }                              from '/assets/ui/app-header.js';
import { renderTechFooter }                             from '/assets/ui/footer.js';
import { renderPriceCard, updatePriceCardFeatures }     from '/assets/ui/price-card.js';
import { showWelcomeOverlay, hideWelcomeOverlay }       from '/assets/ui/welcome.js';
import { GOOGLE_CLIENT_ID }                             from '/assets/core/config.js';
import { setGoogleCredential, setSiteProfile }          from '/assets/core/state.js';

// ── Theme ─────────────────────────────────────────────────────────────────────

initTheme();

// ── Google Sign-In ────────────────────────────────────────────────────────────

let _gsiInitialized = false;

function initGoogleSignIn() {
  if (_gsiInitialized) return;
  if (typeof google === 'undefined' || !google.accounts) return;

  const container = document.getElementById('welcomeGoogleBtn');
  if (!container) return;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback:  handleGoogleSignIn,
    auto_select: false,
  });

  google.accounts.id.renderButton(container, {
    theme: 'outline',
    size:  'large',
    width: 356,
    text:  'continue_with',
  });

  _gsiInitialized = true;
}

function handleGoogleSignIn(response) {
  if (!response || !response.credential) return;
  setGoogleCredential(response.credential);

  const parts   = response.credential.split('.');
  const payload = JSON.parse(atob(parts[1]));
  const profile = {
    name:    payload.name    || '',
    email:   payload.email   || '',
    picture: payload.picture || '',
  };
  setSiteProfile(profile);
  hideWelcomeOverlay();
  window.location.href = '/';
}

function openSignInModal() {
  showWelcomeOverlay({
    noteText: 'Your details are only used to personalise the scheduling assistant.',
    onShown:  initGoogleSignIn,
  });
}

// ── Shared header ─────────────────────────────────────────────────────────────
// mode:'admin' gives just the topbar controls (language / theme / sign-in)
// WITHOUT the portfolio nav (Home, Software Architecture, Resume, Get in touch).
renderAppHeader('#sharedTopbar', {
  mode: 'admin',
  topbar: {
    signInHidden: false,
    handlers: {
      signIn: openSignInModal,
    },
  },
});

// ── Shared footer ─────────────────────────────────────────────────────────────

renderTechFooter('#pricingFooter');

// ── Subscribe handler ─────────────────────────────────────────────────────────

async function handleSubscribe(evt) {
  const btn = evt.currentTarget;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Loading…';

  try {
    const res  = await fetch('/api/billing/checkout-session-guest-redirect', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body:        JSON.stringify({ plan: 'monthly' }),
    });
    const data = await res.json().catch(function () { return null; });

    if (data && data.url) {
      window.location.href = data.url;
      return;
    }
    window.location.href = '/';
  } catch (_) {
    btn.disabled    = false;
    btn.textContent = originalText;
  }
}

// ── Render price cards ────────────────────────────────────────────────────────

renderPriceCard('#freeCardMount', {
  name:     'Free',
  price:    '$0',
  period:   '/month',
  tagline:  'For readers exploring the content.',
  ctaLabel: 'Get started free',
  ctaHref:  '/',
});

renderPriceCard('#premiumCardMount', {
  name:      'Premium',
  price:     '$29',
  period:    '/month',
  tagline:   'For professionals building on these patterns.',
  badge:     'Most popular',
  highlight: true,
  ctaLabel:  'Subscribe',
  onCta:     handleSubscribe,
});

// ── Load tier features from API ───────────────────────────────────────────────

async function loadTierFeatures() {
  try {
    const res  = await fetch('/api/system-design/tier-config');
    const data = await res.json().catch(function () { return null; });
    if (!data || !data.success) return;

    const freeItems    = (data.config && data.config.free    && data.config.free.items)    || [];
    const premiumItems = (data.config && data.config.premium && data.config.premium.items) || [];

    updatePriceCardFeatures('#freeCardMount',    freeItems.map(function (i) { return i.label || String(i); }));
    updatePriceCardFeatures('#premiumCardMount', premiumItems.map(function (i) { return i.label || String(i); }));
  } catch (_) {
    // Leave skeleton lines on error — not critical
  }
}

loadTierFeatures();

// ── Bottom "Already have an account? Sign in" button ─────────────────────────

const bottomSignInBtn = document.getElementById('bottomSignInBtn');
if (bottomSignInBtn) {
  bottomSignInBtn.addEventListener('click', openSignInModal);
}
