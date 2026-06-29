import { showToast } from './toast.js';

let _dlg = null;

function money(amountCents, currency) {
  const cur = String(currency || '').toUpperCase();
  const amt = Number(amountCents || 0);
  if (!cur || !amt) return '';
  const major = (amt / 100);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch (_) {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function intervalText(sub) {
  const i = String(sub && sub.interval || '').trim();
  const c = Number(sub && sub.intervalCount || 1) || 1;
  if (!i) return '';
  if (c === 1) return i;
  return `${c} ${i}${c > 1 ? 's' : ''}`;
}

function dateText(ms) {
  const t = Number(ms || 0);
  if (!t) return '';
  try {
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
  } catch (_) {
    return new Date(t).toDateString();
  }
}

function ensureDialog() {
  if (_dlg && _dlg.isConnected) return _dlg;
  const dlg = document.createElement('md-dialog');
  dlg.className = 'billing-account-dialog';
  dlg.id = 'billingAccountDialog';
  dlg.innerHTML = `
    <div slot="headline" class="billing-account-head">
      <span>Billing & subscription</span>
      <button type="button" class="stripe-checkout-close" aria-label="Close">
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
    <div slot="content" class="billing-account-body">
      <div class="billing-account-kpi">
        <div class="billing-account-status" id="billingAccountStatus"></div>
        <div class="billing-account-plan" id="billingAccountPlan"></div>
        <div class="billing-account-meta" id="billingAccountMeta"></div>
      </div>
      <div class="billing-account-hint" id="billingAccountHint"></div>
    </div>
    <div slot="actions" class="billing-account-actions">
      <md-text-button id="billingAccountSecondaryBtn" hidden></md-text-button>
      <md-filled-button id="billingAccountPrimaryBtn">Manage</md-filled-button>
    </div>
  `;
  document.body.appendChild(dlg);

  const closeBtn = dlg.querySelector('.stripe-checkout-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
  });

  _dlg = dlg;
  return dlg;
}

export async function openBillingAccountDialog(deps) {
  const dlg = ensureDialog();
  const profile = deps && deps.profile ? deps.profile : null;
  const openPortal = deps && deps.openPortal;
  const openCheckout = deps && deps.openCheckout;
  const showWelcomeOverlay = deps && deps.showWelcomeOverlay;

  const statusEl = dlg.querySelector('#billingAccountStatus');
  const planEl = dlg.querySelector('#billingAccountPlan');
  const metaEl = dlg.querySelector('#billingAccountMeta');
  const hintEl = dlg.querySelector('#billingAccountHint');
  const primary = dlg.querySelector('#billingAccountPrimaryBtn');
  const secondary = dlg.querySelector('#billingAccountSecondaryBtn');

  const sub = (profile && profile.subscription) ? profile.subscription : null;
  const signedIn = !!(profile && profile.type !== 'guest' && profile.email);

  const active = !!(sub && sub.active);
  const status = String(sub && sub.status || (signedIn ? 'none' : 'guest'));

  let statusLabel = active ? 'Active' : (status === 'trialing' ? 'Trial' : 'Not active');
  if (!signedIn) statusLabel = 'Sign in required';
  if (statusEl) statusEl.textContent = statusLabel;

  const planParts = [];
  const price = money(sub && sub.amount, sub && sub.currency);
  const iv = intervalText(sub);
  if (price && iv) planParts.push(`${price} / ${iv}`);
  else if (price) planParts.push(price);
  if (sub && sub.planNickname) planParts.unshift(String(sub.planNickname));
  if (planEl) planEl.textContent = planParts.join(' — ') || (active ? 'Premium subscription' : 'No active subscription');

  const metaParts = [];
  if (active && sub && sub.currentPeriodEnd) {
    metaParts.push((sub.cancelAtPeriodEnd ? 'Ends' : 'Renews') + ' ' + dateText(sub.currentPeriodEnd));
  }
  if (metaEl) metaEl.textContent = metaParts.join(' • ');

  if (hintEl) {
    hintEl.textContent = active
      ? 'Open invoices, update your card, or cancel anytime.'
      : (signedIn ? 'Subscribe to unlock premium articles.' : 'Sign in to manage billing and invoices.');
  }

  async function doOpenPortalOrFallback() {
    if (!signedIn) {
      if (typeof showWelcomeOverlay === 'function') showWelcomeOverlay();
      return;
    }
    if (typeof openPortal === 'function') {
      const ok = await openPortal().catch(function () { return false; });
      if (ok) return;
    }
    if (!active && typeof openCheckout === 'function') {
      await openCheckout().catch(function () {});
      return;
    }
    showToast('Billing portal is unavailable right now. Please try again.', { kind: 'error', duration: 6000 });
  }

  if (secondary) {
    secondary.hidden = true;
    secondary.onclick = null;
  }

  if (primary) {
    primary.textContent = active ? 'Billing & invoices' : (signedIn ? 'Subscribe' : 'Sign in');
    primary.onclick = function () {
      try { if (typeof dlg.close === 'function') dlg.close(); } catch (_) {}
      doOpenPortalOrFallback();
    };
  }

  if (typeof dlg.show === 'function') dlg.show();
  else dlg.removeAttribute('hidden');
}

