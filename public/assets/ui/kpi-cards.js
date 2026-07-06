/**
 * KPI Cards — reusable metric card row for admin dashboards.
 */

function safeText(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @typedef {Object} KpiCard
 * @property {string} title
 * @property {string|number} value
 * @property {string=} kicker
 * @property {string=} icon - Material Symbol name
 * @property {string=} iconVariant - maps to `sd-kpi-icon--<variant>`
 * @property {string=} trend - e.g. "↗ 0% vs last 30 days"
 * @property {string=} cardVariant - appended as `sd-kpi-card--<variant>` (e.g. 'pass', 'fail')
 */

/**
 * @param {HTMLElement} mount
 * @param {{ ariaLabel?: string, cards: KpiCard[] }} opts
 */
export function renderKpiCards(mount, opts) {
  const options = opts || {};
  const cards = Array.isArray(options.cards) ? options.cards : [];

  const root = document.createElement('div');
  root.className = 'sd-kpi-cards';
  if (options.ariaLabel) {
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', String(options.ariaLabel));
  }

  cards.forEach(function (c) {
    const card = document.createElement('div');
    const cardVar = String(c && c.cardVariant || '').trim();
    card.className = 'sd-kpi-card' + (cardVar ? (' sd-kpi-card--' + cardVar) : '');

    const head = document.createElement('div');
    head.className = 'sd-kpi-head';

    const title = document.createElement('div');
    title.className = 'sd-kpi-title';
    title.textContent = String(c && c.title || '');

    const iconWrap = document.createElement('div');
    const variant = String(c && c.iconVariant || '').trim();
    iconWrap.className = 'sd-kpi-icon' + (variant ? (' sd-kpi-icon--' + variant) : '');

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = String(c && c.icon || 'insights');
    iconWrap.appendChild(icon);

    head.appendChild(title);
    head.appendChild(iconWrap);

    const val = document.createElement('div');
    val.className = 'sd-kpi-value';
    if (c && c.kicker) {
      val.innerHTML = '<span class="sd-kpi-kicker">' + safeText(c.kicker) + '</span> ' + safeText(c.value);
    } else {
      val.textContent = String(c && c.value != null ? c.value : '');
    }

    const sub = document.createElement('div');
    sub.className = 'sd-kpi-sub';
    if (c && c.trend) {
      sub.innerHTML = '<span class="sd-kpi-trend">↗</span> <span>' + safeText(c.trend) + '</span>';
    } else {
      sub.textContent = '';
    }

    card.appendChild(head);
    card.appendChild(val);
    if (c && c.trend) card.appendChild(sub);
    root.appendChild(card);
  });

  mount.replaceChildren(root);
  return root;
}

