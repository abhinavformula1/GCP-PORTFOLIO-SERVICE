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
 * URL routing: uses the History API (/system-design/<id>) so every
 * article gets a real, crawlable URL that Google can index. The server
 * catch-all serves index.html for any /system-design/* path so direct
 * loads and reloads work correctly.
 *
 * Locale flip -- listens for the <html lang> attribute mutation that
 * applyPageLang performs at the end of every language switch -- and
 * re-renders the active topic body in the new locale.
 */

import { currentLang } from '../core/i18n.js';
import { blocksToHtml } from './sdblocks.js';
import { iconCardsHtml } from './iconcards.js';
import { mountSponsorSlot } from './sponsorship.js';

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
let _cmsLoaded   = false;
let _tierConfig  = null;
let _userToggledSidebar = false;

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

const PATH_PREFIX = '/system-design';
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

function rerenderSystemDesignView() {
  renderTopicList();
  if (_activeView !== 'sysdesign') return;
  if (_activeTopic) renderTopicDetail();
  else renderLanding();
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
  if (_cmsLoadStarted) return;
  _cmsLoadStarted = true;
  try {
    const [articlesResp] = await Promise.all([
      fetch('/api/system-design/articles', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }),
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
    rerenderSystemDesignView();
  }
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

  // Collapse tab — always visible even when sidebar is collapsed
  const collapseTab = document.createElement('button');
  collapseTab.type = 'button';
  collapseTab.className = 'sd-topics-collapse-tab';
  collapseTab.setAttribute('aria-label', 'Expand article list');
  collapseTab.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>';
  collapseTab.addEventListener('click', function () {
    const collapsed = body.classList.toggle('sd-topics-collapsed');
    collapseTab.setAttribute('aria-label', collapsed ? 'Expand article list' : 'Collapse article list');
    collapseTab.querySelector('.material-symbols-outlined').textContent = collapsed ? 'chevron_right' : 'chevron_left';
    _userToggledSidebar = true;
  });
  _sdAside.appendChild(collapseTab);

  _sdDetail = document.createElement('main');
  _sdDetail.className = 'sd-detail';
  _sdDetail.setAttribute('hidden', '');

  // Auto-collapse sidebar when user scrolls 300px into article detail
  let _scrollTimer = null;
  _sdDetail.addEventListener('scroll', function () {
    if (_userToggledSidebar) return;
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(function () {
      const shouldCollapse = _sdDetail.scrollTop > 300 && !!_activeTopic;
      const isCollapsed = body.classList.contains('sd-topics-collapsed');
      if (shouldCollapse !== isCollapsed) {
        body.classList.toggle('sd-topics-collapsed', shouldCollapse);
        collapseTab.setAttribute('aria-label', shouldCollapse ? 'Expand article list' : 'Collapse article list');
        collapseTab.querySelector('.material-symbols-outlined').textContent = shouldCollapse ? 'chevron_right' : 'chevron_left';
      }
    }, 80);
  });

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
  html += '<label class="sd-topic-search">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">search</span>';
  html += '<input type="search" value="' + escapeHtml(_topicFilter) + '" placeholder="' + escapeHtml(uiText('search')) + '" aria-label="' + escapeHtml(uiText('search')) + '">';
  html += '</label>';
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
      if (t.tier === 'premium') {
        group += '<span class="material-symbols-outlined sd-lock-icon" aria-label="Premium">lock</span>';
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
  html += '<nav class="sd-content-tabs" role="tablist">';
  CONTENT_TABS.forEach(function (tab) {
    const active = _activeContentTab === tab.id ? ' sd-tab-active' : '';
    html += '<button type="button" class="sd-content-tab' + active + '" data-tab="' + tab.id + '" role="tab" aria-selected="' + (_activeContentTab === tab.id) + '">';
    html += '<span class="material-symbols-outlined" aria-hidden="true">' + tab.icon + '</span>';
    html += '<span>' + escapeHtml(tab.label) + '</span>';
    html += '</button>';
  });
  html += '</nav>';
  html += '</header>';

  // ── Main content area with sidebar ──
  html += '<div class="sd-list-body">';

  // ── Domains sidebar ──
  html += '<aside class="sd-domains-sidebar">';
  html += '<div class="sd-domains-title">' + escapeHtml(uiText('domains')) + '</div>';
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

      if (t.tier === 'premium') {
        html += '<span class="material-symbols-outlined sd-card-lock" aria-label="Premium">lock</span>';
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
      renderLanding();
    });
  });
  // Domain filters
  _sdDetail.querySelectorAll('.sd-domain-item').forEach(function (item) {
    item.addEventListener('click', function () {
      _activeDomain = item.getAttribute('data-domain');
      renderLanding();
    });
  });
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
  let html = '<article class="sd-article">';
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
  if (topic.tier === 'premium') {
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
    html += '<div><h3>Premium Tier</h3><p>Get in touch to unlock</p></div>';
    html += '</div>';
    html += iconCardsHtml(premItems, { size: 'sm' });
    html += '<a href="mailto:abhinavformula1@gmail.com?subject=Premium%20Access%20Request" class="sd-locked-cta">Get in touch</a>';
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
  const exportBtn = _sdDetail.querySelector('.sd-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportCurrentTopicPdf);
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

  fetch('/api/pdf/export?id=' + encodeURIComponent(_activeTopic))
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
      link.download = _activeTopic + '-system-design.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    })
    .catch(function (err) {
       
      console.error('[PDF export]', err);
      alert('PDF generation failed: ' + err.message);
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
// URLs: /system-design           → topic list landing
//       /system-design/<id>      → specific article
// The server catch-all serves index.html for every /system-design/* path so
// direct loads, reloads, and social shares all work correctly.
// Legacy hash URLs (#/system-design/…) are redirected on init.

function readPath() {
  const p = location.pathname || '/';
  if (!p.startsWith(PATH_PREFIX)) return null;
  const rest = p.slice(PATH_PREFIX.length).replace(/^\//, '');
  return { id: rest || null };
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
  let id = route.id;
  if (!id) {
    _activeTopic = null;
    resetMeta();
    setView('sysdesign');
    // Hide old sidebar on landing view — the new list view has its own sidebar
    if (_sdAside) _sdAside.setAttribute('hidden', '');
    const body = document.querySelector('.body');
    if (body) body.classList.add('sd-list-mode');
    renderLanding();
    return;
  }
  const topics = getTopics();
  if (!topicById(id) && topics.length) id = topics[0].id;
  _activeTopic = id;
  _userToggledSidebar = false;
  applyArticleMeta(topicById(id));
  setView('sysdesign');
  // Show old sidebar for article detail view
  if (_sdAside) _sdAside.removeAttribute('hidden');
  const body = document.querySelector('.body');
  if (body) body.classList.remove('sd-list-mode');
  renderTopicList();
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
  window.addEventListener('popstate', handleRoute);
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

  // Handle direct navigation to /system-design or /system-design/<id>
  if (location.pathname.startsWith(PATH_PREFIX)) {
    handleRoute();
  }
}
