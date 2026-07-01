/**
 * Software Architecture view -- master/detail topic browser.
 *
 * A second persona for the same body grid: instead of "About + Skills" on
 * the left and "Work Experience + Projects" on the right, we surface a
 * curated catalogue of architecture / design write-ups. The resume DOM is
 * hidden, not removed, so:
 *   - the Download Resume button keeps scraping the resume nodes via
 *     querySelector ([hidden] doesn't affect that), and
 *   - flipping back to the resume view is instantaneous (no re-render).
 *
 * Two views:
 *   - List view (landing): shows all articles with filtering by content type
 *     and domain tags. The old sidebar is hidden; a new integrated sidebar
 *     with domain filters is rendered inside the content area.
 *   - Article detail view: shows a single article with the topic sidebar.
 *
 * URL routing: uses the History API (/software-architecture/<id>) so every
 * article gets a real, crawlable URL that Google can index. The server
 * catch-all serves index.html for any /software-architecture/* path so direct
 * loads and reloads work correctly.
 *
 * Locale flip -- listens for the <html lang> attribute mutation that
 * applyPageLang performs at the end of every language switch -- and
 * re-renders the active topic body in the new locale.
 */

import { currentLang } from '../core/i18n.js';
import { googleCredential, siteProfile, setSiteProfile } from '../core/state.js';
import { blocksToHtml } from './sdblocks.js';
import { iconCardsHtml } from './iconcards.js';
import { mountSponsorSlot } from './sponsorship.js';
import { showToast } from './toast.js';
import { openBillingCheckoutModal, initBillingClaimFlow } from './billing-checkout.js';
import { createArticleCard, contentTypeLabel } from './article-card.js';
import { renderDataTable } from './datatable.js';

// ── Topic catalogue ──────────────────────────────────────────────────────────
//
// Articles are fetched from Firestore via /api/system-design/articles. Keep this
// fallback intentionally empty so content is not maintained in application JS.
const FALLBACK_TOPICS = [];

// ── Module state ─────────────────────────────────────────────────────────────
let _activeView  = 'resume';   // 'resume' | 'sysdesign'
let _activeTopic = null;
let _resumeAside = null;
let _resumeMain  = null;
let _sdAside     = null;
let _sdDetail    = null;
let _btn         = null;
let _topicFilter = '';
let _cmsTopics   = null;
let _cmsLoadStarted = false;
let _cmsLoading = false;
let _cmsLoaded   = false;
let _tierConfig  = null;
let _userToggledSidebar = false;

const SIDEBAR_COLLAPSE_KEY = 'sd_topics_collapsed';
const LIST_FILTERS_KEY = 'sd_list_filters_v1';
const PUB_VIEW_KEY = 'sd_pub_view';
const ARTICLE_VISITS_KEY = 'sd_article_visits';

function recordArticleVisit(id) {
  if (!id) return;
  try {
    const visits = JSON.parse(localStorage.getItem(ARTICLE_VISITS_KEY) || '{}');
    visits[id] = Date.now();
    localStorage.setItem(ARTICLE_VISITS_KEY, JSON.stringify(visits));
  } catch (_) {}
}

function getArticleVisits() {
  try { return JSON.parse(localStorage.getItem(ARTICLE_VISITS_KEY) || '{}'); } catch (_) { return {}; }
}

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' hr ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + ' day' + (days !== 1 ? 's' : '') + ' ago';
  const wks = Math.floor(days / 7);
  if (wks < 5) return wks + ' wk ago';
  return Math.floor(days / 30) + ' mo ago';
}

let _pubArticleView = (function () {
  try { return localStorage.getItem(PUB_VIEW_KEY) || 'grid'; } catch (_) { return 'grid'; }
}());

let _topicsExpanded = false; // "show all" toggle for low-count domain tags

let _localPreviewEnabled = null;
function closeWelcomeOverlayIfOpen() {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;
  try {
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.setAttribute('hidden', '');
  } catch (_) {}
}

function forceLockedEnabled() {
  try {
    return new URLSearchParams(location.search).get('forceLocked') === '1';
  } catch (_) {
    return false;
  }
}

function articlesApiUrl() {
  return '/api/system-design/articles' + (forceLockedEnabled() ? '?forceLocked=1' : '');
}
async function isLocalPreviewEnabled() {
  if (_localPreviewEnabled !== null) return _localPreviewEnabled;
  try {
    const resp = await fetch('/api/local-preview', { credentials: 'same-origin' });
    const data = await resp.json().catch(function () { return null; });
    _localPreviewEnabled = !!(resp.ok && data && data.enabled);
  } catch (_) {
    _localPreviewEnabled = false;
  }
  if (_localPreviewEnabled) {
    // If an earlier click set subscribe-pending, clear it so the sign-in modal
    // doesn't keep reappearing during UX work.
    try { sessionStorage.removeItem('pending_subscribe'); } catch (_) {}
    closeWelcomeOverlayIfOpen();
  }
  return _localPreviewEnabled;
}

async function authTokenOrNull() {
  if (googleCredential) return String(googleCredential);
  const local = await isLocalPreviewEnabled();
  return local ? 'local-admin-preview' : '';
}

function persistListFilters() {
  try {
    sessionStorage.setItem(LIST_FILTERS_KEY, JSON.stringify({
      contentTab: _activeContentTab,
      domain: _activeDomain,
    }));
  } catch (_) {}
}

function restoreListFilters() {
  try {
    const raw = sessionStorage.getItem(LIST_FILTERS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const tab = String(data && data.contentTab || '');
    const dom = String(data && data.domain || '');
    if (tab && (tab === 'all' || tab === 'system-design' || tab === 'architecture' || tab === 'case-study')) {
      _activeContentTab = tab;
    }
    if (dom) _activeDomain = dom;
  } catch (_) {}
}

// ── List view filters ────────────────────────────────────────────────────────
let _activeContentTab = 'all';   // 'all' | 'system-design' | 'architecture' | 'case-study'
let _activeDomain = 'all';       // 'all' | tag name

// Content type tabs for horizontal filter
const CONTENT_TABS = [
  { id: 'all',           label: 'All',                icon: 'apps' },
  { id: 'system-design', label: 'System Design',      icon: 'schema' },
  { id: 'architecture',  label: 'Architecture Notes', icon: 'architecture' },
  { id: 'case-study',    label: 'Case Studies',       icon: 'menu_book' },
];

// Domain/tag categories for sidebar (dynamically populated from article tags)
const DOMAIN_ICONS = {
  'Integration':   'sync_alt',
  'Security':      'shield',
  'Scalability':   'speed',
  'Event-Driven':  'bolt',
  'AI':            'psychology',
  'Cloud':         'cloud',
  'CPQ':           'request_quote',
  'DevOps':        'deployed_code',
  'Performance':   'analytics',
  'Salesforce':    'cloud_circle',
  'MuleSoft':      'hub',
};

// Public route prefix for the Software Architecture library.
// Keep LEGACY_PREFIX working via redirects for old links/SEO.
const PATH_PREFIX = '/software-architecture';
const LEGACY_PREFIX = '/system-design';
// SITE_BASE is overridden at runtime by loadSeoConfig() from the admin-managed
// SEO config in Firestore. Falls back to the Cloud Run URL if the API is unreachable.
let SITE_BASE = 'https://portfolio-service-647206478056.asia-southeast1.run.app';
let _seoJsonLdEnabled = true;

async function loadSeoConfig() {
  try {
    const resp = await fetch('/api/system-design/seo-config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const cfg  = data.config || {};
    if (cfg.siteUrl)         SITE_BASE          = cfg.siteUrl.replace(/\/$/, '');
    if (cfg.jsonLdEnabled === false) _seoJsonLdEnabled = false;
    // Apply noindex if admin turned it on
    if (cfg.robotsNoindex) {
      let el = document.querySelector('meta[name="robots"]');
      if (!el) { el = document.createElement('meta'); el.name = 'robots'; document.head.appendChild(el); }
      el.setAttribute('content', 'noindex, nofollow');
    }
    // Update homepage meta description if configured
    if (cfg.siteDescription) {
      const el = document.querySelector('meta[name="description"]');
      if (el) el.setAttribute('content', cfg.siteDescription);
    }
    // Update OG image if configured
    if (cfg.ogImageUrl) {
      ['og:image', 'og:image:width', 'og:image:height'].forEach(function (p) {
        const el = document.querySelector('meta[property="' + p + '"]');
        if (el && p === 'og:image') el.setAttribute('content', cfg.ogImageUrl);
      });
      const tw = document.querySelector('meta[name="twitter:image"]');
      if (tw) tw.setAttribute('content', cfg.ogImageUrl);
    }
    // Update canonical base URL
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.href = SITE_BASE + '/';
    // Inject AdSense library script if publisher ID is configured and not already loaded
    if (cfg.adsensePublisherId && /^ca-pub-\d+$/.test(cfg.adsensePublisherId)) {
      if (!document.querySelector('script[data-adsense]')) {
        const s = document.createElement('script');
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + cfg.adsensePublisherId;
        s.setAttribute('data-adsense', '1');
        document.head.appendChild(s);
      }
    }

    // hreflang for French
    if (cfg.hreflangFrEnabled) {
      if (!document.querySelector('link[hreflang="en"]')) {
        const enLink = document.createElement('link'); enLink.rel = 'alternate'; enLink.hreflang = 'en'; enLink.href = SITE_BASE + '/';
        const frLink = document.createElement('link'); frLink.rel = 'alternate'; frLink.hreflang = 'fr'; frLink.href = SITE_BASE + '/?lang=fr';
        document.head.appendChild(enLink);
        document.head.appendChild(frLink);
      }
    }
  } catch (_) { /* non-fatal — defaults remain */ }
}
const CONTENT_TYPE_LABELS = {
  'system-design': 'System Design',
  architecture:    'Architecture Notes',
  'case-study':    'Case Studies',
};

function topicById(id) {
  const topics = getTopics();
  for (const topic of topics) {
    if (topic.id === id) return topic;
  }
  return null;
}

// ── Dynamic meta helpers (SEO / AEO) ─────────────────────────────────────────

const _defaultTitle = document.title;
const _defaultDesc  = (document.querySelector('meta[name="description"]') || {}).content || '';

function setMeta(name, value) {
  let el = document.querySelector('meta[name="' + name + '"]');
  if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
  el.setAttribute('content', value);
}
function setOg(prop, value) {
  let el = document.querySelector('meta[property="' + prop + '"]');
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', prop); document.head.appendChild(el); }
  el.setAttribute('content', value);
}
function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
  el.href = url;
}
function setJsonLd(id, data) {
  if (!_seoJsonLdEnabled) { removeJsonLd(id); return; }
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data, null, 2);
}
function removeJsonLd(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function applyArticleMeta(topic) {
  if (!topic) { resetMeta(); return; }
  const loc   = topic.en || {};
  const title = (loc.title || topic.id) + ' — Software Architecture | Abhinav Kumar';
  const desc  = loc.subtitle
    || 'Software architecture article: ' + (loc.title || topic.id) + '. Architecture and engineering deep-dive by Abhinav Kumar.';
  const url   = SITE_BASE + PATH_PREFIX + '/' + topic.id;
  const tags  = Array.isArray(topic.tags) ? topic.tags : [];

  document.title = title;
  setMeta('description', desc);
  setOg('og:title', title);
  setOg('og:description', desc);
  setOg('og:url', url);
  setOg('og:type', 'article');
  setMeta('twitter:title', title);
  setMeta('twitter:description', desc);
  setCanonical(url);

  setJsonLd('sd-article-jsonld', {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    'headline': loc.title || topic.id,
    'description': desc,
    'url': url,
    'author': {
      '@type': 'Person',
      '@id': SITE_BASE + '/#person',
      'name': 'Abhinav Kumar',
    },
    'publisher': {
      '@type': 'Person',
      'name': 'Abhinav Kumar',
      'url': SITE_BASE,
    },
    'keywords': tags.join(', '),
    'dateModified': topic.updatedAt ? new Date(topic.updatedAt).toISOString() : undefined,
    'inLanguage': 'en',
  });
}

function resetMeta() {
  document.title = _defaultTitle;
  setMeta('description', _defaultDesc);
  setOg('og:title', _defaultTitle);
  setOg('og:description', _defaultDesc);
  setOg('og:url', SITE_BASE + '/');
  setOg('og:type', 'profile');
  setMeta('twitter:title', _defaultTitle);
  setMeta('twitter:description', _defaultDesc);
  setCanonical(SITE_BASE + '/');
  removeJsonLd('sd-article-jsonld');
}

function getTopics() {
  return Array.isArray(_cmsTopics) && _cmsTopics.length ? _cmsTopics : FALLBACK_TOPICS;
}

function localeOf(topic) {
  return topic[currentLang] || topic.en;
}

// Topic ids use hyphens (URL-friendly) but data-i18n / PAGE_LANG keys are
// JS identifiers, so we normalise hyphens to underscores when building
// per-topic keys. e.g. "gcp-sf-integration" -> "sd_gcp_sf_integration_title".
function topicKey(id, suffix) {
  return 'sd_' + String(id).replace(/-/g, '_') + '_' + suffix;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normaliseText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function uiText(key) {
  const fr = currentLang === 'fr';
  const dict = {
    title:       fr ? 'Carnet d architecture' : 'Architecture Notes',
    intro:       fr ? 'Choisissez un sujet pour voir les compromis, les choix et les details d implementation.' : 'Choose a topic to review trade-offs, design choices, and implementation details.',
    search:      fr ? 'Filtrer les sujets' : 'Filter topics',
    noResults:   fr ? 'Aucun sujet ne correspond.' : 'No matching topics.',
    loading:     fr ? 'Chargement des notes...' : 'Loading architecture notes...',
    unavailable: fr ? 'Aucune note publiee pour le moment.' : 'No published notes are available yet.',
    articleLabel: fr ? 'Note de conception' : 'Design note',
    exportPdf:   fr ? 'Exporter PDF' : 'Export PDF',
    // List view strings
    pageTitle:   fr ? 'Architecture logicielle' : 'Software Architecture',
    pageSubtitle: fr ? 'Decisions d\'architecture, conception systeme, patterns d\'integration et insights d\'ingenierie issus de systemes reels.' : 'Architecture decisions, system design, integration patterns, and engineering insights from real-world systems.',
    domains:     fr ? 'Domaines' : 'DOMAINS',
    all:         fr ? 'Tous' : 'All',
    comingSoon:  fr ? 'Plus d\'articles bientot...' : 'More articles coming soon...',
    minRead:     fr ? 'min de lecture' : 'min read',
  };
  return dict[key] || '';
}

function normaliseCmsTopic(article) {
  if (!article || typeof article !== 'object') return null;
  const id = String(article.id || article.slug || '').trim();
  if (!id) return null;
  const en = article.en && typeof article.en === 'object' ? article.en : {};
  const fr = article.fr && typeof article.fr === 'object' ? article.fr : {};
  const blocks = Array.isArray(article.blocks) ? article.blocks : [];
  return {
    id,
    contentType: article.contentType || '',
    icon:        article.icon || 'article',
    status:      article.status || 'Published',
    tags:        Array.isArray(article.tags) ? article.tags : [],
    readMinutes: article.readMinutes ? Number(article.readMinutes) : null,
    tier:        article.tier || 'free',
    hasAccess:   article.hasAccess !== false,
    stub:        !!article.stub,
    blocks,
    en: {
      title:    en.title || article.title || id,
      subtitle: en.subtitle || article.subtitle || '',
      body:     en.body || article.bodyHtml || '',
    },
    fr: {
      title:    fr.title || en.title || article.title || id,
      subtitle: fr.subtitle || en.subtitle || article.subtitle || '',
      body:     fr.body || en.body || article.bodyHtml || '',
    },
  };
}

function renderSidebar(mode) {
  if (!_sdAside) return;
  const topics = getTopics();
  const published = topics.filter(function (t) { return t && !t.stub; });
  const domains = getArticleDomains(published);
  const isDetail = mode === 'detail';
  const isFr = currentLang === 'fr';

  // Split domains: primary (≥2 articles) always visible; secondary (=1) behind toggle
  const primaryDomains = domains.filter(function (d) { return d && d.count >= 2; });
  const secondaryDomains = domains.filter(function (d) { return d && d.count === 1; });

  const typeCounts = {};
  CONTENT_TABS.forEach(function (t) {
    if (t.id === 'all') return;
    typeCounts[t.id] = published.filter(function (a) { return getContentType(a) === t.id; }).length;
  });

  let html = '<div class="sd-sa-sidebar' + (isDetail ? ' sd-sa-sidebar--detail' : '') + '">';

  // Search
  html += '<label class="sd-topic-search sd-sa-search">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
  html += '<input type="search" value="' + escapeHtml(isDetail ? _topicFilter : '') + '"';
  html += ' placeholder="' + escapeHtml(isFr ? 'Rechercher…' : 'Search articles…') + '"';
  html += ' aria-label="' + escapeHtml(isFr ? 'Rechercher des articles' : 'Search articles') + '">';
  html += '</label>';

  // ── BY TYPE section ──────────────────────────────────────────────────────
  html += '<div class="sd-sa-section">';
  html += '<div class="sd-sa-section-label">' + escapeHtml(isFr ? 'PAR TYPE' : 'BY TYPE') + '</div>';
  html += '<nav class="sd-sa-nav" role="list">';

  const allActive = (_activeContentTab === 'all' && _activeDomain === 'all') ? ' sd-domain-active' : '';
  html += '<button type="button" class="sd-domain-item' + allActive + '" data-filter-kind="type" data-filter-id="all">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">apps</span>';
  html += '<span class="sd-domain-label">' + escapeHtml(isFr ? 'Tous les articles' : 'All Articles') + '</span>';
  html += '<span class="sd-domain-count">' + published.length + '</span>';
  html += '</button>';

  CONTENT_TABS.forEach(function (tab) {
    if (tab.id === 'all') return;
    const count = typeCounts[tab.id] || 0;
    const active = (_activeContentTab === tab.id && _activeDomain === 'all') ? ' sd-domain-active' : '';
    const muted = !count ? ' sd-domain-item-empty' : '';
    html += '<button type="button" class="sd-domain-item' + active + muted + '" data-filter-kind="type" data-filter-id="' + tab.id + '"' + (!count ? ' disabled' : '') + '>';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + tab.icon + '</span>';
    html += '<span class="sd-domain-label">' + escapeHtml(tab.label) + '</span>';
    html += '<span class="sd-domain-count">' + count + '</span>';
    html += '</button>';
  });

  html += '</nav>';
  html += '</div>';

  // ── BY TOPIC section ─────────────────────────────────────────────────────
  if (primaryDomains.length || secondaryDomains.length) {
    html += '<div class="sd-sa-section-divider" role="separator"></div>';
    html += '<div class="sd-sa-section">';
    html += '<div class="sd-sa-section-label">' + escapeHtml(isFr ? 'PAR SUJET' : 'BY TOPIC') + '</div>';
    html += '<nav class="sd-sa-nav" role="list">';

    primaryDomains.forEach(function (d) {
      const active = _activeDomain === d.name ? ' sd-domain-active' : '';
      const icon = DOMAIN_ICONS[d.name] || 'label';
      html += '<button type="button" class="sd-domain-item' + active + '" data-filter-kind="domain" data-filter-id="' + escapeHtml(d.name) + '" title="' + escapeHtml(d.name) + '">';
      html += '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span>';
      html += '<span class="sd-domain-label">' + escapeHtml(d.name) + '</span>';
      html += '<span class="sd-domain-count">' + d.count + '</span>';
      html += '</button>';
    });

    if (secondaryDomains.length) {
      secondaryDomains.forEach(function (d) {
        const active = _activeDomain === d.name ? ' sd-domain-active' : '';
        const icon = DOMAIN_ICONS[d.name] || 'label';
        html += '<button type="button" class="sd-domain-item sd-domain-secondary' + (_topicsExpanded ? '' : ' sd-domain-secondary-hidden') + active + '"';
        html += ' data-filter-kind="domain" data-filter-id="' + escapeHtml(d.name) + '" title="' + escapeHtml(d.name) + '">';
        html += '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span>';
        html += '<span class="sd-domain-label">' + escapeHtml(d.name) + '</span>';
        html += '<span class="sd-domain-count">' + d.count + '</span>';
        html += '</button>';
      });

      html += '<button type="button" class="sd-sa-topics-more" id="topicsMoreBtn">';
      html += '<span class="material-symbols-outlined" aria-hidden="true">' + (_topicsExpanded ? 'expand_less' : 'expand_more') + '</span>';
      html += '<span>' + (_topicsExpanded
        ? escapeHtml(isFr ? 'Réduire' : 'Show less')
        : ('+ ' + secondaryDomains.length + ' ' + escapeHtml(isFr ? 'de plus' : 'more'))) + '</span>';
      html += '</button>';
    }

    html += '</nav>';
    html += '</div>';
  }

  // Footer collapse control
  html += '<div class="sd-sa-footer">';
  html += '<button type="button" class="sd-sa-collapse" aria-label="Collapse sidebar" title="Collapse sidebar">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>';
  html += '<span class="sd-sa-collapse-label">' + escapeHtml(isFr ? 'Réduire' : 'Collapse') + '</span>';
  html += '</button>';
  html += '</div>';

  html += '</div>';
  _sdAside.innerHTML = html;

  // Wire up search
  const search = _sdAside.querySelector('.sd-topic-search input');
  if (search) {
    search.addEventListener('input', function () {
      _topicFilter = search.value || '';
      if (isDetail) renderSidebar('detail');
    });
  }

  // Wire up type filters — selecting a type clears domain
  _sdAside.querySelectorAll('[data-filter-kind="type"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _activeContentTab = btn.getAttribute('data-filter-id') || 'all';
      _activeDomain = 'all';
      _topicFilter = '';
      persistListFilters();
      if (isDetail) { navigate(PATH_PREFIX); handleRoute(); return; }
      renderLandingRoute();
    });
  });

  // Wire up domain filters — selecting a domain clears type
  _sdAside.querySelectorAll('[data-filter-kind="domain"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _activeDomain = btn.getAttribute('data-filter-id') || 'all';
      _activeContentTab = 'all';
      persistListFilters();
      if (isDetail) renderSidebar('detail');
      else renderLandingRoute();
    });
  });

  // Wire up "+ N more" toggle
  const moreBtn = _sdAside.querySelector('#topicsMoreBtn');
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      _topicsExpanded = !_topicsExpanded;
      renderSidebar(mode);
    });
  }

  // Collapse control
  const collapseBtn = _sdAside.querySelector('.sd-sa-collapse');
  if (collapseBtn) {
    function syncCollapseIcon() {
      const body = document.querySelector('.body');
      const icon = collapseBtn.querySelector('.material-symbols-outlined');
      if (!icon || !body) return;
      icon.textContent = body.classList.contains('sd-topics-collapsed') ? 'left_panel_open' : 'left_panel_close';
    }
    syncCollapseIcon();
    collapseBtn.addEventListener('click', function () {
      const body = document.querySelector('.body');
      if (!body) return;
      const collapsed = body.classList.toggle('sd-topics-collapsed');
      try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
      syncCollapseIcon();
    });
  }
}

function _normContentType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return (v === 'architecture' || v === 'case-study' || v === 'system-design') ? v : 'system-design';
}

function renderLandingMain() {
  if (!_sdDetail) return;
  restoreListFilters();
  const topics = getTopics();
  const filtered = filterArticles(topics, _activeContentTab, _activeDomain);

  // ── Header + toolbar ─────────────────────────────────────────────────────
  let html = '<section class="sd-list-view sd-sa-list">';
  html += '<header class="sd-list-header">';
  html += '<h1 class="sd-list-title">' + escapeHtml(uiText('pageTitle')) + '</h1>';
  html += '<p class="sd-list-subtitle">' + escapeHtml(uiText('pageSubtitle')) + '</p>';
  // Toolbar: type chips (left) + view toggle (right)
  html += '<div class="sd-sa-toolbar">';
  html += '<div class="sd-type-chips" role="group" aria-label="Filter by type">';
  // "All Articles" chip — clears type filter
  const allChipActive = (_activeContentTab === 'all' && _activeDomain === 'all') ? ' sd-type-chip-active' : '';
  html += '<button type="button" class="sd-type-chip' + allChipActive + '" data-tab="all">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">apps</span>';
  html += escapeHtml(currentLang === 'fr' ? 'Tous' : 'All Articles');
  html += '</button>';
  CONTENT_TABS.forEach(function (tab) {
    if (tab.id === 'all') return;
    const active = _activeContentTab === tab.id ? ' sd-type-chip-active' : '';
    html += '<button type="button" class="sd-type-chip' + active + '" data-tab="' + tab.id + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + tab.icon + '</span>';
    html += escapeHtml(tab.label);
    html += '</button>';
  });
  html += '</div>';
  html += '<div class="sd-pub-view-toggle" role="group" aria-label="View mode">';
  html += '<button type="button" id="pubViewGrid" class="sd-pub-view-btn' + (_pubArticleView === 'grid' ? ' sd-pub-view-btn-active' : '') + '" aria-pressed="' + (_pubArticleView === 'grid') + '" title="Grid view">';
  html += '<span class="material-symbols-outlined">grid_view</span></button>';
  html += '<button type="button" id="pubViewList" class="sd-pub-view-btn' + (_pubArticleView === 'list' ? ' sd-pub-view-btn-active' : '') + '" aria-pressed="' + (_pubArticleView === 'list') + '" title="List view">';
  html += '<span class="material-symbols-outlined">view_list</span></button>';
  html += '</div>';
  html += '</div>';
  html += '</header>';
  // Article container — populated via DOM below
  html += '<div class="sd-article-list-mount"></div>';
  html += '</section>';

  _sdDetail.innerHTML = html;

  // ── Populate article area using createArticleCard / renderDataTable ───────
  const mount = _sdDetail.querySelector('.sd-article-list-mount');

  if (!filtered.length) {
    const emptyEl = document.createElement('p');
    emptyEl.className = 'sd-list-empty';
    emptyEl.textContent = _cmsLoaded ? uiText('noResults') : '';
    if (!_cmsLoaded) {
      emptyEl.className = 'sd-list-empty sd-list-loading';
      emptyEl.innerHTML = '<sd-loader size="sm" label="' + escapeHtml(uiText('loading')) + '"></sd-loader>';
    }
    mount.appendChild(emptyEl);
  } else if (_pubArticleView === 'list') {
    // ── List view: DataTable ────────────────────────────────────────────
    mount.className = 'sd-article-list-mount sd-pub-list-view';
    const listVisits = getArticleVisits();
    const rows = filtered.map(function (t) {
      const loc = localeOf(t);
      const type = _normContentType(t.contentType);
      return {
        _id: t.id,
        _title: loc.title || t.id,
        _type: type,
        _typeLabel: contentTypeLabel(type),
        _meta: t.readMinutes ? t.readMinutes + ' min read' : '',
        _premium: t.tier === 'premium',
        _locked: t.tier === 'premium' && t.hasAccess === false,
        _visited: listVisits[t.id] || null,
        _topic: t,
      };
    });

    renderDataTable(mount, {
      ariaLabel: 'Articles',
      tableClassName: 'sd-pub-articles-table',
      responsive: true,
      emptyText: uiText('noResults'),
      rows: rows,
      columns: [
        {
          key: 'type',
          header: 'Type',
          width: 160,
          renderHtml: function (r) {
            return '<span class="sd-pub-chip" data-type="' + escapeHtml(r._type) + '">' + escapeHtml(r._typeLabel) + '</span>';
          },
        },
        {
          key: 'title',
          header: 'Title',
          renderHtml: function (r) {
            let html = '<span class="sd-pub-articles-table-title">' + escapeHtml(r._title) + '</span>';
            if (r._premium) html += ' <span class="sd-pub-list-lock" title="Premium"><span class="material-symbols-outlined">lock</span></span>';
            if (r._visited) html += '<span class="sd-pub-list-viewed"><span class="material-symbols-outlined">visibility</span>' + escapeHtml(relativeTime(r._visited)) + '</span>';
            return html;
          },
        },
        {
          key: 'meta',
          header: 'Read time',
          align: 'right',
          renderText: function (r) { return r._meta; },
        },
        {
          key: 'tier',
          header: 'Tier',
          width: 90,
          align: 'right',
          renderHtml: function (r) {
            return r._premium
              ? '<span class="sd-pub-tier-badge sd-pub-tier-premium"><span class="material-symbols-outlined">lock</span>Premium</span>'
              : '<span class="sd-pub-tier-badge sd-pub-tier-free">Free</span>';
          },
        },
      ],
    });

    const tbody = mount.querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const idx = Array.from(tbody.querySelectorAll('tr')).indexOf(tr);
        if (idx >= 0 && rows[idx]) {
          navigate(PATH_PREFIX + '/' + rows[idx]._id + (forceLockedEnabled() ? '?forceLocked=1' : ''));
          handleRoute();
        }
      });
    }
  } else {
    // ── Grid view: createArticleCard ────────────────────────────────────
    const grid = document.createElement('div');
    grid.className = 'sd-pub-article-grid';
    const visits = getArticleVisits();
    filtered.forEach(function (t) {
      const loc = localeOf(t);
      const card = createArticleCard(
        {
          id: t.id,
          en: { title: loc.title, subtitle: loc.subtitle },
          contentType: t.contentType,
          status: 'Published',
          thumbnail: t.thumbnail || null,
          readMinutes: t.readMinutes,
          order: null,
        },
        {
          showBadge: false,
          showOrder: false,
          lastVisited: visits[t.id] || null,
          isPremium: t.tier === 'premium',
          onClick: function () {
            navigate(PATH_PREFIX + '/' + t.id + (forceLockedEnabled() ? '?forceLocked=1' : ''));
            handleRoute();
          },
        }
      );
      grid.appendChild(card);
    });
    mount.appendChild(grid);
  }

  // ── Wire up type chips ────────────────────────────────────────────────────
  _sdDetail.querySelectorAll('.sd-type-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      const next = chip.getAttribute('data-tab') || 'all';
      if (next === 'all') {
        _activeContentTab = 'all';
        _activeDomain = 'all';
      } else {
        // Toggle-off: clicking active chip resets to "all"
        _activeContentTab = (_activeContentTab === next) ? 'all' : next;
        _activeDomain = 'all';
      }
      persistListFilters();
      renderLandingRoute();
    });
  });

  // ── Wire up view-toggle ───────────────────────────────────────────────────
  const gridBtn = _sdDetail.querySelector('#pubViewGrid');
  const listBtn = _sdDetail.querySelector('#pubViewList');
  function applyViewToggle(view) {
    _pubArticleView = view;
    try { localStorage.setItem(PUB_VIEW_KEY, view); } catch (_) {}
    renderLandingMain();
  }
  if (gridBtn) gridBtn.addEventListener('click', function () { applyViewToggle('grid'); });
  if (listBtn) listBtn.addEventListener('click', function () { applyViewToggle('list'); });
}

function renderLandingRoute() {
  renderSidebar('list');
  renderLandingMain();
}

function rerenderSystemDesignView() {
  // Keep existing detail sidebar behavior; landing sidebar is rendered from route handler.
  if (_activeView === 'sysdesign' && _activeTopic) renderSidebar('detail');
  if (_activeView !== 'sysdesign') return;
  if (_activeTopic) renderTopicDetail();
  else renderLandingRoute();
}

function applyCmsTopics(topics) {
  if (!topics.length) return;
  _cmsTopics = topics;
  highlightActiveTopic();
  if (_activeTopic && !topicById(_activeTopic)) _activeTopic = topics[0].id;
}

async function loadTierConfig() {
  try {
    const resp = await fetch('/api/system-design/tier-config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!resp.ok) return;
    const data = await resp.json();
    _tierConfig = data.config || null;
  } catch (_) {
    // Non-fatal: tier gate will show article list fallback
  }
}

async function loadCmsTopics() {
  const force = arguments && arguments[0] && arguments[0].force === true;
  if (_cmsLoading) return;
  if (_cmsLoadStarted && !force) return;
  _cmsLoading = true;
  if (!_cmsLoadStarted) _cmsLoadStarted = true;
  try {
    const token = await authTokenOrNull();
    const [articlesResp] = await Promise.all([
      fetch(articlesApiUrl(), {
        headers: Object.assign({ Accept: 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        credentials: 'same-origin',
      }),
      loadTierConfig(),
    ]);
    if (!articlesResp.ok) return;
    const data = await articlesResp.json();
    const articles = Array.isArray(data.articles) ? data.articles : [];
    const topics = articles.map(normaliseCmsTopic).filter(Boolean);
    applyCmsTopics(topics);
  } catch (err) {
    console.warn('[system-design] content load failed:', err.message);
  } finally {
    _cmsLoaded = true;
    _cmsLoading = false;
    rerenderSystemDesignView();
  }
}

async function refreshSessionProfile() {
  try {
    if (!googleCredential) return;
    const resp = await fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: String(googleCredential) }),
      credentials: 'same-origin',
    });
    const data = await resp.json().catch(function () { return null; });
    if (!resp.ok || !data || !data.success) return;

    const merged = Object.assign({}, (siteProfile && typeof siteProfile === 'object') ? siteProfile : {}, {
      sub: data.sub,
      name: data.name || '',
      email: data.email || '',
      picture: data.picture || null,
      contact: data.contact || null,
      subscription: data.subscription || null,
    });
    setSiteProfile(merged);
  } catch (_) {}
}

// ── DOM construction (lazy, idempotent) ──────────────────────────────────────
function ensureDom() {
  const body = document.querySelector('.body');
  if (!body) return false;

  if (!_resumeAside) {
    _resumeAside = body.querySelector('aside');
    _resumeMain  = body.querySelector('main');
    if (_resumeAside) _resumeAside.classList.add('resume-aside');
    if (_resumeMain)  _resumeMain.classList.add('resume-main');
  }

  if (_sdAside && _sdDetail) return true;

  _sdAside = document.createElement('aside');
  _sdAside.className = 'sd-topics';
  _sdAside.setAttribute('hidden', '');

  function setSidebarCollapsed(collapsed) {
    body.classList.toggle('sd-topics-collapsed', !!collapsed);
    _userToggledSidebar = true;
    try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  // Restore persisted collapse state (desktop-only UI affordance).
  try {
    const persisted = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (persisted === '1') setSidebarCollapsed(true);
  } catch (_) {}

  _sdDetail = document.createElement('main');
  _sdDetail.className = 'sd-detail';
  _sdDetail.setAttribute('hidden', '');

  // No UI that collapses itself. Sidebar collapse is user-driven.

  body.appendChild(_sdAside);
  body.appendChild(_sdDetail);
  renderTopicList();
  return true;
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderTopicList() {
  if (!_sdAside) return;
  const query = normaliseText(_topicFilter);
  let html = '';
  html += '<div class="sd-topics-header">';
  html += '<div class="sd-topics-header-row">';
  html += '<label class="sd-topic-search">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
  html += '<input type="search" value="' + escapeHtml(_topicFilter) + '" placeholder="' + escapeHtml(uiText('search')) + '" aria-label="' + escapeHtml(uiText('search')) + '">';
  html += '</label>';
  html += '<button type="button" class="sd-topics-collapse-btn" aria-label="Collapse article list" title="Collapse article list">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>';
  html += '</button>';
  html += '</div>';
  html += '</div>';
  html += '<button type="button" class="sd-overview-link' + (!_activeTopic ? ' sd-active' : '') + '" data-topic-id="">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">dashboard</span>';
  html += '<span>Overview</span>';
  html += '</button>';
  html += '<div class="sd-topic-list" role="list">';
  let visibleCount = 0;
  Object.keys(CONTENT_TYPE_LABELS).forEach(function (type) {
    let group = '';
    let groupCount = 0;
    const topics = getTopics();
    for (const t of topics) {
      if (getContentType(t) !== type) continue;
      const loc = localeOf(t);
      const haystack = normaliseText(loc.title + ' ' + loc.subtitle + ' ' + (t.tags || []).join(' '));
      if (query && haystack.indexOf(query) === -1) continue;
      groupCount += 1;
      visibleCount += 1;
      const active   = t.id === _activeTopic ? ' sd-active' : '';
      const disabled = t.stub ? ' sd-disabled' : '';
      const premium  = t.tier === 'premium' ? ' sd-premium' : '';
      group += '<li class="sd-topic-item' + active + disabled + premium + '" data-topic-id="' + t.id + '">';
      group += '<button type="button" class="sd-topic-btn" data-topic-id="' + t.id + '"' + (t.id === _activeTopic ? ' aria-current="page"' : '') + '>';
      if (t.thumbnail) {
        group += '<img class="sd-topic-thumb" src="' + escapeHtml(t.thumbnail) + '" alt="" loading="lazy" aria-hidden="true">';
      }
      group += '<span class="sd-topic-text">';
      group += '<span class="sd-topic-title" data-i18n="' + topicKey(t.id, 'title') + '">' + escapeHtml(loc.title) + '</span>';
      group += '<span class="sd-topic-sub" data-i18n="' + topicKey(t.id, 'subtitle') + '">' + escapeHtml(loc.subtitle) + '</span>';
      group += '</span>';
      if (t.tier === 'premium' && t.hasAccess === false) {
        group += '<span class="material-symbols-outlined sd-lock-icon" aria-label="Locked">lock</span>';
      }
      group += '</button>';
      group += '</li>';
    }
    if (groupCount) {
      html += '<section class="sd-topic-group">';
      html += '<div class="sd-topic-group-title">' + escapeHtml(CONTENT_TYPE_LABELS[type]) + '</div>';
      html += '<ul role="list">' + group + '</ul>';
      html += '</section>';
    }
  });
  if (!visibleCount) {
    html += _cmsLoaded
      ? '<div class="sd-topic-empty">' + escapeHtml(uiText('noResults')) + '</div>'
      : '<div class="sd-topic-empty sd-topic-loading"><sd-loader size="sm" label="' + uiText('loading') + '"></sd-loader></div>';
  }
  html += '</div>';
  _sdAside.innerHTML = html;
  const collapseBtn = _sdAside.querySelector('.sd-topics-collapse-btn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', function () {
      const body = document.querySelector('.body');
      if (!body) return;
      const collapsed = body.classList.toggle('sd-topics-collapsed');
      _userToggledSidebar = true;
      try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {}
    });
    // Icon should reflect state.
    const body = document.querySelector('.body');
    const icon = collapseBtn.querySelector('.material-symbols-outlined');
    if (icon && body) {
      icon.textContent = body.classList.contains('sd-topics-collapsed') ? 'left_panel_open' : 'left_panel_close';
    }
    collapseBtn.addEventListener('click', function () {
      const body = document.querySelector('.body');
      const icon = collapseBtn.querySelector('.material-symbols-outlined');
      if (icon && body) icon.textContent = body.classList.contains('sd-topics-collapsed') ? 'left_panel_open' : 'left_panel_close';
    });
  }
  const search = _sdAside.querySelector('.sd-topic-search input');
  if (search) {
    search.addEventListener('input', function () {
      _topicFilter = search.value || '';
      renderTopicList();
      highlightActiveTopic();
      const nextSearch = _sdAside.querySelector('.sd-topic-search input');
      if (nextSearch) {
        nextSearch.focus();
        nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
      }
    });
  }
  _sdAside.querySelectorAll('.sd-topic-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      const id = b.getAttribute('data-topic-id');
      navigate(PATH_PREFIX + '/' + id);
      handleRoute();
    });
  });
  const overview = _sdAside.querySelector('.sd-overview-link');
  if (overview) {
    overview.addEventListener('click', function () {
      // Overview should land you in a "clean" library state.
      _activeContentTab = 'all';
      _activeDomain = 'all';
      _topicFilter = '';
      persistListFilters();
      navigate(PATH_PREFIX);
      handleRoute();
    });
  }
}

// ── List view helpers ─────────────────────────────────────────────────────────

function getArticleDomains(topics) {
  const domainCounts = {};
  topics.forEach(function (t) {
    (t.tags || []).forEach(function (tag) {
      domainCounts[tag] = (domainCounts[tag] || 0) + 1;
    });
  });
  return Object.keys(domainCounts)
    .map(function (name) { return { name: name, count: domainCounts[name] }; })
    .sort(function (a, b) { return b.count - a.count; });
}

function getContentType(topic) {
  const explicit = String(topic.contentType || '').trim();
  if (explicit === 'system-design' || explicit === 'architecture' || explicit === 'case-study') return explicit;
  return 'system-design';
}

function getContentTypeEyebrow(topic) {
  const type = getContentType(topic);
  if (type === 'case-study') return 'CASE STUDY';
  if (type === 'architecture') return 'ARCHITECTURE NOTE';
  return 'SYSTEM DESIGN';
}

function filterArticles(topics, contentTab, domain) {
  return topics.filter(function (t) {
    if (t.stub) return false;
    if (contentTab !== 'all' && getContentType(t) !== contentTab) return false;
    if (domain !== 'all' && !(t.tags || []).includes(domain)) return false;
    return true;
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderLanding() {
  if (!_sdDetail) return;
  // Bring back last-used filters for a smoother "continue reading" experience.
  restoreListFilters();
  const topics = getTopics();
  const published = topics.filter(function (t) { return !t.stub; });
  const domains = getArticleDomains(published);
  const filtered = filterArticles(topics, _activeContentTab, _activeDomain);

  let html = '<section class="sd-list-view">';

  // ── Header ──
  html += '<header class="sd-list-header">';
  html += '<h1 class="sd-list-title">' + escapeHtml(uiText('pageTitle')) + '</h1>';
  html += '<p class="sd-list-subtitle">' + escapeHtml(uiText('pageSubtitle')) + '</p>';

  // ── Content type tabs ──
  html += '<div class="sd-content-tabs-row">';
  html += '<nav class="sd-content-tabs" role="tablist">';
  CONTENT_TABS.forEach(function (tab) {
    const active = _activeContentTab === tab.id ? ' sd-tab-active' : '';
    html += '<button type="button" class="sd-content-tab' + active + '" data-tab="' + tab.id + '" role="tab" aria-selected="' + (_activeContentTab === tab.id) + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + tab.icon + '</span>';
    html += '<span>' + escapeHtml(tab.label) + '</span>';
    html += '</button>';
  });
  html += '</nav>';
  const canClear = !(_activeContentTab === 'all' && _activeDomain === 'all');
  html += '<button type="button" class="sd-clear-filters' + (canClear ? '' : ' sd-clear-filters-hidden') + '" aria-label="Clear filters">Clear</button>';
  html += '</div>';
  html += '</header>';

  // ── Main content area with sidebar ──
  html += '<div class="sd-list-body">';

  // ── Domains sidebar ──
  html += '<aside class="sd-domains-sidebar">';
  html += '<nav class="sd-domains-nav" role="list">';
  // "All" item
  const allActive = _activeDomain === 'all' ? ' sd-domain-active' : '';
  html += '<button type="button" class="sd-domain-item' + allActive + '" data-domain="all">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">apps</span>';
  html += '<span class="sd-domain-label">' + escapeHtml(uiText('all')) + '</span>';
  html += '<span class="sd-domain-count">' + published.length + '</span>';
  html += '</button>';
  // Domain items (hide 0-count)
  domains.forEach(function (d) {
    if (d.count === 0) return;
    const active = _activeDomain === d.name ? ' sd-domain-active' : '';
    const icon = DOMAIN_ICONS[d.name] || 'label';
    html += '<button type="button" class="sd-domain-item' + active + '" data-domain="' + escapeHtml(d.name) + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span>';
    html += '<span class="sd-domain-label">' + escapeHtml(d.name) + '</span>';
    html += '<span class="sd-domain-count">' + d.count + '</span>';
    html += '</button>';
  });
  html += '</nav>';
  html += '</aside>';

  // ── Article list ──
  html += '<div class="sd-article-list">';
  if (filtered.length) {
    filtered.forEach(function (t) {
      const loc = localeOf(t);
      const eyebrow = getContentTypeEyebrow(t);
      const premiumClass = t.tier === 'premium' ? ' sd-card-premium' : '';
      html += '<article class="sd-article-card' + premiumClass + '" data-topic-id="' + t.id + '">';

      // Thumbnail (icon-based for now)
      html += '<div class="sd-card-thumb">';
      html += '<span class="material-symbols-outlined">' + (t.icon || 'article') + '</span>';
      html += '</div>';

      // Content
      html += '<div class="sd-card-content">';
      html += '<div class="sd-card-eyebrow">' + escapeHtml(eyebrow) + '</div>';
      html += '<h2 class="sd-card-title">' + escapeHtml(loc.title) + '</h2>';
      html += '<p class="sd-card-subtitle">' + escapeHtml(loc.subtitle) + '</p>';

      // Tags
      if (t.tags && t.tags.length) {
        html += '<div class="sd-card-tags">';
        t.tags.slice(0, 4).forEach(function (tag) {
          html += '<span class="sd-card-tag">' + escapeHtml(tag) + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';

      // Meta (date + read time)
      html += '<div class="sd-card-meta">';
      if (t.publishedAt) {
        html += '<span class="sd-card-date"><span class="material-symbols-outlined">calendar_today</span>' + formatDate(t.publishedAt) + '</span>';
      }
      if (t.readMinutes) {
        html += '<span class="sd-card-read"><span class="material-symbols-outlined">schedule</span>' + t.readMinutes + ' ' + uiText('minRead') + '</span>';
      }
      html += '</div>';

      // Arrow
      html += '<div class="sd-card-arrow"><span class="material-symbols-outlined">arrow_forward</span></div>';

      if (t.tier === 'premium' && t.hasAccess === false) {
        html += '<span class="material-symbols-outlined sd-card-lock" aria-label="Locked">lock</span>';
      }
      html += '</article>';
    });
  } else {
    html += _cmsLoaded
      ? '<p class="sd-list-empty">' + escapeHtml(uiText('noResults')) + '</p>'
      : '<div class="sd-list-empty sd-list-loading"><sd-loader size="sm" label="' + uiText('loading') + '"></sd-loader></div>';
  }

  // Coming soon footer
  html += '<div class="sd-list-footer">' + escapeHtml(uiText('comingSoon')) + '</div>';
  html += '</div>'; // .sd-article-list

  html += '</div>'; // .sd-list-body
  html += '<div class="sd-sponsor-slot-placeholder" data-placement="homepage"></div>';
  html += '</section>';

  _sdDetail.innerHTML = html;

  // ── Event listeners ──
  // Content tabs
  _sdDetail.querySelectorAll('.sd-content-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      _activeContentTab = tab.getAttribute('data-tab');
      persistListFilters();
      renderLanding();
    });
  });
  // Domain filters
  _sdDetail.querySelectorAll('.sd-domain-item').forEach(function (item) {
    item.addEventListener('click', function () {
      _activeDomain = item.getAttribute('data-domain');
      persistListFilters();
      renderLanding();
    });
  });
  const clearBtn = _sdDetail.querySelector('.sd-clear-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      _activeContentTab = 'all';
      _activeDomain = 'all';
      persistListFilters();
      renderLanding();
    });
  }
  // Article cards
  _sdDetail.querySelectorAll('.sd-article-card').forEach(function (card) {
    card.addEventListener('click', function () {
      navigate(PATH_PREFIX + '/' + card.getAttribute('data-topic-id'));
      handleRoute();
    });
  });

  const homeSlot = _sdDetail.querySelector('.sd-sponsor-slot-placeholder[data-placement="homepage"]');
  if (homeSlot) mountSponsorSlot(homeSlot, 'homepage');
}

function renderTopicDetail() {
  if (!_sdDetail) return;
  const topic = topicById(_activeTopic);
  if (!topic) {
    _sdDetail.innerHTML = _cmsLoaded
      ? '<div class="sd-detail-empty">' + escapeHtml(uiText('unavailable')) + '</div>'
      : '<div class="sd-detail-empty sd-detail-loading"><sd-loader size="sm" label="' + uiText('loading') + '"></sd-loader></div>';
    return;
  }
  const loc = localeOf(topic);
  // Detail header: back arrow + content-type chips + article title
  let html = '<nav class="sd-article-breadcrumb" aria-label="Breadcrumb">';
  // Row 1: back arrow + chips
  html += '<div class="sd-article-breadcrumb-row">';
  html += '<div class="sd-type-chips sd-detail-chips" role="group" aria-label="Filter by type">';
  const allActive = (_activeContentTab === 'all' && _activeDomain === 'all') ? ' sd-type-chip-active' : '';
  html += '<button type="button" class="sd-type-chip' + allActive + '" data-tab="all">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">apps</span>';
  html += escapeHtml(currentLang === 'fr' ? 'Tous' : 'All Articles');
  html += '</button>';
  CONTENT_TABS.forEach(function (tab) {
    if (tab.id === 'all') return;
    const active = _activeContentTab === tab.id ? ' sd-type-chip-active' : '';
    html += '<button type="button" class="sd-type-chip' + active + '" data-tab="' + tab.id + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + tab.icon + '</span>';
    html += escapeHtml(tab.label);
    html += '</button>';
  });
  html += '</div>';
  html += '</div>';
  html += '</nav>';
  html += '<article class="sd-article">';
  html += '<header class="sd-article-head">';
  html += '<h2 class="sd-article-title">' + escapeHtml(loc.title) + '</h2>';
  if (loc.subtitle) {
    html += '<p class="sd-article-sub">' + escapeHtml(loc.subtitle) + '</p>';
  }
  html += '<div class="sd-article-meta">';
  if (topic.tags && topic.tags.length) {
    html += '<div class="sd-tags">';
    for (let i = 0; i < topic.tags.length; i++) {
      html += '<span class="sd-tag">' + escapeHtml(topic.tags[i]) + '</span>';
    }
    html += '</div>';
  }
  // Right-aligned actions cluster (so Export PDF stays right even when read time is missing).
  html += '<div class="sd-article-actions">';
  if (topic.readMinutes) {
    html += '<span class="sd-readtime"><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + topic.readMinutes + ' min</span>';
  }
  html += '<button type="button" class="sd-export-btn" aria-label="' + escapeHtml(uiText('exportPdf')) + '">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>';
  html += '<span>' + escapeHtml(uiText('exportPdf')) + '</span>';
  html += '</button>';
  html += '</div>';
  html += '</div>';
  html += '</header>';
  if (topic.tier === 'premium' && topic.hasAccess === false) {
    // Use admin-configured benefit items if available, else fall back to article list
    let freeItems, premItems;
    if (_tierConfig && (_tierConfig.free?.items?.length || _tierConfig.premium?.items?.length)) {
      freeItems = (_tierConfig.free?.items  || []).map(function (i) { return { icon: i.icon  || 'article', label: i.label, locked: false }; });
      premItems = (_tierConfig.premium?.items || []).map(function (i) { return { icon: i.icon || 'article', label: i.label, locked: true }; });
    } else {
      const allTopics = getTopics().filter(function (t) { return !t.stub; });
      freeItems = allTopics.filter(function (t) { return t.tier !== 'premium'; })
        .map(function (t) { return { icon: t.icon || 'article', label: localeOf(t).title, locked: false }; });
      premItems = allTopics.filter(function (t) { return t.tier === 'premium'; })
        .map(function (t) { return { icon: t.icon || 'article', label: localeOf(t).title, locked: true }; });
    }

    html += '<div class="sd-tier-gate">';

    // Free tier card
    html += '<div class="sd-tier-card sd-tier-free">';
    html += '<div class="sd-tier-card-head">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">lock_open</span>';
    html += '<div><h3>Free Tier</h3><p>Available to everyone</p></div>';
    html += '</div>';
    html += iconCardsHtml(freeItems, { size: 'sm' });
    html += '</div>';

    // Premium tier card
    html += '<div class="sd-tier-card sd-tier-premium">';
    html += '<div class="sd-tier-card-head">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">workspace_premium</span>';
    html += '<div><h3>Premium Tier</h3><p>Unlock premium articles.</p></div>';
    html += '</div>';
    html += iconCardsHtml(premItems, { size: 'sm' });
    html += '<button type="button" id="sdSubscribeBtn" class="sd-locked-cta">Subscribe</button>';
    html += '<button type="button" id="sdManageSubBtn" class="sd-locked-cta sd-locked-cta-secondary" hidden>Manage</button>';
    html += '</div>';

    html += '</div>';
  } else {
    const bodyHtml = (topic.blocks && topic.blocks.length) ? blocksToHtml(topic.blocks) : (loc.body || '');
    html += '<div class="sd-article-body">' + bodyHtml + '</div>';
  }
  html += '</article>';
  // Sponsor slot placeholder — mounted asynchronously below
  html += '<div class="sd-sponsor-slot-placeholder" data-placement="article-footer"></div>';
  _sdDetail.innerHTML = html;

  _sdDetail.querySelectorAll('.sd-detail-chips .sd-type-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      _activeContentTab = chip.getAttribute('data-tab') || 'all';
      _activeDomain = 'all';
      persistListFilters();
      navigate(PATH_PREFIX);
      handleRoute();
    });
  });

  const exportBtn = _sdDetail.querySelector('.sd-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportCurrentTopicPdf);

  // Premium gate UX: "Subscribe" -> Stripe Checkout.
  const buyNowBtn    = _sdDetail.querySelector('#sdSubscribeBtn');
  const manageBtn    = _sdDetail.querySelector('#sdManageSubBtn');
  function openUrl(url) {
    if (!url) return;
    try {
      const win = window.open(url, '_blank', 'noopener');
      // Never fall back to location.href for _blank — that navigates the current page.
      if (!win) showToast('Popup blocked — allow popups for this site, then try again.', { kind: 'info', duration: 6000 });
    } catch (_) {
      showToast('Could not open the page. Please allow popups and try again.', { kind: 'error', duration: 6000 });
    }
  }

  async function createCheckoutSession() {
    const _token = await authTokenOrNull();
    if (!forceLockedEnabled() && await isLocalPreviewEnabled()) {
      try { sessionStorage.removeItem('pending_subscribe'); } catch (_) {}
      closeWelcomeOverlayIfOpen();
      return;
    }
    // Modal-only UX: do NOT navigate away to Stripe-hosted pages.
    // Stripe-hosted checkout pages cannot be embedded in a modal; use Embedded Checkout instead.
    await openBillingCheckoutModal({
      plan: 'monthly',
      openContactInfo: function () {
        if (typeof window.openContactInfo === 'function') window.openContactInfo();
      },
    });
  }

  async function openPortal() {
    const token = await authTokenOrNull();
    if (!token) return createCheckoutSession();
    const resp = await fetch('/api/billing/portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    const data = await resp.json().catch(function () { return null; });
    if (!resp.ok || !data || !data.url) {
      // If user doesn't have a customer yet, fallback to checkout.
      return createCheckoutSession();
    }
    openUrl(data.url);
  }

  // Toggle CTA if the signed-in user is already a subscriber.
  try {
    const subActive = !!(siteProfile && siteProfile.subscription && siteProfile.subscription.active);
    const isPromo = !!(siteProfile && siteProfile.subscription && siteProfile.subscription.promo);
    if (subActive) {
      if (buyNowBtn) buyNowBtn.hidden = true;
      if (manageBtn) manageBtn.hidden = isPromo;
    }
  } catch (_) {}

  if (buyNowBtn) {
    buyNowBtn.addEventListener('click', function () {
      buyNowBtn.disabled = true;
      // Immediate feedback so it never feels like a dead click.
      buyNowBtn.textContent = 'Starting…';
      createCheckoutSession().catch(function (err) {
        if (!(err && err.toastShown)) {
          showToast(err.message || 'Subscribe failed.', { kind: 'error' });
        }
      }).finally(function () {
        buyNowBtn.disabled = false;
        buyNowBtn.textContent = 'Subscribe';
      });
    });
  }
  if (manageBtn) {
    manageBtn.addEventListener('click', function () {
      manageBtn.disabled = true;
      openPortal().catch(function (err) {
        showToast(err.message || 'Billing portal failed.', { kind: 'error' });
      }).finally(function () {
        manageBtn.disabled = false;
      });
    });
  }
  if (typeof _sdDetail.scrollIntoView === 'function') {
    _sdDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Mount sponsor slot asynchronously so it never blocks rendering
  const slotEl = _sdDetail.querySelector('.sd-sponsor-slot-placeholder');
  if (slotEl) mountSponsorSlot(slotEl, 'article-footer');
}

function exportCurrentTopicPdf() {
  if (!_activeTopic) return;

  const btn = _sdDetail && _sdDetail.querySelector('.sd-export-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">hourglass_top</span>' +
      '<span>Generating…</span>';
  }

  fetch('/api/pdf/export?id=' + encodeURIComponent(_activeTopic), {
    headers: googleCredential ? { 'Authorization': 'Bearer ' + googleCredential } : undefined,
  })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (body) {
          throw new Error(body.error || ('HTTP ' + res.status));
        });
      }
      return res.blob();
    })
    .then(function (blob) {
      // Trigger a file download in the browser — clean filename, no dialog.
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = _activeTopic + '-software-architecture.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Best-effort analytics (must never block download UX).
      try {
        const cid = localStorage.getItem('portfolio_anon_cid_v1') || '';
        if (navigator.sendBeacon && cid) {
          const payload = JSON.stringify({ clientId: cid, type: 'pdf_download', pdfKind: 'software-architecture', pdfId: _activeTopic, path: location.pathname + location.search });
          navigator.sendBeacon('/api/analytics/event', new Blob([payload], { type: 'application/json' }));
        }
      } catch (_) {}
    })
    .catch(function (err) {
       
      console.error('[PDF export]', err);
      showToast('PDF generation failed: ' + err.message, { kind: 'error', duration: 7000 });
    })
    .finally(function () {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML =
          '<span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>' +
          '<span>' + (typeof uiText === 'function' ? uiText('exportPdf') : 'Export PDF') + '</span>';
      }
    });
}

function highlightActiveTopic() {
  if (!_sdAside) return;
  _sdAside.querySelectorAll('.sd-topic-item').forEach(function (li) {
    if (li.getAttribute('data-topic-id') === _activeTopic) li.classList.add('sd-active');
    else li.classList.remove('sd-active');
  });
}

// ── View toggle ──────────────────────────────────────────────────────────────
function setView(view) {
  if (!ensureDom()) return;
  _activeView = view;
  const sysOn = view === 'sysdesign';
  try {
    // Reading mode: hide portfolio identity header; focus on content discovery.
    document.documentElement.classList.toggle('sa-reading', sysOn);
  } catch (_) {}
  const body = document.querySelector('.body');
  if (body) {
    body.classList.toggle('sd-mode', sysOn);
    // Remove list-mode class when leaving system design view
    if (!sysOn) body.classList.remove('sd-list-mode');
  }
  if (_resumeAside) _resumeAside.toggleAttribute('hidden', sysOn);
  if (_resumeMain)  _resumeMain.toggleAttribute('hidden', sysOn);
  _sdAside.toggleAttribute('hidden', !sysOn);
  _sdDetail.toggleAttribute('hidden', !sysOn);
  updateButton();
}

function updateButton() {
  const homeBtn = document.querySelector('.home-btn');
  const sysOn = _activeView === 'sysdesign';

  if (homeBtn) {
    homeBtn.setAttribute('aria-pressed', sysOn ? 'false' : 'true');
  }
  if (!_btn) return;

  const label = _btn.querySelector('[data-i18n="systemDesign"]');
  const icon  = _btn.querySelector('.material-symbols-outlined');
  if (label) {
    label.textContent = currentLang === 'fr' ? 'Architecture logicielle' : 'Software Architecture';
  }
  if (icon) icon.textContent = 'account_tree';
  _btn.setAttribute('aria-pressed', sysOn ? 'true' : 'false');
}

// ── History API routing ──────────────────────────────────────────────────────
// URLs: /software-architecture           → topic list landing
//       /software-architecture/<id>      → specific article
// The server catch-all serves index.html for every /software-architecture/* path so
// direct loads, reloads, and social shares all work correctly.
// Legacy hash URLs (#/system-design/…) are redirected on init.

function readPath() {
  const p = location.pathname || '/';
  if (p.startsWith(PATH_PREFIX)) {
    const rest = p.slice(PATH_PREFIX.length).replace(/^\//, '');
    return { id: rest || null, legacy: false };
  }
  if (p.startsWith(LEGACY_PREFIX)) {
    const rest = p.slice(LEGACY_PREFIX.length).replace(/^\//, '');
    return { id: rest || null, legacy: true };
  }
  return null;
}

function navigate(path, replace) {
  if (replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
}

function handleRoute() {
  const route = readPath();
  if (!route) {
    if (_activeView === 'sysdesign') {
      resetMeta();
      setView('resume');
    }
    return;
  }
  // If we landed on the legacy URL, replace it with the new one immediately.
  if (route.legacy) {
    const target = PATH_PREFIX + (route.id ? '/' + route.id : '');
    navigate(target, true);
  }
  let id = route.id;
  if (!id) {
    _activeTopic = null;
    resetMeta();
    setView('sysdesign');
    // Landing view uses the left sidebar for filters (matches reference design)
    if (_sdAside) _sdAside.removeAttribute('hidden');
    const body = document.querySelector('.body');
    if (body) {
      body.classList.add('sd-sa-list');
      body.classList.remove('sd-list-mode');
      // Restore persisted collapse for list view
      try {
        const persisted = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
        body.classList.toggle('sd-topics-collapsed', persisted === '1');
      } catch (_) {}
    }
    renderLandingRoute();
    return;
  }
  const topics = getTopics();
  if (!topicById(id) && topics.length) id = topics[0].id;
  _activeTopic = id;
  recordArticleVisit(id);
  _userToggledSidebar = false;
  applyArticleMeta(topicById(id));
  setView('sysdesign');
  // Show old sidebar for article detail view
  if (_sdAside) _sdAside.removeAttribute('hidden');
  const body = document.querySelector('.body');
  if (body) {
    body.classList.remove('sd-list-mode');
    body.classList.remove('sd-sa-list');
    // Allow collapse in detail view too (same rail model as reference)
    try {
      const persisted = localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
      body.classList.toggle('sd-topics-collapsed', persisted === '1');
    } catch (_) {}
  }
  renderSidebar('detail');
  highlightActiveTopic();
  renderTopicDetail();
}

// ── Public API ───────────────────────────────────────────────────────────────
export function openSystemDesign(id) {
  ensureDom();
  if (id && topicById(id)) {
    navigate(PATH_PREFIX + '/' + id);
    handleRoute();
    return;
  }
  if (_activeView === 'sysdesign') return;
  navigate(PATH_PREFIX);
  handleRoute();
}

export function closeSystemDesign() {
  navigate('/', true);
  resetMeta();
  setView('resume');
}

export function initSystemDesign() {
  _btn = document.querySelector('.systemdesign-btn');
  ensureDom();
  loadSeoConfig(); // non-blocking — updates meta tags and SITE_BASE from Firestore
  loadCmsTopics();

  // Billing claim flow (Stripe return_url + auto-claim after sign-in).
  initBillingClaimFlow({
    getCredential: function () { return googleCredential; },
    getAuthTokenOrNull: authTokenOrNull,
    showWelcomeOverlay: function () {
      if (typeof window.showWelcomeOverlay === 'function') window.showWelcomeOverlay();
    },
    openBillingPortal: async function () {
      const token = await authTokenOrNull();
      if (!token) return false;
      const resp = await fetch('/api/billing/portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const data = await resp.json().catch(function () { return null; });
      if (!resp.ok || !data || !data.url) return false;
      try {
        const win = window.open(String(data.url), '_blank', 'noopener');
        if (!win) showToast('Popup blocked — allow popups for this site, then try again.', { kind: 'info', duration: 6000 });
      } catch (_) {
        showToast('Could not open billing portal. Please allow popups and try again.', { kind: 'error', duration: 6000 });
      }
      return true;
    },
    onClaimed: function () {
      refreshSessionProfile().finally(function () {
        loadCmsTopics({ force: true });
      });
      handleRoute();
    },
  });

  window.addEventListener('popstate', handleRoute);
  // Refresh visit badges when the page is restored from bfcache (browser back/forward).
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && !_activeTopic) renderLandingMain();
  });
  const observer = new MutationObserver(function () {
    renderTopicList();
    highlightActiveTopic();
    if (_activeView === 'sysdesign') {
      // When on the landing (list) route, _activeTopic is null and the list view
      // owns _sdDetail. Don't let renderTopicDetail() wipe it on locale flips.
      if (_activeTopic) renderTopicDetail();
      else renderLanding();
    }
    updateButton();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // Redirect legacy hash URLs (#/system-design/…) to clean paths
  if (location.hash && location.hash.startsWith('#/system-design')) {
    const legacyId = location.hash.slice('#/system-design'.length).replace(/^\//, '');
    const newPath  = PATH_PREFIX + (legacyId ? '/' + legacyId : '');
    navigate(newPath, true);
  }

  // Handle direct navigation to /software-architecture (new) or /system-design (legacy)
  if (location.pathname.startsWith(PATH_PREFIX) || location.pathname.startsWith(LEGACY_PREFIX)) {
    handleRoute();
  }
}
