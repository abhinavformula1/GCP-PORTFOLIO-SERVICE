/**
 * ArticleCard — reusable admin card component.
 *
 * SOLID principles applied:
 *
 *  S — Single Responsibility
 *      This module only knows how to build one article card DOM node.
 *      It has no knowledge of routing, state, or any parent module.
 *
 *  O — Open / Closed
 *      Behaviour is extended through the `onClick` and `onMore` callbacks
 *      and the `isActive` flag — callers customise without touching this file.
 *
 *  L — Liskov Substitution
 *      `createArticleCard` always returns a valid HTMLElement, regardless of
 *      which fields are present on the article object.
 *
 *  I — Interface Segregation
 *      The function only receives what it actually needs:
 *      the article data shape, active state, and two optional callbacks.
 *      It does not accept the full articles array or any global state.
 *
 *  D — Dependency Inversion
 *      Depends on the article data *shape* (an abstraction), not on
 *      concrete functions like fillForm or global arrays like `articles`.
 *      Callers inject behaviour via callbacks.
 *
 * CSS: card styles live in styles.css under the .sd-article-card namespace.
 *
 * Usage:
 *   import { createArticleCard } from '/assets/ui/article-card.js';
 *
 *   const card = createArticleCard(article, {
 *     isActive: article.id === selectedId,
 *     onClick:  (a) => openEditor(a),
 *     onMore:   (a, btn) => showContextMenu(a, btn),
 *   });
 *   container.appendChild(card);
 */

// ── Content-type helpers ───────────────────────────────────────────────────

const CONTENT_TYPE_LABELS = {
  'architecture': 'Architecture Notes',
  'case-study':   'Case Studies',
  'system-design': 'System Design',
};

/**
 * Normalise a raw contentType string to one of the three known keys.
 * Falls back to 'system-design' for anything unrecognised.
 * @param {string} raw
 * @returns {'system-design'|'architecture'|'case-study'}
 */
function normaliseContentType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return (v === 'architecture' || v === 'case-study' || v === 'system-design')
    ? v : 'system-design';
}

/**
 * Human-readable label for a normalised content type.
 * @param {'system-design'|'architecture'|'case-study'} type
 * @returns {string}
 */
export function contentTypeLabel(type) {
  return CONTENT_TYPE_LABELS[type] || 'System Design';
}

// ── Factory ────────────────────────────────────────────────────────────────

/**
 * Build and return a single article card DOM node.
 *
 * @param {Object}   article               - Article data object (Firestore shape)
 * @param {Object}   [opts]                - Options
 * @param {boolean}  [opts.isActive=false]  - Highlights the card as selected
 * @param {Function} [opts.onClick]         - (article) => void — card click
 * @param {boolean}  [opts.showBadge=true]  - Show/hide the status badge overlay
 * @param {boolean}  [opts.showOrder=true]  - Include "Order N" in the meta footer
 * @param {number}   [opts.lastVisited]     - Unix timestamp of last visit; shows "Viewed X ago"
 * @param {boolean}  [opts.isPremium]       - Show lock indicator in footer
 * @returns {HTMLDivElement}
 */
export function createArticleCard(article, opts = {}) {
  const { isActive = false, onClick, showBadge = true, showOrder = true, lastVisited, isPremium } = opts;

  const en            = article.en || {};
  const type          = normaliseContentType(article.contentType);
  const status        = article.status || 'Draft';
  const titleText     = en.title || article.id || 'Untitled';
  const firstLetter   = titleText.charAt(0).toUpperCase();
  const readPart      = article.readMinutes ? article.readMinutes + ' min' : '';
  const orderPart     = showOrder ? 'Order ' + (article.order || 100) : '';
  const metaText      = [readPart, orderPart].filter(Boolean).join(' · ');

  // ── Card wrapper ──────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.className = 'sd-article-card' + (isActive ? ' sd-article-card-active' : '');
  card.dataset.id          = article.id;
  card.dataset.contentType = type;

  // ── Thumbnail ─────────────────────────────────────────────────────────
  const thumb = document.createElement('div');
  thumb.className = 'sd-article-card-thumb sd-article-card-thumb-' + type;

  if (article.thumbnail) {
    const img   = document.createElement('img');
    img.src     = article.thumbnail;
    img.alt     = titleText;
    img.className = 'sd-article-card-thumb-img';
    thumb.appendChild(img);
  } else {
    const letter      = document.createElement('span');
    letter.className  = 'sd-article-card-thumb-letter';
    letter.textContent = firstLetter;
    thumb.appendChild(letter);
  }

  if (showBadge) {
    const badge           = document.createElement('span');
    badge.className       = 'sd-article-card-badge sd-admin-chip';
    badge.dataset.kind    = 'status';
    badge.dataset.status  = status;
    badge.textContent     = status;
    thumb.appendChild(badge);
  }

  // Premium lock — top-right corner of thumbnail
  if (isPremium) {
    const lockChip = document.createElement('span');
    lockChip.className = 'sd-article-card-premium-chip';
    lockChip.setAttribute('aria-label', 'Premium');
    const lockIcon = document.createElement('span');
    lockIcon.className = 'material-symbols-outlined';
    lockIcon.textContent = 'lock';
    lockChip.appendChild(lockIcon);
    thumb.appendChild(lockChip);
  }

  // ── Body ──────────────────────────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'sd-article-card-body';

  const titleEl       = document.createElement('div');
  titleEl.className   = 'sd-article-card-title';
  titleEl.textContent = titleText;

  const typeEl        = document.createElement('div');
  typeEl.className    = 'sd-article-card-type';
  typeEl.textContent  = contentTypeLabel(type);

  body.append(titleEl, typeEl);

  // ── Footer ────────────────────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.className = 'sd-article-card-footer';

  const meta        = document.createElement('span');
  meta.className    = 'sd-article-card-meta';
  meta.textContent  = metaText;

  footer.append(meta);

  // ── "Viewed X ago" strip — full-width bar at very bottom ─────────────
  let viewedStrip = null;
  if (lastVisited) {
    const diff = Date.now() - lastVisited;
    const mins = Math.floor(diff / 60000);
    let rel = 'Just now';
    if (mins >= 1 && mins < 60) rel = mins + ' min ago';
    else if (mins >= 60 && mins < 1440) rel = Math.floor(mins / 60) + ' hr ago';
    else if (mins >= 1440 && mins < 10080) rel = Math.floor(mins / 1440) + 'd ago';
    else if (mins >= 10080) rel = Math.floor(mins / 10080) + 'wk ago';
    viewedStrip = document.createElement('div');
    viewedStrip.className = 'sd-article-card-viewed-strip';
    const eyeIcon = document.createElement('span');
    eyeIcon.className = 'material-symbols-outlined';
    eyeIcon.textContent = 'visibility';
    viewedStrip.append(eyeIcon, document.createTextNode('Viewed ' + rel));
  }

  // ── Assemble + wire click ─────────────────────────────────────────────
  card.append(thumb, body, footer);
  if (viewedStrip) card.append(viewedStrip);

  if (typeof onClick === 'function') {
    card.addEventListener('click', function () { onClick(article); });
  }

  return card;
}
