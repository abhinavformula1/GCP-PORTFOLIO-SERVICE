/**
 * System Design view -- master/detail topic browser.
 *
 * A second persona for the same body grid: instead of "About + Skills" on
 * the left and "Work Experience + Projects" on the right, we surface a
 * curated catalogue of architecture / design write-ups (left) with the
 * selected topic's full body (right). The resume DOM is hidden, not
 * removed, so:
 *   - the Download Resume button keeps scraping the resume nodes via
 *     querySelector ([hidden] doesn't affect that), and
 *   - flipping back to the resume view is instantaneous (no re-render).
 *
 * URL hash routing -- #/system-design/<topic-id> -- is the source of
 * truth for which topic is rendered. That means back/forward, deep
 * links pasted to a colleague, and reload all converge on the same
 * state.
 *
 * Locale flip -- listens for the <html lang> attribute mutation that
 * applyPageLang performs at the end of every language switch -- and
 * re-renders the active topic body in the new locale. Topic short
 * labels (title/subtitle) are also exposed via PAGE_LANG so the page-
 * level translator picks them up for free.
 */

import { currentLang } from '../core/i18n.js';
import { blocksToHtml } from './sdblocks.js';

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

const HASH_PREFIX = '#/system-design';
const CATEGORY_LABELS = {
  integration: 'Integration',
  architecture: 'Architecture',
  scale: 'Scale',
  security: 'Security',
  delivery: 'Delivery',
};

function topicById(id) {
  const topics = getTopics();
  for (const topic of topics) {
    if (topic.id === id) return topic;
  }
  return null;
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
    category:    article.category || 'architecture',
    icon:        article.icon || 'article',
    status:      article.status || 'Published',
    tags:        Array.isArray(article.tags) ? article.tags : [],
    readMinutes: Number(article.readMinutes || 5),
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

async function loadCmsTopics() {
  if (_cmsLoadStarted) return;
  _cmsLoadStarted = true;
  try {
    const resp = await fetch('/api/system-design/articles', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!resp.ok) return;
    const data = await resp.json();
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

  _sdDetail = document.createElement('main');
  _sdDetail.className = 'sd-detail';
  _sdDetail.setAttribute('hidden', '');

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
  html += '<div class="sd-eyebrow" data-i18n="systemDesignEyebrow">System Design</div>';
  html += '<h2 class="sd-topics-title">' + escapeHtml(uiText('title')) + '</h2>';
  html += '<p class="sd-topics-intro">' + escapeHtml(uiText('intro')) + '</p>';
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
  Object.keys(CATEGORY_LABELS).forEach(function (category) {
    let group = '';
    let groupCount = 0;
    const topics = getTopics();
    for (const t of topics) {
      if ((t.category || 'architecture') !== category) continue;
      const loc = localeOf(t);
      const haystack = normaliseText(loc.title + ' ' + loc.subtitle + ' ' + (t.tags || []).join(' '));
      if (query && haystack.indexOf(query) === -1) continue;
      groupCount += 1;
      visibleCount += 1;
      const active = t.id === _activeTopic ? ' sd-active' : '';
      const disabled = t.stub ? ' sd-disabled' : '';
      group += '<li class="sd-topic-item' + active + disabled + '" data-topic-id="' + t.id + '">';
      group += '<button type="button" class="sd-topic-btn" data-topic-id="' + t.id + '"' + (t.id === _activeTopic ? ' aria-current="page"' : '') + '>';
      if (t.thumbnail) {
        group += '<img class="sd-topic-thumb" src="' + escapeHtml(t.thumbnail) + '" alt="" loading="lazy" aria-hidden="true">';
      } else {
        group += '<span class="material-symbols-outlined sd-topic-icon" aria-hidden="true">' + (t.icon || 'article') + '</span>';
      }
      group += '<span class="sd-topic-text">';
      group += '<span class="sd-topic-title" data-i18n="' + topicKey(t.id, 'title') + '">' + escapeHtml(loc.title) + '</span>';
      group += '<span class="sd-topic-sub" data-i18n="' + topicKey(t.id, 'subtitle') + '">' + escapeHtml(loc.subtitle) + '</span>';
      group += '</span>';
      group += '</button>';
      group += '</li>';
    }
    if (groupCount) {
      html += '<section class="sd-topic-group">';
      html += '<div class="sd-topic-group-title">' + escapeHtml(CATEGORY_LABELS[category]) + '</div>';
      html += '<ul role="list">' + group + '</ul>';
      html += '</section>';
    }
  });
  if (!visibleCount) {
    html += '<div class="sd-topic-empty">' + escapeHtml(_cmsLoaded ? uiText('noResults') : uiText('loading')) + '</div>';
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
      location.hash = HASH_PREFIX + '/' + id;
    });
  });
  const overview = _sdAside.querySelector('.sd-overview-link');
  if (overview) {
    overview.addEventListener('click', function () {
      location.hash = HASH_PREFIX;
    });
  }
}

function renderLanding() {
  if (!_sdDetail) return;
  const topics = getTopics();
  const published = topics.filter(function (t) { return !t.stub; });
  const soon = topics.filter(function (t) { return t.stub; });
  let html = '';
  html += '<section class="sd-landing">';
  html += '<div class="sd-landing-hero">';
  html += '<div class="sd-article-eyebrow">System Design</div>';
  html += '<h2>Architecture Notes</h2>';
  html += '<p>Deep-dive notes on Salesforce, GCP, MuleSoft, scale, security, and integration trade-offs. Built for recruiters, architects, and security reviewers who want more than resume bullets.</p>';
  html += '</div>';
  html += '<h3>Published notes</h3>';
  if (published.length) {
    html += '<div class="sd-landing-grid">';
    published.forEach(function (t) {
      const loc = localeOf(t);
      html += '<button type="button" class="sd-landing-card" data-topic-id="' + t.id + '">';
      html += '<span class="material-symbols-outlined" aria-hidden="true">' + (t.icon || 'article') + '</span>';
      html += '<strong>' + escapeHtml(loc.title) + '</strong>';
      html += '<small>' + escapeHtml(loc.subtitle) + '</small>';
      html += '</button>';
    });
    html += '</div>';
  } else {
    html += '<p class="sd-detail-empty">' + escapeHtml(_cmsLoaded ? uiText('unavailable') : uiText('loading')) + '</p>';
  }
  if (soon.length) {
    html += '<h3>Coming next</h3>';
    html += '<div class="sd-coming-grid">';
    soon.forEach(function (t) {
      const loc = localeOf(t);
      html += '<div class="sd-coming-card"><strong>' + escapeHtml(loc.title) + '</strong><span>Draft</span></div>';
    });
    html += '</div>';
  }
  html += '</section>';
  _sdDetail.innerHTML = html;
  _sdDetail.querySelectorAll('.sd-landing-card').forEach(function (card) {
    card.addEventListener('click', function () {
      location.hash = HASH_PREFIX + '/' + card.getAttribute('data-topic-id');
    });
  });
}

function renderTopicDetail() {
  if (!_sdDetail) return;
  const topic = topicById(_activeTopic);
  if (!topic) {
    _sdDetail.innerHTML = '<div class="sd-detail-empty">' + escapeHtml(_cmsLoaded ? uiText('unavailable') : uiText('loading')) + '</div>';
    return;
  }
  const loc = localeOf(topic);
  let html = '<article class="sd-article">';
  html += '<header class="sd-article-head">';
  html += '<div class="sd-article-eyebrow">' + escapeHtml(uiText('articleLabel')) + '</div>';
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
  if (topic.readMinutes) {
    html += '<span class="sd-readtime"><span class="material-symbols-outlined" aria-hidden="true">schedule</span>' + topic.readMinutes + ' min</span>';
  }
  html += '<button type="button" class="sd-export-btn" aria-label="' + escapeHtml(uiText('exportPdf')) + '">';
  html += '<span class="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>';
  html += '<span>' + escapeHtml(uiText('exportPdf')) + '</span>';
  html += '</button>';
  html += '</div>';
  html += '</header>';
  const bodyHtml = (topic.blocks && topic.blocks.length) ? blocksToHtml(topic.blocks) : (loc.body || '');
  html += '<div class="sd-article-body">' + bodyHtml + '</div>';
  html += '</article>';
  _sdDetail.innerHTML = html;
  const exportBtn = _sdDetail.querySelector('.sd-export-btn');
  if (exportBtn) exportBtn.addEventListener('click', exportCurrentTopicPdf);
  if (typeof _sdDetail.scrollIntoView === 'function') {
    _sdDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
  if (body) body.classList.toggle('sd-mode', sysOn);
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
    label.textContent = currentLang === 'fr' ? 'Conception systeme' : 'System Design';
  }
  if (icon) icon.textContent = 'schema';
  _btn.setAttribute('aria-pressed', sysOn ? 'true' : 'false');
}

// ── Hash routing ─────────────────────────────────────────────────────────────
function readHash() {
  const h = location.hash || '';
  if (h.indexOf(HASH_PREFIX) !== 0) return null;
  const rest = h.slice(HASH_PREFIX.length).replace(/^\//, '');
  return { id: rest || null };
}

function handleRoute() {
  const route = readHash();
  if (!route) {
    if (_activeView === 'sysdesign') setView('resume');
    return;
  }
  let id = route.id;
  if (!id) {
    _activeTopic = null;
    setView('sysdesign');
    renderTopicList();
    renderLanding();
    return;
  }
  const topics = getTopics();
  if (!topicById(id) && topics.length) id = topics[0].id;
  _activeTopic = id;
  setView('sysdesign');
  renderTopicList();
  highlightActiveTopic();
  renderTopicDetail();
}

// ── Public API ───────────────────────────────────────────────────────────────
export function openSystemDesign(id) {
  ensureDom();
  if (id && topicById(id)) {
    location.hash = HASH_PREFIX + '/' + id;
    return;
  }
  if (_activeView === 'sysdesign') {
    return;
  }
  location.hash = HASH_PREFIX;
}

export function closeSystemDesign() {
  if (location.hash && location.hash.indexOf(HASH_PREFIX) === 0) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  setView('resume');
}

export function initSystemDesign() {
  _btn = document.querySelector('.systemdesign-btn');
  ensureDom();
  loadCmsTopics();
  window.addEventListener('hashchange', handleRoute);
  const observer = new MutationObserver(function () {
    renderTopicList();
    highlightActiveTopic();
    if (_activeView === 'sysdesign') renderTopicDetail();
    updateButton();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  if (location.hash && location.hash.indexOf(HASH_PREFIX) === 0) {
    handleRoute();
  }
}
