/**
 * Articles module — article list, rich-text editor, sections, publish flow,
 * and article-settings (slug / order / tier bulk management).
 *
 * S — all article-related UI and persistence concerns live here.
 * D — imports nav.setActiveModule for post-load routing; nav never imports us.
 */

import { state }              from '../state.js';
import { authedJson, setSectionStatus, setStatus, makeIcon } from '../http.js';
import { slugify, articleDisplayName } from '../utils.js';
import { setActiveModule }    from '../nav.js';
import { loadContactPolicy }  from './policy.js';
import { setMetaEnabledMap }  from './metadata.js';
import {
  blocksToHtml, cloneBlocks, htmlToBlocks,
} from '../../../../assets/ui/sdblocks.js';
import { createComposer }     from '../../../../assets/ui/composer.js';
import { enabledBlockTypes }  from '../../../../assets/ui/component-registry.js';
import { createArticleCard, contentTypeLabel }  from '../../../../assets/ui/article-card.js';
import { renderDataTable }    from '../../../../assets/ui/datatable.js';

// ── Media ref tracking ────────────────────────────────────────────────────────

function extractMediaObjectNamesFromText(text) {
  const raw   = String(text || '');
  const names = new Set();
  const rePublic = /https?:\/\/storage\.googleapis\.com\/[^/"'\s]+\/(media\/[^"'\s?#]+)/gi;
  const rePath   = /(?:^|[("'\\s])\/?(media\/[a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp))(?:[)"'\\s?#]|$)/gi;
  let m;
  while ((m = rePublic.exec(raw)) !== null) {
    const n = String(m[1] || '').split('?')[0].split('#')[0].trim();
    if (n.startsWith('media/')) names.add(n);
  }
  while ((m = rePath.exec(raw)) !== null) {
    const n = String(m[1] || '').split('?')[0].split('#')[0].trim();
    if (n.startsWith('media/')) names.add(n);
  }
  return names;
}

function computeMediaRefsFromArticle(article) {
  const a = article || {};
  const en = a.en || {};
  const set = new Set();
  extractMediaObjectNamesFromText(en.body || '').forEach(function (n) { set.add(n); });
  extractMediaObjectNamesFromText(a.thumbnail || '').forEach(function (n) { set.add(n); });
  return set;
}

function diffRemovedMedia(prevSet, nextSet) {
  if (!prevSet || !prevSet.size) return [];
  const next = nextSet || new Set();
  const removed = [];
  prevSet.forEach(function (name) { if (!next.has(name)) removed.push(name); });
  return removed;
}

function autoCleanupRemovedMedia(articleId, removedNames) {
  const id    = String(articleId || '').trim();
  const names = Array.isArray(removedNames) ? removedNames.filter(Boolean) : [];
  if (!id || !names.length) return;
  Promise.allSettled(names.map(function (name) {
    return authedJson('/api/admin/media/object?name=' + encodeURIComponent(name), { method: 'DELETE' })
      .catch(function (err) { if (err && err.status === 409) return null; return null; });
  })).catch(function () {});
}

// ── Article helpers ───────────────────────────────────────────────────────────

export function nextAvailableOrder(excludedIds) {
  const excluded = excludedIds || [];
  const usedOrders = new Set(state.articles
    .filter(function (a) { return !excluded.includes(a.id); })
    .map(function (a) { return Number(a.order || 0); })
    .filter(function (o) { return o > 0; }));
  let order = 10;
  while (usedOrders.has(order)) order += 10;
  return order;
}

export function findOrderConflict(order, excludedIds) {
  const numericOrder = Number(order);
  if (!numericOrder) return null;
  const excluded = excludedIds || [];
  return state.articles.find(function (a) {
    return Number(a.order || 0) === numericOrder && !excluded.includes(a.id);
  }) || null;
}

function currentArticleIds() {
  const ids = [];
  if (state.selectedId) ids.push(state.selectedId);
  const els = _els();
  const currentId = slugify(els.id.value || els.title.value);
  if (currentId && !ids.includes(currentId)) ids.push(currentId);
  return ids;
}

// ── Section helpers ───────────────────────────────────────────────────────────

function nextSectionId() {
  state.sectionSeq += 1;
  return 'section-' + Date.now().toString(36) + '-' + state.sectionSeq;
}

function syncSectionBlocks() {
  state.articleSections.forEach(function (s) { if (s.composer) s.blocks = s.composer.getBlocks(); });
}

function sectionsToBlocks() {
  const blocks = [];
  state.articleSections.forEach(function (s) {
    const body = s.composer ? s.composer.getBlocks() : (s.blocks || []);
    const type = (s.type || '').trim();
    if (type) blocks.push({ type: 'heading', text: type, scope: 'section' });
    body.forEach(function (b) { blocks.push(b); });
  });
  return blocks;
}

function isExplicitSectionHeading(block) {
  return !!(block && block.type === 'heading' && (block.scope === 'section' || block.role === 'section' || block.section === true || block.isSection === true));
}

function looksLikeNumberedHeading(text) {
  return /^\s*\d+(?:\.\d+)*[.)]?\s+/.test(String(text || ''));
}

function blocksToSections(blocks) {
  const list     = Array.isArray(blocks) ? blocks : [];
  const sections = [];
  let current    = null;
  const hasExplicit = list.some(isExplicitSectionHeading);
  list.forEach(function (block) {
    if (block && block.type === 'heading') {
      const text         = String(block.text || '').trim();
      const isDelimiter  = hasExplicit
        ? isExplicitSectionHeading(block)
        : (isExplicitSectionHeading(block) || (!!text && !looksLikeNumberedHeading(text)));
      if (isDelimiter) {
        current = { id: nextSectionId(), type: text, blocks: [], composer: null };
        sections.push(current);
        return;
      }
    }
    if (!current) { current = { id: nextSectionId(), type: '', blocks: [], composer: null }; sections.push(current); }
    current.blocks.push(block);
  });
  if (!sections.length) sections.push({ id: nextSectionId(), type: '', blocks: [], composer: null });
  return sections;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function setDetailsStatus(msg, type) {
  const el = document.getElementById('detailsStatus');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = type || 'info';
  el.hidden = !msg;
}

export function setFooterSaveStatus(message, kind) {
  const el = document.getElementById('articleSaveStatusFooter');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind || '';
}

function updateWordCount() {
  const el = document.getElementById('articleWordCount');
  if (!el) return;
  let text = '';
  state.articleSections.forEach(function (s) {
    if (s.blocks) s.blocks.forEach(function (b) { text += ' ' + String(b.html || b.text || '').replace(/<[^>]+>/g, ' '); });
    text += ' ' + String(s.html || s.text || '').replace(/<[^>]+>/g, ' ');
  });
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  el.textContent = count > 0 ? count + ' words' : '';
}

export function updateWorkflowChrome(status) {
  const els = _els();
  if (els.statusField) els.statusField.value = status || els.statusField.value || 'Draft';
}

function updateArticleStats() {
  const published = state.articles.filter(function (a) { return a.status === 'Published'; }).length;
  const drafts    = state.articles.filter(function (a) { return a.status === 'Draft'; }).length;
  const totalCount     = document.getElementById('totalCount');
  const publishedCount = document.getElementById('publishedCount');
  const draftCount     = document.getElementById('draftCount');
  if (totalCount)     totalCount.textContent     = String(state.articles.length);
  if (publishedCount) publishedCount.textContent = String(published);
  if (draftCount)     draftCount.textContent     = String(drafts);
}

export function closeSectionActionMenus() {
  document.querySelectorAll('.sd-section-actions-menu').forEach(function (m) { m.hidden = true; });
  document.querySelectorAll('.sd-section-actions-trigger[aria-expanded="true"]').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
}

export function closeArticleDetailsMenu() {
  const els = _els();
  if (els.detailsActionsMenu) els.detailsActionsMenu.hidden = true;
  if (els.detailsActionsBtn) els.detailsActionsBtn.setAttribute('aria-expanded', 'false');
}

export function closeMediaActionMenus() {
  document.querySelectorAll('.sd-media-actions-menu').forEach(function (m) { m.hidden = true; });
  document.querySelectorAll('.sd-media-actions-trigger[aria-expanded="true"]').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
}

function showDetailsForm(show) {
  const els = _els();
  els.detailsForm.hidden = !show;
  if (els.detailsHead) els.detailsHead.hidden = !!show;
}

// ── Autosave ──────────────────────────────────────────────────────────────────

export function markDirty() {
  updateWorkflowChrome(_els().statusField.value, '');
  updateWordCount();
  scheduleDraftAutosave();
}

export function clearDraftAutosave() {
  if (state.autosaveTimer) { clearTimeout(state.autosaveTimer); state.autosaveTimer = 0; }
}

function canAutosaveArticle(article) {
  return article.id && article.en.title.length >= 3 && !!article.en.body;
}

function scheduleDraftAutosave() {
  clearDraftAutosave();
  const article = articleFromForm();
  if ((article.status || '').toLowerCase() === 'published') return;
  if (!canAutosaveArticle(article)) { setFooterSaveStatus('', ''); return; }
  setFooterSaveStatus('Saving…', '');
  state.autosaveTimer = setTimeout(function () {
    state.autosaveTimer = 0;
    saveArticleWithStatus(article.status || 'Draft', { silent: true }).catch(function () {
      setSectionStatus(_els().systemStatus, 'Autosave failed.', 'error');
    });
  }, 1200);
}

// ── AI Assist ─────────────────────────────────────────────────────────────────

export async function composerAiAssist(text, mode) {
  const els  = _els();
  const data = await authedJson('/api/admin/system-design/writing-assist', {
    method: 'POST',
    body:   JSON.stringify({
      articleTitle:    els.title.value.trim(),
      articleSubtitle: els.subtitle.value.trim(),
      sectionType:     'paragraph',
      sectionLabel:    'Paragraph',
      sectionBody:     text,
      mode:            mode || 'improve',
    }),
  });
  const suggestion = String(data.suggestion || '').trim();
  if (!suggestion) throw new Error('AI returned an empty suggestion.');
  return suggestion;
}

// ── Section builder ───────────────────────────────────────────────────────────

function buildSectionTitleInput(section) {
  const wrap  = document.createElement('span');
  wrap.className = 'sd-section-type-wrap';
  const input = document.createElement('input');
  input.type         = 'text';
  input.className    = 'sd-section-type-custom-input';
  input.placeholder  = 'Section title (optional)…';
  input.spellcheck   = false;
  input.autocomplete = 'off';
  input.value        = section.type || '';
  section._typeInput = input;
  function sync() { section.type = String(input.value || '').trim(); renderPreview(); }
  input.addEventListener('input', sync);
  input.addEventListener('blur',  function () { sync(); markDirty(); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  wrap.appendChild(input);
  return wrap;
}

function buildSectionCard(section, index) {
  const card   = document.createElement('section');
  card.className         = 'sd-section-editor';
  card.dataset.sectionId = section.id;

  const ribbon   = document.createElement('div');
  ribbon.className = 'sd-section-ribbon';
  const number   = document.createElement('span');
  number.className = 'sd-section-ribbon-number';
  number.textContent = String(index + 1).padStart(2, '0');
  const select   = buildSectionTitleInput(section);

  const controls = document.createElement('div');
  controls.className = 'sd-section-ribbon-controls';

  const up   = document.createElement('button');
  up.type    = 'button'; up.className = 'sd-section-ribbon-btn'; up.title = 'Move section up';
  up.setAttribute('aria-label', 'Move section up'); up.appendChild(makeIcon('arrow_upward'));
  up.disabled = index === 0;
  up.addEventListener('click', function () { moveSection(section, -1); });

  const down = document.createElement('button');
  down.type  = 'button'; down.className = 'sd-section-ribbon-btn'; down.title = 'Move section down';
  down.setAttribute('aria-label', 'Move section down'); down.appendChild(makeIcon('arrow_downward'));
  down.disabled = index === state.articleSections.length - 1;
  down.addEventListener('click', function () { moveSection(section, 1); });

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button'; moreBtn.className = 'sd-section-ribbon-btn sd-section-actions-trigger';
  moreBtn.title = 'Section actions'; moreBtn.setAttribute('aria-label', 'Section actions');
  moreBtn.setAttribute('aria-haspopup', 'menu'); moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.appendChild(makeIcon('more_vert'));

  const actionsMenu = document.createElement('div');
  actionsMenu.className = 'sd-section-actions-menu'; actionsMenu.hidden = true;
  actionsMenu.setAttribute('role', 'menu');

  const delItem = document.createElement('button');
  delItem.type = 'button'; delItem.className = 'reco-action-item reco-action-item-destructive';
  delItem.setAttribute('role', 'menuitem');
  delItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span><span>Delete section</span>';
  delItem.addEventListener('click', function () { actionsMenu.hidden = true; deleteSection(section); });

  moreBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const willOpen = actionsMenu.hidden;
    closeSectionActionMenus();
    closeArticleDetailsMenu();
    actionsMenu.hidden = !willOpen;
    moreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  actionsMenu.addEventListener('click', function (e) { e.stopPropagation(); });
  actionsMenu.appendChild(delItem);

  controls.append(up, down, moreBtn, actionsMenu);
  ribbon.append(number, select, controls);

  const composer = createComposer({
    placeholder:  '',
    aiAssist:     composerAiAssist,
    onSave:       saveArticleFromComposer,
    enabledTypes: function () { return enabledBlockTypes(getMetaEnabledMap()); },
    value:        section.blocks,
    onChange:     function (blocks) { section.blocks = blocks; renderPreview(); markDirty(); },
  });
  section.composer = composer;

  const editBtn = composer.element.querySelector('.composer-tool-edit');
  if (editBtn) {
    editBtn.addEventListener('click', function () {
      setTimeout(function () {
        if (!composer.isEditable()) return;
        const els = _els();
        if (!els.statusField || els.statusField.value !== 'Published') return;
        els.statusField.value = 'Draft';
        updateWorkflowChrome('Draft');
        renderPreview();
        setSectionStatus(els.systemStatus, 'Switched to Draft (Published articles require explicit republish).', 'info');
      }, 0);
    });
  }

  card.append(ribbon, composer.element);
  composer.setEditable(composer.isEditable());
  const els = _els();
  if (els.statusField && els.statusField.value === 'Published') composer.setEditable(false);

  const slot    = document.createElement('div');
  slot.className = 'sd-section-slot';
  const statusEl = composer.element.querySelector('.composer-status');
  if (statusEl) composer.element.removeChild(statusEl);
  if (statusEl) slot.appendChild(statusEl);
  slot.appendChild(card);
  return slot;
}

export function renderSectionEditors() {
  const els = _els();
  els.sections.replaceChildren();
  state.articleSections.forEach(function (s) { s.composer = null; });
  state.articleSections.forEach(function (s, i) { els.sections.appendChild(buildSectionCard(s, i)); });
  updateWordCount();
}

export function addSection(type) {
  syncSectionBlocks();
  const section = { id: nextSectionId(), type: String(type || '').trim(), blocks: [], composer: null, startEditing: true };
  state.articleSections.push(section);
  renderSectionEditors();
  const card = _els().sections.lastElementChild;
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (section.composer) section.composer.focus();
  renderPreview();
  markDirty();
}

function moveSection(section, delta) {
  syncSectionBlocks();
  const idx = state.articleSections.findIndex(function (s) { return s.id === section.id; });
  if (idx === -1) return;
  const target = idx + delta;
  if (target < 0 || target >= state.articleSections.length) return;
  const moved = state.articleSections.splice(idx, 1)[0];
  state.articleSections.splice(target, 0, moved);
  renderSectionEditors();
  renderPreview();
  markDirty();
}

function deleteSection(section) {
  syncSectionBlocks();
  state.articleSections = state.articleSections.filter(function (s) { return s.id !== section.id; });
  if (!state.articleSections.length) {
    state.articleSections.push({ id: nextSectionId(), type: 'Overview', blocks: [], composer: null });
  }
  renderSectionEditors();
  renderPreview();
  markDirty();
}

// ── Article form ──────────────────────────────────────────────────────────────

export function articleFromForm() {
  const els     = _els();
  const id      = slugify(els.id.value || els.title.value);
  const blocks  = sectionsToBlocks();
  const bodyHtml = blocksToHtml(blocks);
  return {
    id,
    status:      els.statusField.value,
    contentType: (els.contentType && els.contentType.value) ? els.contentType.value : '',
    icon:        els.icon.value.trim() || 'article',
    readMinutes: els.readMinutes.value ? Number(els.readMinutes.value) : null,
    order:       Number(els.order.value || 100),
    tags:        els.tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
    stub:        els.statusField.value === 'Coming soon',
    thumbnail:   state.currentThumbnailUrl || '',
    blocks:      cloneBlocks(blocks),
    en: { title: els.title.value.trim(), subtitle: els.subtitle.value.trim(), body: bodyHtml },
    fr: { title: els.title.value.trim(), subtitle: els.subtitle.value.trim(), body: bodyHtml },
  };
}

export function renderArticleDetails() {
  const els      = _els();
  const title    = els.title.value.trim();
  const subtitle = els.subtitle.value.trim();
  const tags     = els.tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
  if (els.detailsTitle)    els.detailsTitle.textContent    = title    || 'Untitled article';
  if (els.detailsSubtitle) els.detailsSubtitle.textContent = subtitle || 'No subtitle yet.';
  if (els.detailsTags) {
    els.detailsTags.textContent = '';
    tags.forEach(function (tag) {
      const chip = document.createElement('span');
      chip.className = 'sd-admin-chip sd-admin-chip-muted';
      chip.textContent = tag;
      els.detailsTags.appendChild(chip);
    });
  }
  const cardThumb = document.getElementById('articleCardThumb');
  if (cardThumb) {
    if (state.currentThumbnailUrl) { cardThumb.src = state.currentThumbnailUrl; cardThumb.hidden = false; }
    else { cardThumb.src = ''; cardThumb.hidden = true; }
  }
}

export function renderPreview() {
  updateWorkflowChrome(articleFromForm().status);
}

export function fillForm(article) {
  const els = _els();
  const item = article || {
    id: '', status: 'Draft', contentType: 'system-design',
    icon: 'article', readMinutes: null, order: nextAvailableOrder(), tags: [],
    en: { title: '', subtitle: '', body: '' },
  };
  const en = item.en || {};
  state.selectedId = item.id || '';
  els.id.value = item.id || '';
  els.statusField.value = item.status || 'Draft';
  if (els.contentType) els.contentType.value = item.contentType || 'system-design';
  els.icon.value        = item.icon || 'article';
  els.readMinutes.value = item.readMinutes || '';
  els.order.value       = item.order || 100;
  els.title.value       = en.title || '';
  els.subtitle.value    = en.subtitle || '';
  els.tags.value        = Array.isArray(item.tags) ? item.tags.join(', ') : '';
  state.currentThumbnailUrl = item.thumbnail || '';
  setThumbPreview(state.currentThumbnailUrl);
  if (els.listMain)   els.listMain.hidden   = true;
  if (els.detailsCard) els.detailsCard.hidden = false;
  if (els.editorHead) els.editorHead.hidden = false;
  showDetailsForm(false);
  els.sectionBuilder.hidden = false;
  renderArticleDetails();
  let blocks = cloneBlocks(item.blocks);
  if (!blocks.length) blocks = htmlToBlocks(en.body || '');
  state.articleSections = article ? blocksToSections(blocks) : [];
  renderSectionEditors();
  renderPreview();
  updateWorkflowChrome(els.statusField.value, item.id ? 'Saved in Firestore' : 'New draft', item.id ? 'saved' : 'new');
  renderList();
  if (item.id) state.mediaRefsByArticleId.set(item.id, computeMediaRefsFromArticle(item));
}

export function renderList() {
  const els = _els();
  if (!els.list) return;
  els.list.textContent = '';
  const isListView = state.currentArticleView === 'list';
  els.list.classList.toggle('sd-list-view', isListView);
  updateArticleStats();

  const statusMap    = { drafts: 'Draft', published: 'Published', archived: 'Archived' };
  const filterStatus = statusMap[state.currentArticleFilter] || null;
  const filtered     = filterStatus
    ? state.articles.filter(function (a) { return (a.status || 'Draft') === filterStatus; })
    : state.articles;

  document.querySelectorAll('.sd-subpanel-pane[data-subpanel="system-design"] .sd-subpanel-item').forEach(function (btn) {
    btn.classList.toggle('sd-subpanel-item-active', btn.dataset.subpanelAction === state.currentArticleFilter);
  });
  const countEl = document.getElementById('articleListCount');
  if (countEl) countEl.textContent = filtered.length + ' article' + (filtered.length !== 1 ? 's' : '');

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    empty.innerHTML = '<strong>No articles yet.</strong><span>Click "+ New" to create your first article.</span>';
    els.list.appendChild(empty);
    return;
  }

  // ── List view: use DataTable (same as public page) ────────────────────────
  if (isListView) {
    const rows = filtered.map(function (a) {
      const en = a.en || {};
      const type = a.contentType || 'system-design';
      return {
        _id: a.id,
        _article: a,
        _status: a.status || 'Draft',
        _type: type,
        _typeLabel: contentTypeLabel(type),
        _title: en.title || a.id || 'Untitled',
        _readTime: a.readMinutes ? a.readMinutes + ' min read' : '',
        _tier: a.tier || 'free',
      };
    });

    renderDataTable(els.list, {
      ariaLabel: 'Articles',
      tableClassName: 'sd-admin-articles-table',
      responsive: true,
      emptyText: 'No articles yet.',
      rows: rows,
      columns: [
        {
          key: 'type',
          header: 'Type',
          width: 160,
          renderHtml: function (r) {
            return '<span class="sd-admin-type-chip" data-type="' + r._type + '">' + r._typeLabel + '</span>';
          },
        },
        {
          key: 'title',
          header: 'Title',
          renderHtml: function (r) {
            let html = '<span class="sd-admin-title-text">' + r._title + '</span>';
            if (r._status === 'Draft') html += ' <span class="sd-admin-draft-badge">Draft</span>';
            return html;
          },
        },
        {
          key: 'readTime',
          header: 'Read time',
          width: 100,
          align: 'right',
          renderText: function (r) { return r._readTime; },
        },
        {
          key: 'tier',
          header: 'Tier',
          width: 100,
          align: 'right',
          renderHtml: function (r) {
            return r._tier === 'premium'
              ? '<span class="sd-admin-tier-badge sd-admin-tier-premium"><span class="material-symbols-outlined">lock</span>Premium</span>'
              : '<span class="sd-admin-tier-badge sd-admin-tier-free">Free</span>';
          },
        },
      ],
    });

    // Add row click handlers after render
    els.list.querySelectorAll('tbody tr').forEach(function (tr, i) {
      if (!rows[i]) return;
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', function () {
        fillForm(rows[i]._article);
      });
    });
    return;
  }

  // ── Grid view: use article cards ──────────────────────────────────────────
  filtered.forEach(function (article) { els.list.appendChild(_articleCardForAdmin(article)); });
}

function _articleCardForAdmin(article) {
  return createArticleCard(article, {
    isActive: article.id === state.selectedId,
    onClick:  function (a) { fillForm(a); },
  });
}

// ── Save / Publish flow ───────────────────────────────────────────────────────

export async function saveArticleFromComposer() {
  const article = articleFromForm();
  if (!article.id || !article.en.title) throw new Error('Add a title before saving.');
  if (!article.en.body)                 throw new Error('Add some content before saving.');
  clearDraftAutosave();
  const status = _els().statusField.value === 'Published' ? 'Draft' : 'Draft';
  if (_els().statusField.value === 'Published') {
    _els().statusField.value = 'Draft';
    updateWorkflowChrome('Draft');
    renderPreview();
  }
  await saveArticleWithStatus(status, { silent: true });
  return 'Draft saved to Firestore.';
}

export async function saveArticleWithStatus(status, opts) {
  const els     = _els();
  const options = opts || {};
  const beforeId = state.selectedId || slugify(els.id.value || els.title.value);
  const prevRefs = beforeId ? (state.mediaRefsByArticleId.get(beforeId) || new Set()) : new Set();
  const article = articleFromForm();
  article.status = status;
  article.stub   = status === 'Coming soon';
  if (!article.id || !article.en.title || !article.en.body) {
    if (options.silent) return;
    setSectionStatus(els.systemStatus, 'Slug, title, and body are required.', 'error');
    return;
  }
  const action = status === 'Published' ? 'Publishing...' : 'Saving ' + status.toLowerCase() + '...';
  if (!options.silent) setSectionStatus(els.systemStatus, action, 'info');
  const routeId = state.selectedId || article.id;
  const data = await authedJson('/api/admin/system-design/articles/' + routeId, {
    method: 'PUT', body: JSON.stringify(article),
  });
  const saved = data.article;
  const nextRefs = computeMediaRefsFromArticle(saved);
  autoCleanupRemovedMedia(saved.id, diffRemovedMedia(prevRefs, nextRefs));
  state.mediaRefsByArticleId.set(saved.id, nextRefs);
  state.articles = state.articles.filter(function (a) { return a.id !== saved.id; }).concat(saved)
    .sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  if (options.silent) {
    state.selectedId = saved.id;
    renderList();
  } else {
    fillForm(saved);
    showDetailsForm(false);
  }
  const done = status === 'Published'
    ? 'Published version ' + data.version + '.'
    : status + ' saved to Firestore.';
  updateWorkflowChrome(saved.status, options.silent ? 'Auto-saved to Firestore' : (status === 'Published' ? 'Published just now' : 'Saved just now'), 'saved');
  setFooterSaveStatus(status === 'Published' ? 'Published just now ✓' : 'Saved just now ✓', 'saved');
  if (!options.silent) setSectionStatus(els.systemStatus, done, 'success');
}

export function publishArticle() {
  clearDraftAutosave();
  _els().statusField.value = 'Published';
  renderPreview();
  return saveArticleWithStatus('Published');
}

export function openPublishReview() {
  const els = _els();
  renderPreview();
  renderPublishReview();
  setPublishReviewStep('preview');
  if (typeof els.publishDialog.show === 'function') { els.publishDialog.show(); return; }
  customElements.whenDefined('md-dialog').then(function () { els.publishDialog.show(); });
}

export function closePublishReview() {
  const els = _els();
  els.publishDialog.close();
  if (els.publishSuccessPanel)  els.publishSuccessPanel.hidden  = true;
  if (els.confirmPublishBtn)    { els.confirmPublishBtn.disabled = false; els.confirmPublishBtn.hidden = false; }
  if (els.continueEditingBtn)   els.continueEditingBtn.hidden  = false;
}

function _showPublishSuccess(title) {
  const els = _els();
  els.publishPreviewPanel.hidden  = true;
  els.publishSeoPanel.hidden      = true;
  els.publishSuccessPanel.hidden  = false;
  els.publishSuccessPanel.classList.remove('sd-publish-success-in');
  requestAnimationFrame(function () { els.publishSuccessPanel.classList.add('sd-publish-success-in'); });
  if (els.publishSuccessTitle) els.publishSuccessTitle.textContent = '\u201c' + title + '\u201d is live';
  els.continueEditingBtn.hidden = true;
  els.confirmPublishBtn.hidden  = true;
  if (els.publishReviewHeading) els.publishReviewHeading.textContent = '';
  setTimeout(closePublishReview, 2400);
}

export function handlePublishDialogBack() {
  const els = _els();
  if (els.publishDialog.dataset.publishStep === 'seo') {
    syncPublishSeoToForm();
    renderPublishReview();
    setPublishReviewStep('preview');
    return;
  }
  closePublishReview();
}

function renderPublishReview() {
  const els     = _els();
  const article = articleFromForm();
  if (els.publishReviewTitle)    els.publishReviewTitle.textContent    = article.en.title || 'Untitled article';
  if (els.publishReviewSubtitle) { els.publishReviewSubtitle.textContent = article.en.subtitle || ''; els.publishReviewSubtitle.hidden = !article.en.subtitle; }
  if (els.publishReviewTags)  { els.publishReviewTags.textContent = ''; article.tags.forEach(function (tag) { const chip = document.createElement('span'); chip.className = 'sd-tag'; chip.textContent = tag; els.publishReviewTags.appendChild(chip); }); }
  if (els.publishReviewReadTime && els.publishReviewReadTime.lastElementChild) els.publishReviewReadTime.lastElementChild.textContent = article.readMinutes + ' min';
  if (els.publishSeoSlug)        els.publishSeoSlug.value = article.id || '';
  if (els.publishSeoContentType) els.publishSeoContentType.value = article.contentType || 'system-design';
  if (els.publishSeoIcon)        els.publishSeoIcon.value = article.icon || 'article';
  if (els.publishSeoReadMinutes) els.publishSeoReadMinutes.value = String(article.readMinutes || 5);
  if (els.publishSeoOrder)       els.publishSeoOrder.value = String(article.order || 100);
  renderPublishOrderWarning();
  if (els.publishReviewBody) els.publishReviewBody.innerHTML = article.en.body || '<p class="sd-preview-empty">Nothing to preview yet.</p>';
}

function publishSeoExcludedIds() {
  const ids     = currentArticleIds();
  const els     = _els();
  const modalId = slugify(els.publishSeoSlug.value || els.title.value);
  if (modalId && !ids.includes(modalId)) ids.push(modalId);
  return ids;
}

export function renderPublishOrderWarning() {
  const els      = _els();
  if (!els.publishSeoOrder) return null;
  const order    = Number(els.publishSeoOrder.value || 0);
  const conflict = findOrderConflict(order, publishSeoExcludedIds());
  if (!conflict) {
    if (els.publishOrderWarning) els.publishOrderWarning.hidden = true;
    if (els.publishOrderWarningText) els.publishOrderWarningText.textContent = '';
    return null;
  }
  const nextOrder = nextAvailableOrder(publishSeoExcludedIds());
  if (els.publishOrderWarning) els.publishOrderWarning.hidden = false;
  if (els.publishOrderWarningText) els.publishOrderWarningText.textContent = 'Order ' + order + ' is already used by "' + articleDisplayName(conflict) + '". Use order ' + nextOrder + ' to keep the library sequence clean.';
  return conflict;
}

function syncPublishSeoToForm() {
  const els = _els();
  els.id.value = slugify(els.publishSeoSlug.value || els.title.value);
  if (els.publishSeoSlug) els.publishSeoSlug.value = els.id.value;
  if (els.contentType && els.publishSeoContentType) els.contentType.value = els.publishSeoContentType.value || els.contentType.value || 'system-design';
  if (els.publishSeoIcon)        els.icon.value        = els.publishSeoIcon.value.trim() || 'article';
  if (els.publishSeoReadMinutes) els.readMinutes.value = els.publishSeoReadMinutes.value || '';
  if (els.publishSeoOrder)       els.order.value       = els.publishSeoOrder.value || '100';
  renderArticleDetails();
  renderPreview();
  markDirty();
}

function setPublishReviewStep(step) {
  const els    = _els();
  const isSeo  = step === 'seo';
  els.publishDialog.dataset.publishStep = isSeo ? 'seo' : 'preview';
  if (els.publishPreviewPanel) els.publishPreviewPanel.hidden = isSeo;
  if (els.publishSeoPanel)     els.publishSeoPanel.hidden     = !isSeo;
  if (els.publishReviewHeading) els.publishReviewHeading.textContent = '';
  if (els.publishReviewDescription) els.publishReviewDescription.textContent = isSeo ? 'Confirm SEO and ordering before this article goes live.' : '';
  if (els.continueEditingBtn) els.continueEditingBtn.textContent = isSeo ? 'Back to preview' : 'Continue editing';
  if (els.publishActionLabel) els.publishActionLabel.textContent = isSeo ? 'Publish now' : 'Publish';
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadArticles() {
  const els = _els();
  setStatus('Loading articles...', 'info');
  const [data] = await Promise.all([
    authedJson('/api/admin/system-design/articles'),
    authedJson('/api/system-design/component-registry')
      .then(function (r) { setMetaEnabledMap(r.enabled || {}); })
      .catch(function () {}),
  ]);
  state.articles = Array.isArray(data.articles) ? data.articles : [];
  if (els.modules)  els.modules.hidden  = false;
  if (els.workspace)els.workspace.hidden = false;
  if (els.signOut)  els.signOut.hidden  = false;
  const authWall = document.getElementById('adminAuthWall');
  if (authWall) {
    authWall.hidden = true;
    delete document.body.dataset.authwall;
  }
  setStatus('', 'info');
  renderList();
  await loadContactPolicy(els);
  setActiveModule('system-design');
  window._setArticleView(state.currentArticleView);
  if (state.articles.length > 0) window._setArticleFilter('all');
  else fillForm(null);
}

// ── Article Settings ──────────────────────────────────────────────────────────

export function renderArticleSettings() {
  const els = _els();
  els.articleSettingsList.textContent = '';
  if (!state.articles.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    empty.innerHTML = '<strong>No articles to configure yet.</strong><span>Create or import articles first, then manage their settings here.</span>';
    els.articleSettingsList.appendChild(empty);
    return;
  }
  state.articles.forEach(function (article) {
    const card = document.createElement('article');
    card.className = 'sd-article-settings-card';
    card.dataset.id    = article.id;
    card.dataset.title = articleDisplayName(article);
    const head = document.createElement('div');
    head.className = 'sd-article-settings-card-head';
    const copy = document.createElement('div');
    const titleEl  = document.createElement('strong');
    titleEl.textContent = articleDisplayName(article);
    const statusEl = document.createElement('span');
    statusEl.className = 'sd-article-status-chip';
    statusEl.textContent  = article.status || 'Draft';
    statusEl.dataset.status = article.status || 'Draft';
    copy.append(titleEl, statusEl);
    head.appendChild(copy);
    const warning = document.createElement('div');
    warning.className = 'sd-article-settings-warning'; warning.hidden = true;
    const fields = document.createElement('div');
    fields.className = 'sd-article-settings-fields';
    fields.append(
      _buildArticleSettingsField(article, 'id',          'Slug',         article.id,                          'text'),
      _buildArticleSettingsField(article, 'icon',        'Icon',         article.icon   || 'article',         'text'),
      _buildArticleSettingsField(article, 'readMinutes', 'Read min',     article.readMinutes || '',           'number'),
      _buildArticleSettingsField(article, 'order',       'Order',        article.order  || 100,               'number'),
      _buildArticleSettingsField(article, 'tier',        'Tier',         article.tier   || 'free',            'select', ['free', 'premium']),
      _buildArticleSettingsField(article, 'status',      'Status',       article.status || 'Draft',           'select', ['Draft', 'Published', 'Archived', 'Coming soon']),
    );
    card.append(head, warning, fields);
    els.articleSettingsList.appendChild(card);
    fields.querySelectorAll('input,select').forEach(function (input) {
      input.addEventListener('input',  renderArticleSettingsWarnings);
      input.addEventListener('change', renderArticleSettingsWarnings);
    });
  });
}

export function renderArticleSettingsWarnings() {
  const els   = _els();
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  const orderMap = new Map();
  const slugMap  = new Map();
  cards.forEach(function (card) {
    const orderInput = card.querySelector('[data-field="order"]');
    const slugInput  = card.querySelector('[data-field="id"]');
    const order = Number(orderInput?.value || 0);
    const slug  = slugify(slugInput?.value || '');
    if (!orderMap.has(order)) orderMap.set(order, []);
    if (order) orderMap.get(order).push(card);
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    if (slug) slugMap.get(slug).push(card);
  });
  let conflictCount = 0;
  cards.forEach(function (card) {
    const warning = card.querySelector('.sd-article-settings-warning');
    const order   = Number(card.querySelector('[data-field="order"]')?.value || 0);
    const slug    = slugify(card.querySelector('[data-field="id"]')?.value || '');
    const messages = [];
    const orderConflicts = orderMap.get(order) || [];
    const slugConflicts  = slugMap.get(slug)   || [];
    if (orderConflicts.length > 1) {
      const names = orderConflicts.filter(function (c) { return c !== card; }).map(function (c) { return c.dataset.title || c.dataset.id; }).join(', ');
      messages.push('Order ' + order + ' also used by ' + names + '.');
    }
    if (slugConflicts.length > 1) messages.push('Slug "' + slug + '" is used by another article.');
    if (messages.length) { warning.textContent = messages.join(' '); warning.hidden = false; conflictCount += 1; }
    else { warning.textContent = ''; warning.hidden = true; }
  });
  if (conflictCount) setSectionStatus(els.articleSettingsStatus, conflictCount + ' setting conflict' + (conflictCount === 1 ? '' : 's') + ' found.', 'error');
  else setSectionStatus(els.articleSettingsStatus, '', 'info');
  return conflictCount;
}

export function autoFixArticleSettingsOrder() {
  const els   = _els();
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  cards
    .sort(function (a, b) {
      const aO = Number(a.querySelector('[data-field="order"]')?.value || 9999);
      const bO = Number(b.querySelector('[data-field="order"]')?.value || 9999);
      return aO - bO || String(a.dataset.title || '').localeCompare(String(b.dataset.title || ''));
    })
    .forEach(function (card, i) {
      const inp = card.querySelector('[data-field="order"]');
      if (inp) inp.value = String((i + 1) * 10);
    });
  renderArticleSettingsWarnings();
  setSectionStatus(els.articleSettingsStatus, 'Order reset. Save settings to publish the change.', 'success');
}

export async function saveArticleSettings() {
  const els   = _els();
  if (renderArticleSettingsWarnings()) return;
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  if (!cards.length) return;
  setSectionStatus(els.articleSettingsStatus, 'Saving article settings...', 'info');
  const savedRecords = [];
  for (const card of cards) {
    const original = state.articles.find(function (a) { return a.id === card.dataset.id; });
    if (!original) continue;
    const input = function (field) { return card.querySelector('[data-field="' + field + '"]'); };
    const updated = Object.assign({}, original, {
      id:          slugify(input('id').value || original.id),
      icon:        input('icon').value.trim() || 'article',
      readMinutes: input('readMinutes').value ? Number(input('readMinutes').value) : null,
      order:       Number(input('order').value || 100),
      tier:        input('tier').value || 'free',
      status:      input('status').value || original.status || 'Draft',
      stub:        input('status').value === 'Coming soon',
    });
    const data = await authedJson('/api/admin/system-design/articles/' + original.id, {
      method: 'PUT', body: JSON.stringify(updated),
    });
    savedRecords.push({ previousId: original.id, article: data.article });
  }
  savedRecords.forEach(function (r) {
    state.articles = state.articles.filter(function (a) { return a.id !== r.previousId && a.id !== r.article.id; }).concat(r.article);
  });
  state.articles.sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  const sel = savedRecords.find(function (r) { return r.previousId === state.selectedId; });
  if (sel) state.selectedId = sel.article.id;
  const current = state.articles.find(function (a) { return a.id === state.selectedId; });
  if (current) fillForm(current);
  renderList();
  renderArticleSettings();
  setSectionStatus(els.articleSettingsStatus, 'Article settings saved.', 'success');
}

// ── Thumbnail helpers (article-side) ─────────────────────────────────────────
// The actual upload logic lives in media.js. These helpers update article state.

export function setThumbPreview(url) {
  const els = _els();
  if (!els.thumbPreview || !els.thumbPreviewWrap || !els.thumbDropzone) return;
  if (url) {
    els.thumbPreview.src = url;
    els.thumbPreview.alt = 'Article thumbnail';
    els.thumbPreviewWrap.hidden = false;
    els.thumbDropzone.hidden = true;
  } else {
    els.thumbPreviewWrap.hidden = true;
    els.thumbDropzone.hidden = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildArticleSettingsField(article, field, labelText, value, type, options) {
  const label    = document.createElement('label');
  label.className = 'sd-article-settings-field';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = labelText;
  let input;
  if (type === 'select') {
    input = document.createElement('select');
    (options || []).forEach(function (opt) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (String(value) === opt) o.selected = true;
      input.appendChild(o);
    });
    if (field === 'status') {
      input.addEventListener('change', function () {
        const chip = label.closest('.sd-article-settings-card')?.querySelector('.sd-article-status-chip');
        if (chip) { chip.textContent = input.value; chip.dataset.status = input.value; }
      });
    }
  } else {
    input = document.createElement('input');
    input.type  = type || 'text';
    input.value = value || '';
    if (field === 'readMinutes') { input.min = '0'; input.max = '60'; input.placeholder = 'Optional'; }
    if (field === 'order')       { input.min = '1'; input.max = '9999'; }
  }
  input.dataset.field = field;
  label.append(labelSpan, input);
  return label;
}

// ── Internal ──────────────────────────────────────────────────────────────────
// Lazy accessor for the `els` registry — avoids a hard parse-time import of els.js
// (which would force els.js to be evaluated before DOM is ready).
let _elsCache = null;
function _els() {
  if (!_elsCache) _elsCache = /** @type {any} */ (window.__adminEls || {});
  return _elsCache;
}

// Lazy accessor for metadata-enabled map — avoids importing metadata.js at top
// level (which would create a potential cycle).
function getMetaEnabledMap() {
  try {
    return /** @type {any} */ (window.__adminMetaEnabledMap || {});
  } catch (_) { return {}; }
}
