/**
 * IconCards — reusable circular-icon + label card grid.
 *
 * Usage:
 *   renderIconCards(container, [
 *     { icon: 'wifi',    label: 'Complimentary Wifi',    locked: false },
 *     { icon: 'sell',    label: 'Exclusive Member Rates', locked: false },
 *     { icon: 'lock',    label: 'Priority Late Checkout', locked: true  },
 *   ], { columns: 4 });
 *
 * Options:
 *   columns  — number of columns (default: auto / responsive)
 *   size     — 'sm' | 'md' | 'lg'  (default: 'md')
 */

export function renderIconCards(container, items, options) {
  if (!container || !Array.isArray(items)) return;
  const opts    = options || {};
  const size    = opts.size    || 'md';
  const cols    = opts.columns ? String(opts.columns) : null;

  const grid = document.createElement('div');
  grid.className = 'sd-icon-cards' + (cols ? ' sd-icon-cards--cols-' + cols : '') + ' sd-icon-cards--' + size;

  items.forEach(function (item) {
    const card = document.createElement('div');
    card.className = 'sd-icon-card' + (item.locked ? ' sd-icon-card--locked' : '');

    const circle = document.createElement('div');
    circle.className = 'sd-icon-card__circle';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.locked ? 'lock' : (item.icon || 'article');

    circle.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'sd-icon-card__label';
    label.textContent = item.label || '';

    card.append(circle, label);
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

/**
 * Builds IconCards HTML string (for use in innerHTML contexts).
 */
export function iconCardsHtml(items, options) {
  if (!Array.isArray(items)) return '';
  const opts = options || {};
  const size = opts.size    || 'md';
  const cols = opts.columns ? ' sd-icon-cards--cols-' + opts.columns : '';

  let html = '<div class="sd-icon-cards' + cols + ' sd-icon-cards--' + size + '">';
  items.forEach(function (item) {
    const locked = item.locked ? ' sd-icon-card--locked' : '';
    const icon   = item.locked ? 'lock' : (item.icon || 'article');
    html += '<div class="sd-icon-card' + locked + '">';
    html += '<div class="sd-icon-card__circle">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span>';
    html += '</div>';
    html += '<span class="sd-icon-card__label">' + (item.label || '') + '</span>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}
