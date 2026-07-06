/**
 * Media module — media library (audit) and thumbnail upload.
 *
 * S — all media/image management concerns live here.
 * D — imports setActiveModule for "open article" links, and fillForm from
 *     articles (one-way dependency; articles.js does not import media.js).
 */

import { state }              from '../state.js';
import { authedJson, setSectionStatus, makeIcon, authHeaders } from '../http.js';
import { formatBytes, formatWhen } from '../utils.js';
import { setActiveModule }    from '../nav.js';
import { setThumbPreview, fillForm } from './articles.js';
import { closeSectionActionMenus, closeArticleDetailsMenu, closeMediaActionMenus } from './articles.js';
import { closePolicyRuleMenus } from './policy.js';

// ── Media library ─────────────────────────────────────────────────────────────

export async function renderMediaLibrary(els) {
  if (state.mediaAuditState) {
    paintMediaAudit(els);
    return;
  }
  await refreshMediaAudit(els);
}

export async function refreshMediaAudit(els) {
  if (!els.mediaAuditPanel) return;
  setSectionStatus(els.mediaAuditStatus, 'Loading media objects…', 'info');
  els.mediaAuditPanel.textContent = '';
  try {
    const data = await authedJson('/api/admin/media/audit');
    state.mediaAuditState = data;
    state.mediaAuditView.visibleCount = state.mediaAuditView.batchSize;
    paintMediaAudit(els);
    setSectionStatus(els.mediaAuditStatus, '', '');
  } catch (err) {
    setSectionStatus(els.mediaAuditStatus, err.message || 'Failed to load media.', 'error');
  }
}

export function applyMediaFilter(els) {
  state.mediaAuditView.visibleCount = state.mediaAuditView.batchSize;
  paintMediaAudit(els);
}

export function paintMediaAudit(els) {
  if (!els.mediaAuditPanel || !state.mediaAuditState) return;
  const view    = state.mediaAuditView;
  const objects = Array.isArray(state.mediaAuditState.objects) ? state.mediaAuditState.objects : [];

  // Filter
  const query  = (view.query || '').toLowerCase();
  const filtered = objects.filter(function (o) {
    if (view.status === 'used'   && !(Array.isArray(o.referencedBy) && o.referencedBy.length)) return false;
    if (view.status === 'orphan' &&  (Array.isArray(o.referencedBy) && o.referencedBy.length)) return false;
    if (view.article !== 'all' && !((o.referencedBy || []).some(function (r) { return r.articleId === view.article; }))) return false;
    if (query && !String(o.name || '').toLowerCase().includes(query)) return false;
    return true;
  });

  // Sort
  filtered.sort(function (a, b) {
    switch (view.sort) {
      case 'oldest':    return Number(a.updatedAt || 0) - Number(b.updatedAt || 0);
      case 'largest':   return Number(b.size || 0) - Number(a.size || 0);
      case 'smallest':  return Number(a.size || 0) - Number(b.size || 0);
      case 'name_asc':  return String(a.name || '').localeCompare(String(b.name || ''));
      case 'name_desc': return String(b.name || '').localeCompare(String(a.name || ''));
      default:          return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    }
  });

  // Metrics summary
  const metrics = _computeMediaMetrics(objects);
  _paintMediaMetrics(metrics);

  // Table
  const visible = filtered.slice(0, view.visibleCount);
  view.visibleCount = visible.length;

  els.mediaAuditPanel.textContent = '';
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    empty.innerHTML = '<strong>No media objects found.</strong><span>Try adjusting the filter.</span>';
    els.mediaAuditPanel.appendChild(empty);
    return;
  }

  const table  = document.createElement('table');
  table.className = 'sd-media-table';
  const thead  = document.createElement('thead');
  thead.innerHTML = '<tr><th>Preview</th><th>File</th><th>Used by</th><th>Status</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr>';
  const tbody  = document.createElement('tbody');
  table.appendChild(thead);

  visible.forEach(function (o) {
    const refs = Array.isArray(o.referencedBy) ? o.referencedBy : [];
    const tr   = document.createElement('tr');

    const previewTd = document.createElement('td');
    previewTd.className = 'sd-media-col-preview';
    const img = document.createElement('img');
    img.className = 'sd-media-thumb'; img.loading = 'lazy'; img.alt = ''; img.src = o.url;
    previewTd.appendChild(img);

    const fileTd   = document.createElement('td');
    const fileName = document.createElement('a');
    fileName.className = 'sd-media-name'; fileName.href = o.url; fileName.target = '_blank'; fileName.rel = 'noopener noreferrer';
    fileName.textContent = String(o.name || '').replace(/^media\//, '');
    const fileMeta = document.createElement('div');
    fileMeta.className = 'sd-media-meta';
    fileMeta.textContent = (o.contentType || '') + (o.contentType ? ' · ' : '') + formatBytes(o.size || 0);
    fileTd.append(fileName, fileMeta);

    const articleTd = document.createElement('td');
    if (!refs.length) {
      const orphanText = document.createElement('div');
      orphanText.className = 'sd-media-meta'; orphanText.textContent = '(No article)';
      articleTd.appendChild(orphanText);
    } else {
      const wrap = document.createElement('div'); wrap.className = 'sd-media-refs';
      refs.slice(0, 2).forEach(function (r) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'sd-media-ref';
        btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">article</span><span></span>';
        btn.querySelector('span:last-child').textContent = r.title || r.articleId || 'Article';
        btn.addEventListener('click', function () {
          const article = state.articles.find(function (a) { return a.id === r.articleId; });
          setActiveModule('system-design');
          if (article) fillForm(article);
        });
        wrap.appendChild(btn);
      });
      if (refs.length > 2) {
        const more = document.createElement('div'); more.className = 'sd-media-meta'; more.textContent = '+' + (refs.length - 2) + ' more';
        wrap.appendChild(more);
      }
      articleTd.appendChild(wrap);
    }

    const statusTd = document.createElement('td');
    const chip     = document.createElement('span');
    chip.className = 'sd-media-status ' + (refs.length ? 'sd-media-status--used' : 'sd-media-status--orphan');
    chip.innerHTML = refs.length
      ? '<span class="material-symbols-outlined" aria-hidden="true">check</span><span>Used</span>'
      : '<span class="material-symbols-outlined" aria-hidden="true">delete</span><span>Orphan</span>';
    statusTd.appendChild(chip);

    const sizeTd     = document.createElement('td'); sizeTd.className = 'sd-media-col-size'; sizeTd.textContent = formatBytes(o.size || 0);
    const uploadedTd = document.createElement('td'); uploadedTd.className = 'sd-media-col-uploaded'; uploadedTd.textContent = o.updatedAt ? formatWhen(o.updatedAt) : '';

    const actionsTd  = document.createElement('td'); actionsTd.className = 'sd-media-col-actions';
    const actionsWrap = document.createElement('div'); actionsWrap.className = 'reco-actions sd-media-actions';
    const actionsBtn  = document.createElement('button');
    actionsBtn.type = 'button'; actionsBtn.className = 'reco-actions-trigger sd-media-actions-trigger';
    actionsBtn.title = 'Row actions'; actionsBtn.setAttribute('aria-label', 'Row actions');
    actionsBtn.setAttribute('aria-haspopup', 'menu'); actionsBtn.setAttribute('aria-expanded', 'false');
    actionsBtn.appendChild(makeIcon('more_vert'));

    const menu = document.createElement('div'); menu.className = 'reco-actions-menu sd-media-actions-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');

    const openItem = document.createElement('button');
    openItem.type = 'button'; openItem.className = 'reco-action-item'; openItem.setAttribute('role', 'menuitem');
    openItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span><span>Open file</span>';
    openItem.addEventListener('click', function () { closeMediaActionMenus(); window.open(o.url, '_blank', 'noopener,noreferrer'); });

    const copyItem = document.createElement('button');
    copyItem.type = 'button'; copyItem.className = 'reco-action-item'; copyItem.setAttribute('role', 'menuitem');
    copyItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span><span>Copy URL</span>';
    copyItem.addEventListener('click', async function () {
      closeMediaActionMenus();
      try { await navigator.clipboard.writeText(o.url); setSectionStatus(els.mediaAuditStatus, 'Copied URL.', 'success'); }
      catch (_) { prompt('Copy URL:', o.url); }
    });

    menu.append(openItem, copyItem);

    if (refs.length) {
      const articleItem = document.createElement('button');
      articleItem.type = 'button'; articleItem.className = 'reco-action-item'; articleItem.setAttribute('role', 'menuitem');
      articleItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">article</span><span>Open article</span>';
      articleItem.addEventListener('click', function () {
        closeMediaActionMenus();
        const r = refs[0]; const article = state.articles.find(function (a) { return a.id === r.articleId; });
        setActiveModule('system-design'); if (article) fillForm(article);
      });
      menu.appendChild(articleItem);
    }

    if (!refs.length) {
      const delItem = document.createElement('button');
      delItem.type = 'button'; delItem.className = 'reco-action-item reco-action-item-destructive'; delItem.setAttribute('role', 'menuitem');
      delItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span><span>Delete</span>';
      delItem.addEventListener('click', async function () {
        closeMediaActionMenus();
        const filename = String(o.name || '').replace(/^media\//, '');
        if (!confirm('Delete this orphaned image?\n\n' + filename + '\n\nThis cannot be undone.')) return;
        delItem.disabled = true;
        setSectionStatus(els.mediaAuditStatus, 'Deleting ' + filename + '…', 'info');
        try {
          await authedJson('/api/admin/media/object?name=' + encodeURIComponent(o.name), { method: 'DELETE' });
          setSectionStatus(els.mediaAuditStatus, 'Deleted ' + filename + '.', 'success');
          state.mediaAuditState = null;
          await refreshMediaAudit(els);
        } catch (err) {
          setSectionStatus(els.mediaAuditStatus, err.message || 'Delete failed.', 'error');
        } finally { delItem.disabled = false; }
      });
      menu.appendChild(delItem);
    }

    actionsBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeMediaActionMenus(); closeSectionActionMenus(); closeArticleDetailsMenu(); closePolicyRuleMenus();
      menu.hidden = !willOpen;
      actionsBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    actionsWrap.append(actionsBtn, menu);
    actionsTd.appendChild(actionsWrap);

    tr.append(previewTd, fileTd, articleTd, statusTd, sizeTd, uploadedTd, actionsTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  const tableWrap = document.createElement('div'); tableWrap.className = 'sd-media-table-wrap'; tableWrap.appendChild(table);
  els.mediaAuditPanel.appendChild(tableWrap);

  // Footer + lazy-load sentinel
  const footer = document.createElement('div'); footer.className = 'sd-media-footer';
  const shown  = Math.min(view.visibleCount, filtered.length);
  footer.innerHTML = '<span>Showing <strong>' + shown + '</strong> of <strong>' + filtered.length + '</strong></span>';
  els.mediaAuditPanel.appendChild(footer);

  if (shown < filtered.length) {
    const sentinel = document.createElement('div'); sentinel.className = 'sd-media-sentinel'; sentinel.textContent = 'Loading more…';
    els.mediaAuditPanel.appendChild(sentinel);
    if (view.observer) { try { view.observer.disconnect(); } catch (_) {} }
    view.observer = new IntersectionObserver(function (entries) {
      if (!(entries && entries[0] && entries[0].isIntersecting)) return;
      view.visibleCount = Math.min(filtered.length, view.visibleCount + view.batchSize);
      paintMediaAudit(els);
    }, { root: null, rootMargin: '240px 0px', threshold: 0.01 });
    view.observer.observe(sentinel);
  } else if (view.observer) {
    try { view.observer.disconnect(); } catch (_) {}
    view.observer = null;
  }
}

// ── Thumbnail upload ──────────────────────────────────────────────────────────

export function setThumbStatus(els, msg, type) {
  if (!els.thumbStatus) return;
  els.thumbStatus.textContent = msg;
  els.thumbStatus.className   = 'sd-thumb-status sd-thumb-status--' + (type || 'info');
  els.thumbStatus.hidden      = !msg;
}

export async function uploadThumbnail(els, file) {
  if (!file || !file.type.startsWith('image/')) { setThumbStatus(els, 'Only image files are allowed.', 'error'); return; }
  if (file.size > 8 * 1024 * 1024)              { setThumbStatus(els, 'File too large. Maximum is 8 MB.', 'error'); return; }
  setThumbStatus(els, 'Uploading…', 'info');
  try {
    const form = new FormData();
    form.append('file', file);
    const res  = await fetch('/api/media/upload?preset=thumb', { method: 'POST', headers: authHeaders(), body: form });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.message || json.error || 'Upload failed');
    state.currentThumbnailUrl = json.url;
    setThumbPreview(state.currentThumbnailUrl);
    setThumbStatus(els, '', '');
  } catch (err) {
    setThumbStatus(els, err.message || 'Upload failed.', 'error');
  }
}

export function removeThumbnail(els) {
  state.currentThumbnailUrl = '';
  setThumbPreview('');
  setThumbStatus(els, '', '');
  if (els.thumbInput) els.thumbInput.value = '';
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _computeMediaMetrics(objects) {
  const items      = Array.isArray(objects) ? objects : [];
  const totalBytes = items.reduce(function (s, o) { return s + Number(o.size || 0); }, 0);
  const used       = items.filter(function (o) { return Array.isArray(o.referencedBy) && o.referencedBy.length; });
  const orphan     = items.filter(function (o) { return !Array.isArray(o.referencedBy) || !o.referencedBy.length; });
  const usedBytes  = used.reduce(function (s, o) { return s + Number(o.size || 0); }, 0);
  const orphanBytes= orphan.reduce(function (s, o) { return s + Number(o.size || 0); }, 0);
  return { total: items.length, totalBytes, used: used.length, orphan: orphan.length, usedBytes, orphanBytes };
}

function _paintMediaMetrics(metrics) {
  const ids = ['mediaTotalCount', 'mediaTotalSize', 'mediaUsedCount', 'mediaOrphanCount', 'mediaUsedBytes', 'mediaOrphanBytes'];
  const vals = [
    String(metrics.total), formatBytes(metrics.totalBytes),
    String(metrics.used),  String(metrics.orphan),
    formatBytes(metrics.usedBytes), formatBytes(metrics.orphanBytes),
  ];
  ids.forEach(function (id, i) { const el = document.getElementById(id); if (el) el.textContent = vals[i]; });
}
