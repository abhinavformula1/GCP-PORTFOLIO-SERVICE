/**
 * IconCards — reusable circular-icon + label card grid.
 *
 * Usage:
 *   iconCardsHtml(items, { size: 'sm' })
 */

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
