/**
 * Price Card component — renders a single pricing tier card.
 *
 * S — only responsible for rendering one card with given data.
 * O — callers control content (name, price, features, CTA) via options;
 *     this component is closed to modification for new card styles.
 *
 * Used by: public/pricing/pricing.js
 *
 * @example
 *   const cta = renderPriceCard('#freeCardMount', {
 *     name: 'Free', price: '$0', period: '/month',
 *     tagline: 'For readers exploring the content.',
 *     ctaLabel: 'Get started free', ctaHref: '/',
 *     features: ['Popular Articles'],
 *   });
 */

import { createEl } from './dom.js';

/**
 * @typedef {Object} PriceCardOptions
 * @property {string}    name       - Tier name ("Free", "Premium")
 * @property {string}    price      - Display price ("$0", "$29")
 * @property {string}    period     - Period label ("/month")
 * @property {string}    [tagline]  - Short description under the price
 * @property {string[]}  [features] - Feature label strings (populated after load)
 * @property {string}    ctaLabel   - CTA text ("Get started free", "Subscribe")
 * @property {string}    [ctaHref]  - Renders CTA as <a> when provided
 * @property {Function}  [onCta]    - Renders CTA as <button> with click handler
 * @property {string}    [badge]    - Badge text above card ("Most popular")
 * @property {boolean}   [highlight]- Accent border + shadow for premium
 */

/**
 * Renders a price card into the target element.
 *
 * @param {string|HTMLElement} target - CSS selector or DOM element
 * @param {PriceCardOptions}   opts
 * @returns {HTMLElement} The CTA element, so callers can disable it during loading
 */
export function renderPriceCard(target, opts) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return null;

  const o         = opts || {};
  const highlight = !!o.highlight;
  const features  = Array.isArray(o.features) ? o.features : [];

  const card = createEl('div', {
    className: 'pr-card' + (highlight ? ' pr-card--premium' : ''),
  });

  // ── Optional "Most popular" badge ─────────────────────────────────────────
  if (o.badge) {
    card.appendChild(createEl('span', { className: 'pr-popular', text: o.badge }));
  }

  // ── Price block ───────────────────────────────────────────────────────────
  const priceBlock = createEl('div', {});

  priceBlock.appendChild(createEl('h2', { className: 'pr-tier-name', text: o.name || '' }));

  const priceRow = createEl('div', { className: 'pr-price-row' });
  priceRow.appendChild(createEl('span', { className: 'pr-price-amount', text: o.price  || '' }));
  priceRow.appendChild(createEl('span', { className: 'pr-price-period', text: o.period || '' }));
  priceBlock.appendChild(priceRow);

  if (o.tagline) {
    priceBlock.appendChild(createEl('p', { className: 'pr-tagline', text: o.tagline }));
  }

  card.appendChild(priceBlock);

  // ── CTA ───────────────────────────────────────────────────────────────────
  const ctaClass = 'pr-cta ' + (highlight ? 'pr-cta--premium' : 'pr-cta--free');
  let cta;

  if (o.ctaHref) {
    cta = createEl('a', { className: ctaClass, href: o.ctaHref, text: o.ctaLabel || '' });
  } else {
    cta = createEl('button', { type: 'button', className: ctaClass, text: o.ctaLabel || '' });
    if (typeof o.onCta === 'function') cta.addEventListener('click', o.onCta);
  }

  card.appendChild(cta);

  // ── Features list ─────────────────────────────────────────────────────────
  const list = createEl('ul', { className: 'pr-features' });

  if (features.length) {
    _renderFeatureItems(list, features);
  } else {
    // Skeleton until real data arrives via updatePriceCardFeatures()
    _renderSkeletons(list, 3);
  }

  card.appendChild(list);
  root.replaceChildren(card);

  return cta;
}

/**
 * Updates the feature list of an already-rendered price card.
 * Call this after fetching tier data from the API.
 *
 * @param {string|HTMLElement} target  - Same mount used in renderPriceCard
 * @param {string[]}           features
 */
export function updatePriceCardFeatures(target, features) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;
  const list = root.querySelector('.pr-features');
  if (!list) return;
  list.innerHTML = '';
  if (Array.isArray(features) && features.length) {
    _renderFeatureItems(list, features);
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _renderFeatureItems(list, features) {
  features.forEach(function (label) {
    const item = createEl('li', { className: 'pr-feature' });
    const dot  = createEl('span', { className: 'pr-feature-dot' });
    dot.setAttribute('aria-hidden', 'true');
    item.appendChild(dot);
    item.appendChild(document.createTextNode(String(label)));
    list.appendChild(item);
  });
}

function _renderSkeletons(list, count) {
  for (let i = 0; i < count; i++) {
    const item   = createEl('li', { className: 'pr-feature' });
    const skel   = createEl('span', { className: 'pr-skeleton-line' });
    skel.style.width  = (55 + i * 8) + '%';
    skel.style.height = '14px';
    skel.style.display = 'block';
    skel.style.borderRadius = '6px';
    item.appendChild(skel);
    list.appendChild(item);
  }
}
