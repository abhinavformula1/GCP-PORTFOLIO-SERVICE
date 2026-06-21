/**
 * sponsorship.js
 * Renders B2B sponsor cards at configured placements.
 * Waterfall: paid sponsor → AdSense → nothing.
 */

let _cache = null;
let _fetchedAt = 0;
let _registryEnabled = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function isFeatureEnabled() {
  if (_registryEnabled !== null) return _registryEnabled;
  try {
    const resp = await fetch('/api/system-design/component-registry', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!resp.ok) { _registryEnabled = true; return true; }
    const data = await resp.json();
    const map = data.enabled || {};
    _registryEnabled = map['monetisation_sponsorship'] !== false;
  } catch (_) {
    _registryEnabled = true;
  }
  return _registryEnabled;
}

async function fetchActiveSponsor(placement) {
  const now = Date.now();
  if (_cache && (now - _fetchedAt) < CACHE_TTL_MS) {
    return (_cache[placement] || null);
  }
  try {
    const resp = await fetch('/api/sponsorships/active', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    _cache = {};
    (data.sponsors || []).forEach(function (s) {
      if (!_cache[s.placement]) _cache[s.placement] = s;
    });
    _fetchedAt = now;
    return _cache[placement] || null;
  } catch (_) {
    return null;
  }
}

function isImageUrl(url) {
  return Boolean(url && /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url));
}

function sponsorCardHtml(sponsor) {
  const logo = isImageUrl(sponsor.logoUrl)
    ? '<img src="' + _esc(sponsor.logoUrl) + '" alt="' + _esc(sponsor.company) + '" class="sd-sponsor-pub-logo" loading="lazy">'
    : '<span class="sd-sponsor-pub-name">' + _esc(sponsor.company) + '</span>';
  return (
    '<div class="sd-sponsor-slot" role="complementary" aria-label="Sponsored">' +
      '<span class="sd-sponsor-label">Sponsored</span>' +
      '<div class="sd-sponsor-content">' +
        logo +
        '<div class="sd-sponsor-text">' +
          '<p>' + _esc(sponsor.headline) + '</p>' +
        '</div>' +
        '<a href="' + _esc(sponsor.ctaUrl) + '" target="_blank" rel="noopener sponsored" class="sd-sponsor-cta">' +
          _esc(sponsor.cta || 'Learn More') +
        '</a>' +
      '</div>' +
    '</div>'
  );
}

function adsenseHtml(slotId) {
  if (!slotId) return '';
  const parts = slotId.split('/');
  const pubId  = parts[0] || '';
  const slot   = parts[1] || '';
  if (!pubId || !slot) return '';
  return (
    '<div class="sd-sponsor-slot sd-sponsor-slot--adsense">' +
      '<span class="sd-sponsor-label">Advertisement</span>' +
      '<ins class="adsbygoogle" style="display:block" data-ad-client="' + pubId + '" data-ad-slot="' + slot + '" data-ad-format="auto" data-full-width-responsive="true"></ins>' +
    '</div>'
  );
}

function _esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Mount a sponsor slot into a container element.
 * @param {HTMLElement} container
 * @param {'homepage'|'sidebar'|'article-footer'} placement
 */
export async function mountSponsorSlot(container, placement) {
  if (!container) return;
  const enabled = await isFeatureEnabled();
  if (!enabled) return;
  const sponsor = await fetchActiveSponsor(placement);
  if (sponsor) {
    container.innerHTML = sponsorCardHtml(sponsor);
  } else if (sponsor === null) {
    // No active paid sponsor — try AdSense fallback from any configured slot
    const cached = _cache || {};
    const any = Object.values(cached).find(function (s) { return s && s.adsenseSlot; });
    const slotId = any ? any.adsenseSlot : '';
    const html = adsenseHtml(slotId);
    if (html) {
      container.innerHTML = html;
      // Trigger AdSense after DOM insertion
      if (window.adsbygoogle) {
        try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (_) {}
      }
    }
  }
}
