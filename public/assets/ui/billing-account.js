import { showToast } from './toast.js';
import { createModal } from './modal.js';
import { createEl } from './dom.js';

let _modal = null;

// ── Formatters ────────────────────────────────────────────────────────────────

function money(amountCents, currency) {
  const cur = String(currency || '').toUpperCase();
  const amt = Number(amountCents || 0);
  if (!cur || !amt) return '';
  const major = amt / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch (_) {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function intervalText(sub) {
  const i = String((sub && sub.interval) || '').trim();
  const c = Number((sub && sub.intervalCount) || 1) || 1;
  if (!i) return '';
  return c === 1 ? i : `${c} ${i}${c > 1 ? 's' : ''}`;
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

// ── Modal bootstrap (lazy, singleton) ────────────────────────────────────────

function ensureModal() {
  if (_modal && _modal.el.isConnected) return _modal;

  const statusEl  = createEl('div', { id: 'billingAccountStatus',  className: 'billing-account-status' });
  const planEl    = createEl('div', { id: 'billingAccountPlan',    className: 'billing-account-plan' });
  const metaEl    = createEl('div', { id: 'billingAccountMeta',    className: 'billing-account-meta' });
  const hintEl    = createEl('div', { id: 'billingAccountHint',    className: 'billing-account-hint' });
  const primaryBtn   = createEl('md-filled-button', { id: 'billingAccountPrimaryBtn' }, [
    createEl('span', { text: 'Manage' }),
  ]);
  const secondaryBtn = createEl('md-text-button', { id: 'billingAccountSecondaryBtn', hidden: true });

  const content = createEl('div', { className: 'billing-account-body' }, [
    createEl('div', { className: 'billing-account-kpi' }, [statusEl, planEl, metaEl]),
    hintEl,
  ]);

  _modal = createModal({
    id:        'billingAccountDialog',
    className: 'billing-account-dialog',
    title:     'Billing & subscription',
    content,
    actions:   [secondaryBtn, primaryBtn],
  });

  document.body.appendChild(_modal.el);
  return _modal;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function openBillingAccountDialog(deps) {
  const modal = ensureModal();
  const dlg   = modal.el;

  const profile          = (deps && deps.profile)          || null;
  const openPortal       = (deps && deps.openPortal)       || null;
  const openCheckout     = (deps && deps.openCheckout)     || null;
  const showWelcomeOverlay = (deps && deps.showWelcomeOverlay) || null;

  const statusEl  = dlg.querySelector('#billingAccountStatus');
  const planEl    = dlg.querySelector('#billingAccountPlan');
  const metaEl    = dlg.querySelector('#billingAccountMeta');
  const hintEl    = dlg.querySelector('#billingAccountHint');
  const primary   = dlg.querySelector('#billingAccountPrimaryBtn');
  const secondary = dlg.querySelector('#billingAccountSecondaryBtn');

  const sub      = (profile && profile.subscription) || null;
  const signedIn = !!(profile && profile.type !== 'guest' && profile.email);
  const active   = !!(sub && sub.active);
  const status   = String((sub && sub.status) || (signedIn ? 'none' : 'guest'));

  // ── Populate fields ───────────────────────────────────────────────────────
  let statusLabel = active ? 'Active' : (status === 'trialing' ? 'Trial' : 'Not active');
  if (!signedIn) statusLabel = 'Sign in required';
  if (statusEl) statusEl.textContent = statusLabel;

  const planParts = [];
  const price = money(sub && sub.amount, sub && sub.currency);
  const iv    = intervalText(sub);
  if (price && iv)            planParts.push(`${price} / ${iv}`);
  else if (price)             planParts.push(price);
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

  // ── Actions ───────────────────────────────────────────────────────────────
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
    secondary.hidden  = true;
    secondary.onclick = null;
  }

  if (primary) {
    primary.querySelector('span').textContent = active
      ? 'Billing & invoices'
      : (signedIn ? 'Subscribe' : 'Sign in');
    primary.onclick = function () {
      modal.close();
      doOpenPortalOrFallback();
    };
  }

  modal.open();
}
