/**
 * Atlas AI Evaluation
 *
 * S — all evaluation concerns here; no nav dependency.
 * D — renderKpiCards / renderDataTable injected from shared primitives.
 */

import { state }              from '../../state.js';
import { setSectionStatus }   from '../../http.js';
import { escapeHtml, formatWhen } from '../../utils.js';
import { atlasConfig }        from './config.js';
import { renderKpiCards }     from '../../../../../assets/ui/kpi-cards.js';
import { renderDataTable }    from '../../../../../assets/ui/datatable.js';
import { showToast }          from '../../../../../assets/ui/toast.js';

let _ragEvalSource = null;

// ── Columns shared across table renders ───────────────────────────────────────
const HISTORY_COLS = [
  { header: 'Run',         renderText: function (r, i, all) { return '#' + (all.length - i); } },
  { header: 'Date & Time', renderText: function (r) { return r.ranAt ? new Date(r.ranAt).toLocaleString() : '—'; } },
  { header: 'Mode',        renderHtml: function (r) { return '<span class="sd-eval-mode-chip">' + escapeHtml(_modeLabel(r.mode)) + '</span>'; } },
  { header: 'Recall@K',    renderText: function (r) { return r.metrics?.recallAtK != null ? (r.metrics.recallAtK * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Precision@K', renderText: function (r) { return r.metrics?.precisionAtK != null ? (r.metrics.precisionAtK * 100).toFixed(1) + '%' : '—'; } },
  { header: 'MRR',         renderText: function (r) { return r.metrics?.mrr       != null ? r.metrics.mrr.toFixed(3) : '—'; } },
  { header: 'Faithfulness',renderText: function (r) { return r.metrics?.faithfulness != null ? (r.metrics.faithfulness * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Pass / Total',renderText: function (r) { return (r.hits || 0) + ' / ' + (r.total || 0); } },
  { header: 'Status',      renderHtml: function (r) {
    return r.passed
      ? '<span class="sd-obs-badge sd-obs-badge--pass">PASS</span>'
      : '<span class="sd-obs-badge sd-obs-badge--fail">FAIL</span>';
  }},
  { header: 'Actions', renderHtml: function (r) {
    return '<button type="button" class="sd-eval-golden-remove" data-delete-run-id="' + escapeHtml(r.id || '') + '" title="Delete run">' +
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '</button>';
  }},
];

const FAILED_COLS = [
  { header: '#',                renderText: function (r) { return String(r.index); } },
  { header: 'Question',         renderText: function (r) { return r.question || ''; }, className: 'sd-obs-question' },
  { header: 'Expected Article', renderText: function (r) { return r.expectedArticleId || ''; } },
  { header: 'Top Retrieved',    renderHtml: function (r) {
    if (r.error) return '<span class="sd-obs-error" title="' + escapeHtml(r.error) + '">⚠ error</span>';
    if (r.retrievedArticles && r.retrievedArticles.length)
      return r.retrievedArticles.slice(0, 3).map(function (id) { return '<span class="sd-obs-retrieved">' + escapeHtml(id) + '</span>'; }).join('');
    return '<span class="sd-obs-none">none</span>';
  }},
  { header: 'Hit?',  renderHtml: function () { return '<span class="sd-obs-badge sd-obs-badge--miss">Miss</span>'; } },
  { header: 'Rank',  renderText: function (r) { return r.rank != null ? String(r.rank) : '—'; } },
  { header: 'Actions', renderHtml: function (r) {
    return '<button type="button" class="sd-eval-golden-remove" data-dismiss-row="' + escapeHtml(String(r.index)) + '" title="Dismiss">' +
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '</button>';
  }},
];

// ── ① Render / init ───────────────────────────────────────────────────────────
export function renderEvaluationPage(els) {
  const enabled = atlasConfig && atlasConfig.ragEnabled;
  if (els.runEvalBtn) {
    els.runEvalBtn.disabled = !enabled;
    els.runEvalBtn.title = enabled ? '' : 'Enable RAG in AI Configuration → Retrieval first.';
  }
  if (els.evalThresholdRecall && atlasConfig)
    els.evalThresholdRecall.textContent = atlasConfig.recallThreshold != null
      ? ((atlasConfig.recallThreshold * 100).toFixed(0) + ' %') : '80 %';
  if (els.evalThresholdMrr && atlasConfig)
    els.evalThresholdMrr.textContent = atlasConfig.faithfulnessThreshold != null
      ? atlasConfig.faithfulnessThreshold.toFixed(2) : '0.70';

  loadGoldenDataset(els);
  loadEvalHistory(els);
}

// ── ② Run evaluation ──────────────────────────────────────────────────────────
export function startRagEval(els, credential) {
  if (!atlasConfig || !atlasConfig.ragEnabled) {
    showToast('RAG is disabled. Enable it in AI Configuration → Retrieval before running evaluation.', { kind: 'warning', duration: 0 });
    return;
  }
  if (_ragEvalSource) { _ragEvalSource.close(); _ragEvalSource = null; }

  const mode = (document.querySelector('input[name="evalMode"]:checked') || {}).value || 'golden';

  setSectionStatus(els.atlasEvalStatus, '', '');
  _show(els.ragProgressWrap, true);
  _show(els.evalMetricsWrap, false);
  _show(els.ragGateBadge,    false);
  _show(els.ragDetailWrap,   false);
  _show(els.ragHistoryWrap,  false);

  if (els.ragProgressBar)   els.ragProgressBar.style.width = '0%';
  if (els.ragProgressLabel) els.ragProgressLabel.textContent = 'Connecting…';
  if (els.runEvalBtn)       els.runEvalBtn.disabled = true;

  const source = new EventSource('/api/admin/atlas/rag-eval?token=' + encodeURIComponent(credential || '') + '&mode=' + encodeURIComponent(mode));
  _ragEvalSource = source;

  source.addEventListener('progress', function (evt) {
    try {
      const d = JSON.parse(evt.data);
      const pct = Math.round((d.index / d.total) * 100);
      if (els.ragProgressBar)   els.ragProgressBar.style.width = pct + '%';
      if (els.ragProgressLabel) els.ragProgressLabel.textContent =
        'Question ' + d.index + ' / ' + d.total + ': ' + (d.hit ? '✓' : '✗') + ' ' + d.question.slice(0, 80);
    } catch (_) {}
  });

  source.addEventListener('result', function (evt) {
    try {
      const d = JSON.parse(evt.data);
      renderEvalMetrics(els, d.metrics);
      if (d.details) renderFailedCases(els, d.details);
      if (els.ragProgressBar)   els.ragProgressBar.style.width = '100%';
      if (els.ragProgressLabel) els.ragProgressLabel.textContent = 'Complete.';
      setTimeout(function () { loadEvalHistory(els); }, 1500);
    } catch (_) {}
  });

  source.addEventListener('error', function (evt) {
    let msg = 'Evaluation failed.';
    try { msg = JSON.parse(evt.data).message || msg; } catch (_) {}
    setSectionStatus(els.atlasEvalStatus, msg, 'error');
    if (els.ragProgressLabel) els.ragProgressLabel.textContent = 'Error — see status above.';
  });

  source.onopen  = function () { if (els.ragProgressLabel) els.ragProgressLabel.textContent = 'Starting…'; };
  source.onerror = function () {
    if (source.readyState === EventSource.CLOSED) {
      source.close(); _ragEvalSource = null;
      if (els.runEvalBtn) els.runEvalBtn.disabled = false;
    }
  };
  source.addEventListener('done', function () {
    source.close(); _ragEvalSource = null;
    if (els.runEvalBtn) els.runEvalBtn.disabled = false;
    _show(els.ragProgressWrap, false);
  });
}

// ── ③ Evaluation Metrics — renderKpiCards ─────────────────────────────────────
export function renderEvalMetrics(els, metrics) {
  if (!els.evalMetricsMount) return;
  const rT = (atlasConfig && atlasConfig.recallThreshold)     || 0.80;
  const mT = (atlasConfig && atlasConfig.faithfulnessThreshold) || 0.70;

  const pct = function (v) { return v != null ? +(v * 100).toFixed(1) : null; };
  const fix = function (v) { return v != null ? +v.toFixed(3) : null; };

  const cards = [
    { title: 'Recall@K',           icon: 'manage_search',  iconVariant: 'ok',      value: pct(metrics.recallAtK)        != null ? pct(metrics.recallAtK) + ' %' : '—',   cardVariant: _pass(pct(metrics.recallAtK) / 100, rT),      trend: 'target ≥ ' + (rT * 100).toFixed(0) + ' %' },
    { title: 'Precision@K',        icon: 'target',         iconVariant: 'arr',     value: pct(metrics.precisionAtK)     != null ? pct(metrics.precisionAtK) + ' %' : '—', trend: 'of all retrieved slots' },
    { title: 'MRR',                icon: 'leaderboard',    iconVariant: 'mrr',     value: fix(metrics.mrr)              != null ? fix(metrics.mrr) : '—',                  cardVariant: _pass(metrics.mrr, mT),                       trend: 'target ≥ ' + mT.toFixed(2) },
    { title: 'Faithfulness',       icon: 'verified',       iconVariant: 'users',   value: pct(metrics.faithfulness)     != null ? pct(metrics.faithfulness) + ' %' : '—',  cardVariant: _pass(pct(metrics.faithfulness), 70),          trend: 'LLM answer vs. chunks' },
    { title: 'Hallucination Score',icon: 'psychology_alt', iconVariant: 'danger',  value: pct(metrics.hallucination)    != null ? pct(metrics.hallucination) + ' %' : '—',  cardVariant: _passInv(pct(metrics.hallucination), 20),      trend: 'lower is better' },
    { title: 'Answer Correctness', icon: 'fact_check',     iconVariant: 'info',    value: pct(metrics.answerCorrectness)!= null ? pct(metrics.answerCorrectness) + ' %' : '—', cardVariant: _pass(pct(metrics.answerCorrectness), 70), trend: 'vs. golden answer' },
  ];

  renderKpiCards(els.evalMetricsMount, { cards });
  _show(els.evalMetricsWrap, true);

  const pass = (metrics.recallAtK || 0) >= rT && (metrics.mrr || 0) >= mT;
  if (els.ragGateBadge) {
    els.ragGateBadge.textContent = pass
      ? '✓ PASS — Recall@K and MRR meet thresholds. Configuration is production-ready.'
      : '✗ BELOW THRESHOLD — Recall@K or MRR not met. Tune chunking/retrieval before promoting.';
    els.ragGateBadge.className = 'sd-observability-gate sd-observability-gate--' + (pass ? 'pass' : 'fail');
    _show(els.ragGateBadge, true);
  }
  _updateSummary(els, metrics, pass);
}

// ── ④ Golden Dataset (editable form — stays custom) ───────────────────────────
export function loadGoldenDataset(els) {
  if (!els.goldenDatasetBody) return;
  const token = state.credential || '';
  fetch('/api/admin/atlas/golden-dataset', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.success) renderGoldenDataset(els, d.rows || []); })
    .catch(function () {});
}

export function addGoldenRow(els) {
  const tbody = els.goldenDatasetBody;
  if (!tbody) return;
  const empty = document.getElementById('goldenDatasetEmpty');
  if (empty) empty.remove();
  const idx = tbody.querySelectorAll('tr[data-golden-row]').length + 1;
  const tr  = document.createElement('tr');
  tr.dataset.goldenRow = 'true';
  tr.innerHTML = _goldenRowHtml(idx, {});
  tbody.appendChild(tr);
  tr.querySelector('.sd-eval-golden-question').focus();
}

export function saveGoldenDataset(els) {
  const tbody = els.goldenDatasetBody;
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr[data-golden-row]')).map(function (tr) {
    return {
      question:          (tr.querySelector('.sd-eval-golden-question')   || {}).value || '',
      expectedArticleId: (tr.querySelector('.sd-eval-golden-article-id') || {}).value || '',
      expectedAnswer:    (tr.querySelector('.sd-eval-golden-answer')     || {}).value || '',
    };
  }).filter(function (r) { return r.question.trim(); });

  if (!rows.length) { setSectionStatus(els.goldenDatasetStatus, 'Add at least one question before saving.', 'error'); return; }
  setSectionStatus(els.goldenDatasetStatus, 'Saving…', 'info');
  const token = state.credential || '';
  fetch('/api/admin/atlas/golden-dataset', {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify({ rows }),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.success) {
        setSectionStatus(els.goldenDatasetStatus, 'Saved ' + rows.length + ' question(s).', 'success');
        setTimeout(function () { setSectionStatus(els.goldenDatasetStatus, '', ''); }, 2000);
      } else {
        setSectionStatus(els.goldenDatasetStatus, d.error || 'Save failed.', 'error');
      }
    })
    .catch(function (err) { setSectionStatus(els.goldenDatasetStatus, err.message || 'Save failed.', 'error'); });
}

export function resetGoldenDataset(els) {
  if (!window.confirm('Reset golden dataset to the default 50 questions? This will discard any custom changes.')) return;
  
  setSectionStatus(els.goldenDatasetStatus, 'Resetting…', 'info');
  const token = state.credential || '';
  fetch('/api/admin/atlas/golden-dataset', {
    method: 'DELETE',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.success) {
        setSectionStatus(els.goldenDatasetStatus, 'Reset to defaults. Reloading…', 'success');
        setTimeout(function () { loadGoldenDataset(els); }, 500);
      } else {
        setSectionStatus(els.goldenDatasetStatus, d.error || 'Reset failed.', 'error');
      }
    })
    .catch(function (err) { setSectionStatus(els.goldenDatasetStatus, err.message || 'Reset failed.', 'error'); });
}

function renderGoldenDataset(els, rows) {
  const tbody = els.goldenDatasetBody;
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="5">' +
        '<div class="sd-eval-dataset-empty" id="goldenDatasetEmpty">' +
          '<span class="material-symbols-outlined" aria-hidden="true">inbox</span>' +
          '<p class="sd-eval-dataset-empty-title">No data found</p>' +
          '<p class="sd-eval-dataset-empty-sub">Add your first Q&amp;A pair to get started.</p>' +
        '</div>' +
      '</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(function (row, i) {
    return '<tr data-golden-row="true">' + _goldenRowHtml(i + 1, row) + '</tr>';
  }).join('');
}

function _goldenRowHtml(idx, row) {
  return [
    '<td>' + idx + '</td>',
    '<td><input class="sd-eval-golden-input sd-eval-golden-question" type="text" placeholder="Enter question…" value="' + escapeHtml(row.question || '') + '"></td>',
    '<td><input class="sd-eval-golden-input sd-eval-golden-article-id" type="text" placeholder="article-slug" value="' + escapeHtml(row.expectedArticleId || '') + '"></td>',
    '<td><input class="sd-eval-golden-input sd-eval-golden-answer" type="text" placeholder="Expected answer snippet…" value="' + escapeHtml(row.expectedAnswer || '') + '"></td>',
    '<td><button type="button" class="sd-eval-golden-remove" title="Remove row" onclick="this.closest(\'tr\').remove()"><span class="material-symbols-outlined" aria-hidden="true">delete</span></button></td>',
  ].join('');
}

export function filterGoldenDataset(els) {
  const tbody = els.goldenDatasetBody;
  const searchEl = els.goldenDatasetSearch;
  if (!tbody || !searchEl) return;
  const q = searchEl.value.trim().toLowerCase();
  Array.from(tbody.querySelectorAll('tr[data-golden-row]')).forEach(function (tr) {
    const text = tr.textContent.toLowerCase();
    tr.style.display = q && !text.includes(q) ? 'none' : '';
  });
}

// ── ⑤ Regression History — renderDataTable ────────────────────────────────────
export function loadEvalHistory(els) {
  if (!els.ragHistoryMount) return;
  const token = state.credential || '';
  fetch('/api/admin/atlas/rag-eval/history?limit=20', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
    .then(function (r) { return r.json(); })
    .then(function (d) { if (d.success) _renderHistory(els, d.runs || []); })
    .catch(function () {});
}

function _renderHistory(els, runs) {
  if (!els.ragHistoryMount || !els.ragHistoryWrap) return;
  if (runs.length) {
    const latest = runs[0];
    if (latest && latest.metrics) {
      const rT = (atlasConfig && atlasConfig.recallThreshold)       || 0.80;
      const mT = (atlasConfig && atlasConfig.faithfulnessThreshold) || 0.70;
      const pass = (latest.metrics.recallAtK || 0) >= rT && (latest.metrics.mrr || 0) >= mT;
      _updateSummary(els, { recallAtK: latest.metrics.recallAtK, mrr: latest.metrics.mrr, hits: latest.hits, total: latest.total }, pass, latest.ranAt);
    }
  }
  // Pass index into renderText via closure over the array
  const cols = HISTORY_COLS.map(function (c) {
    if (c.header === 'Run') {
      return Object.assign({}, c, { renderText: function (r, i) { return '#' + (runs.length - i); } });
    }
    return c;
  });
  renderDataTable(els.ragHistoryMount, { columns: cols, rows: runs, emptyText: 'No runs recorded yet.' });
  _show(els.ragHistoryWrap, true);
  _wireHistoryDelete(els);
}

function _wireHistoryDelete(els) {
  const mount = els.ragHistoryMount;
  if (!mount || mount._deleteWired) return;
  mount._deleteWired = true;
  mount.addEventListener('click', function (evt) {
    const btn = evt.target.closest('[data-delete-run-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-delete-run-id');
    if (!id) return;
    if (!window.confirm('Delete this evaluation run? This cannot be undone.')) return;
    _deleteEvalRun(els, id, btn);
  });
}

function _deleteEvalRun(els, id, btn) {
  if (btn) btn.disabled = true;
  const token = state.credential || '';
  fetch('/api/admin/atlas/rag-eval/history/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.success) { showToast('Run deleted.', { kind: 'success' }); loadEvalHistory(els); }
      else { showToast(d.error || 'Delete failed.', { kind: 'error' }); if (btn) btn.disabled = false; }
    })
    .catch(function (err) { showToast(err.message || 'Delete failed.', { kind: 'error' }); if (btn) btn.disabled = false; });
}

// ── ⑥ Failed Test Cases — renderDataTable ─────────────────────────────────────
export function renderFailedCases(els, details) {
  if (!els.ragDetailMount) return;
  const failures = details.filter(function (r) { return !r.hit; });
  if (!failures.length) { _show(els.ragDetailWrap, false); return; }
  renderDataTable(els.ragDetailMount, { columns: FAILED_COLS, rows: failures, emptyText: 'No failures.' });
  _show(els.ragDetailWrap, true);
  _wireFailedDismiss(els);
}

function _wireFailedDismiss(els) {
  const mount = els.ragDetailMount;
  if (!mount || mount._dismissWired) return;
  mount._dismissWired = true;
  mount.addEventListener('click', function (evt) {
    const btn = evt.target.closest('[data-dismiss-row]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (tr) tr.remove();
  });
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function _updateSummary(els, metrics, pass, ranAt) {
  if (!els.evalSummaryMount) return;
  const passRate = metrics.hits != null && metrics.total
    ? ((metrics.hits / metrics.total) * 100).toFixed(0) + ' %' : '—';
  renderKpiCards(els.evalSummaryMount, {
    cards: [
      { title: 'Overall Score',    icon: 'star',          iconVariant: 'arr',     value: metrics.recallAtK != null ? (metrics.recallAtK * 100).toFixed(1) + ' %' : '—' },
      { title: 'Pass Rate',        icon: 'check_circle',  iconVariant: 'ok',      value: passRate },
      { title: 'Last Run',         icon: 'schedule',      iconVariant: 'users',   value: ranAt ? formatWhen(ranAt) : 'Just now' },
      { title: 'Production Ready', icon: 'rocket_launch', iconVariant: pass === true ? 'ok' : pass === false ? 'danger' : 'neutral',
        value: pass === true ? 'Yes' : pass === false ? 'Not yet' : '—',
        cardVariant: pass === true ? 'pass' : pass === false ? 'fail' : '' },
    ],
  });
}

function _pass(val, threshold)    { return val == null ? '' : val >= threshold ? 'pass' : 'fail'; }
function _passInv(val, threshold) { return val == null ? '' : val <= threshold ? 'pass' : 'fail'; }
function _modeLabel(mode) { return { golden: 'Golden', smoke: 'Smoke', regression: 'Full Regression' }[mode] || (mode || 'Golden'); }
function _show(el, show)  { if (el) el.hidden = !show; }
