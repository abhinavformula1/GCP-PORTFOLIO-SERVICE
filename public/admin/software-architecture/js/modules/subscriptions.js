/**
 * Subscriptions module — Stripe subscription overview.
 * S — all subscription rendering/fetching concerns live here.
 */

import { state }                from '../state.js';
import { authedJson, setSectionStatus } from '../http.js';
import { safeText }             from '../utils.js';
import { renderKpiCards }       from '../../../../assets/ui/kpi-cards.js';
import { renderDataTable }      from '../../../../assets/ui/datatable.js';
import { showToast }            from '../../../../assets/ui/toast.js';

let _subsMenuCleanup = null;

export async function renderSubscriptions(els) {
  if (!els.subscriptionsPanel) return;
  if (state.subscriptionsState && Array.isArray(state.subscriptionsState.subscriptions)) {
    _paintSubscriptions(els);
    return;
  }
  await refreshSubscriptions(els);
}

export async function refreshSubscriptions(els) {
  if (!els.subscriptionsPanel) return;
  setSectionStatus(els.subscriptionsStatus, 'Loading subscriptions…', 'info');
  els.subscriptionsPanel.textContent = '';
  try {
    const data = await authedJson('/api/admin/subscriptions/overview');
    state.subscriptionsState = data;
    _paintSubscriptions(els);
    setSectionStatus(els.subscriptionsStatus, '', '');
    try { showToast('Subscriptions updated.', { kind: 'success' }); } catch (_) {}
  } catch (err) {
    setSectionStatus(els.subscriptionsStatus, err.message || 'Failed to load subscriptions.', 'error');
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _money(cents, currency) {
  const cur = String(currency || 'USD');
  const val = Number(cents || 0) / 100;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(val); } catch (_) { return cur + ' ' + val.toFixed(2); }
}

function _intervalLabel(r) {
  const i = String(r && r.interval || '');
  const c = Number(r && r.intervalCount || 1) || 1;
  if (!i) return '—';
  return c === 1 ? (i === 'month' ? 'Monthly' : (i === 'year' ? 'Yearly' : i)) : (c + '× ' + i);
}

function _fmtDate(ms) {
  const t = Number(ms || 0);
  if (!t) return '—';
  try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }); } catch (_) { return new Date(t).toDateString(); }
}

function _daysLeft(ms) {
  const t = Number(ms || 0);
  if (!t) return '';
  const d = Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
  if (!isFinite(d)) return '';
  if (d < 0) return 'expired';
  if (d === 0) return 'today';
  return d + ' days left';
}

function _paintSubscriptions(els) {
  if (!els.subscriptionsPanel) return;
  els.subscriptionsPanel.textContent = '';
  const s       = state.subscriptionsState || {};
  const kpis    = s.kpis || {};
  const rows    = Array.isArray(s.subscriptions) ? s.subscriptions : [];
  const stripeMode = String(s.stripeMode || 'unknown');
  const _dashBase = stripeMode === 'test' ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';

  const mrrEntries = (kpis.mrrByCurrency && typeof kpis.mrrByCurrency === 'object') ? kpis.mrrByCurrency : {};
  const arrEntries = (kpis.arrByCurrency && typeof kpis.arrByCurrency === 'object') ? kpis.arrByCurrency : {};
  const mrrText = Object.keys(mrrEntries).length ? Object.keys(mrrEntries).sort().map(function (c) { return _money(mrrEntries[c], c); }).join(' · ') : '—';
  const arrText = Object.keys(arrEntries).length ? Object.keys(arrEntries).sort().map(function (c) { return _money(arrEntries[c], c); }).join(' · ') :
    (Object.keys(mrrEntries).length ? Object.keys(mrrEntries).sort().map(function (c) { return _money(mrrEntries[c] * 12, c); }).join(' · ') : '—');

  els.subscriptionsPanel.innerHTML = '<div id="subsKpiMount"></div>';
  const mount = document.getElementById('subsKpiMount');
  if (mount) {
    renderKpiCards(mount, {
      ariaLabel: 'Subscription KPIs',
      cards: [
        { title: 'Active Subscriptions',       value: Number(kpis.active || 0).toLocaleString(), icon: 'group', iconVariant: 'users', trend: '0% vs last 30 days' },
        { title: 'Total Subscribers',          value: Number(kpis.total  || 0).toLocaleString(), icon: 'person', iconVariant: 'ok', trend: '0% vs last 30 days' },
        { title: 'Monthly Recurring Revenue',  value: safeText(mrrText), kicker: 'MRR', icon: 'payments', iconVariant: 'mrr', trend: '0% vs last 30 days' },
        { title: 'Annual Recurring Revenue',   value: safeText(arrText), kicker: 'ARR', icon: 'monitoring', iconVariant: 'arr', trend: '0% vs last 30 days' },
      ],
    });
  }

  const tableMount = document.createElement('div');
  tableMount.className = 'sd-dt-mount';
  els.subscriptionsPanel.appendChild(tableMount);

  const tableRows = rows.slice(0, 200).map(function (r) {
    const status = String(r.status || 'unknown');
    return Object.assign({}, r, {
      _status:       status,
      _email:        r.email  ? String(r.email)  : '',
      _name:         r.name   ? String(r.name)   : '',
      _plan:         r.planNickname || 'Premium plan',
      _intervalLabel:_intervalLabel(r),
      _amountLabel:  (r.amount && r.currency) ? (_money(r.amount, r.currency) + ' / ' + (String(r.interval || '') === 'year' ? 'year' : 'month')) : '—',
      _periodLabel:  (r.currentPeriodStart ? _fmtDate(r.currentPeriodStart) : '—') + ' – ' + (r.currentPeriodEnd ? _fmtDate(r.currentPeriodEnd) : '—'),
      _daysLeft:     r.currentPeriodEnd ? _daysLeft(r.currentPeriodEnd) : '',
      _renewDate:    r.currentPeriodEnd ? _fmtDate(r.currentPeriodEnd) : '—',
      _renewMeta:    r.cancelAtPeriodEnd ? 'Cancels at period end' : 'Renews automatically',
      _customerId:   r.stripeCustomerId    ? String(r.stripeCustomerId)    : '',
      _subId:        r.stripeSubscriptionId ? String(r.stripeSubscriptionId) : '',
      _cancelAtPeriodEnd: r.cancelAtPeriodEnd === true,
    });
  });

  renderDataTable(tableMount, {
    ariaLabel: 'Subscriptions', tableClassName: 'sd-subs-table', responsive: true, emptyText: 'No subscriptions yet.', rows: tableRows,
    columns: [
      { key: 'subscriber', header: 'Subscriber', renderHtml: function (r) { return '<strong class="sd-subs-name">' + safeText(r._name || r._email || r.uid || '—') + '</strong><div class="sd-subs-muted">' + safeText(r._email || '') + '</div>'; } },
      { key: 'status',     header: 'Status',             renderHtml: function (r) { return '<span class="sd-subs-status sd-subs-status-' + safeText(r._status) + '">' + safeText(r._status) + '</span>'; } },
      { key: 'plan',       header: 'Plan',               renderText: function (r) { return r._plan; } },
      { key: 'interval',   header: 'Billing interval',   renderText: function (r) { return r._intervalLabel; } },
      { key: 'amount',     header: 'Amount', align: 'right', renderText: function (r) { return r._amountLabel; } },
      { key: 'period',     header: 'Current period',     renderHtml: function (r) { return '<div>' + safeText(r._periodLabel) + '</div>' + (r._daysLeft ? '<div class="sd-subs-muted">' + safeText(r._daysLeft) + '</div>' : ''); } },
      { key: 'renews',     header: 'Renews on',          renderHtml: function (r) { return '<div>' + safeText(r._renewDate || '—') + '</div>' + (r._renewMeta ? '<div class="sd-subs-muted">' + safeText(r._renewMeta) + '</div>' : ''); } },
      { key: 'actions',    header: 'Actions', align: 'right', renderHtml: function (r) {
        const canOpenCustomer = !!r._customerId;
        const canOpenSubscription = !!r._subId;
        const canManageSubscription = !!r._subId;
        const cancelLabel = r._cancelAtPeriodEnd ? 'Resume subscription' : 'Cancel at period end';
        const cancelIcon = r._cancelAtPeriodEnd ? 'restart_alt' : 'event_busy';
        const cancelAction = r._cancelAtPeriodEnd ? 'resume' : 'cancel';
        return '' +
          '<div class="reco-actions sd-subs-actions">' +
            '<button type="button" class="reco-actions-trigger sd-subs-kebab" aria-label="Actions" aria-haspopup="menu" aria-expanded="false"' +
              ' data-uid="' + safeText(r.uid || '') + '" data-email="' + safeText(r._email || '') + '"' +
              ' data-customer="' + safeText(r._customerId || '') + '" data-subscription="' + safeText(r._subId || '') + '"' +
            '><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></button>' +
            '<div class="reco-actions-menu sd-subs-actions-menu" hidden role="menu">' +
              (canOpenCustomer
                ? '<button type="button" class="reco-action-item" role="menuitem" data-subs-action="open-customer" data-customer="' + safeText(r._customerId) + '">' +
                    '<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span><span>Open customer in Stripe</span>' +
                  '</button>'
                : '') +
              (canOpenSubscription
                ? '<button type="button" class="reco-action-item" role="menuitem" data-subs-action="open-subscription" data-subscription="' + safeText(r._subId) + '">' +
                    '<span class="material-symbols-outlined" aria-hidden="true">receipt_long</span><span>Open subscription in Stripe</span>' +
                  '</button>'
                : '') +
              (canOpenCustomer
                ? '<button type="button" class="reco-action-item" role="menuitem" data-subs-action="open-portal" data-customer="' + safeText(r._customerId) + '">' +
                    '<span class="material-symbols-outlined" aria-hidden="true">account_circle</span><span>Open billing portal</span>' +
                  '</button>'
                : '') +
              (canManageSubscription
                ? '<button type="button" class="reco-action-item' + (cancelAction === 'cancel' ? ' sd-section-action-delete' : '') + '" role="menuitem" data-subs-action="' + cancelAction + '" data-subscription="' + safeText(r._subId) + '">' +
                    '<span class="material-symbols-outlined" aria-hidden="true">' + cancelIcon + '</span><span>' + cancelLabel + '</span>' +
                  '</button>'
                : '') +
            '</div>' +
          '</div>';
      } },
    ],
  });

  _wireSubscriptionActions(els, tableMount, stripeMode);
}

function _wireSubscriptionActions(els, mount, stripeMode) {
  if (!mount) return;
  if (_subsMenuCleanup) {
    try { _subsMenuCleanup(); } catch (_) {}
    _subsMenuCleanup = null;
  }

  const dashBase = stripeMode === 'test' ? 'https://dashboard.stripe.com/test' : 'https://dashboard.stripe.com';

  function closeMenus() {
    mount.querySelectorAll('.sd-subs-actions-menu').forEach(function (menu) { menu.hidden = true; });
    mount.querySelectorAll('.sd-subs-kebab[aria-expanded="true"]').forEach(function (btn) { btn.setAttribute('aria-expanded', 'false'); });
  }

  async function handleAction(btn) {
    const action = String(btn.getAttribute('data-subs-action') || '');
    const customerId = String(btn.getAttribute('data-customer') || '');
    const subscriptionId = String(btn.getAttribute('data-subscription') || '');
    closeMenus();

    if (action === 'open-customer' && customerId) {
      window.open(dashBase + '/customers/' + encodeURIComponent(customerId), '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open-subscription' && subscriptionId) {
      window.open(dashBase + '/subscriptions/' + encodeURIComponent(subscriptionId), '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'open-portal' && customerId) {
      setSectionStatus(els.subscriptionsStatus, 'Opening billing portal…', 'info');
      try {
        const data = await authedJson('/api/admin/subscriptions/portal-session', {
          method: 'POST',
          body: JSON.stringify({ customerId }),
        });
        setSectionStatus(els.subscriptionsStatus, '', '');
        if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        setSectionStatus(els.subscriptionsStatus, err.message || 'Failed to open billing portal.', 'error');
      }
      return;
    }
    if ((action === 'cancel' || action === 'resume') && subscriptionId) {
      const cancelAtPeriodEnd = action === 'cancel';
      const prompt = cancelAtPeriodEnd
        ? 'Cancel this subscription at the end of the current billing period?'
        : 'Resume this subscription and keep renewing automatically?';
      if (!window.confirm(prompt)) return;
      setSectionStatus(els.subscriptionsStatus, cancelAtPeriodEnd ? 'Cancelling subscription…' : 'Resuming subscription…', 'info');
      try {
        await authedJson('/api/admin/subscriptions/cancel', {
          method: 'POST',
          body: JSON.stringify({ subscriptionId, cancelAtPeriodEnd }),
        });
        showToast(cancelAtPeriodEnd ? 'Subscription will cancel at period end.' : 'Subscription resumed.', { kind: 'success' });
        state.subscriptionsState = null;
        await refreshSubscriptions(els);
      } catch (err) {
        setSectionStatus(els.subscriptionsStatus, err.message || 'Subscription update failed.', 'error');
      }
    }
  }

  function onClick(event) {
    const actionBtn = event.target.closest('[data-subs-action]');
    if (actionBtn) {
      event.preventDefault();
      event.stopPropagation();
      void handleAction(actionBtn);
      return;
    }

    const trigger = event.target.closest('.sd-subs-kebab');
    if (trigger && mount.contains(trigger)) {
      event.preventDefault();
      event.stopPropagation();
      const wrap = trigger.closest('.sd-subs-actions');
      const menu = wrap ? wrap.querySelector('.sd-subs-actions-menu') : null;
      if (!menu) return;
      const willOpen = menu.hidden;
      closeMenus();
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      return;
    }

    if (!event.target.closest('.sd-subs-actions')) {
      closeMenus();
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') closeMenus();
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKeydown);
  mount.addEventListener('click', onClick);

  _subsMenuCleanup = function () {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKeydown);
    mount.removeEventListener('click', onClick);
  };
}
