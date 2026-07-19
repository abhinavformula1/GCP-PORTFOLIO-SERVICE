/**
 * Atlas AI Evaluation
 *
 * S — all evaluation concerns here; no nav dependency.
 * D — renderKpiCards / renderDataTable injected from shared primitives.
 */

import { state }              from '../../state.js';
import { authedJson, setSectionStatus }   from '../../http.js';
import { escapeHtml, formatWhen } from '../../utils.js';
import { atlasConfig }        from './config.js';
import { renderKpiCards }     from '../../../../../assets/ui/kpi-cards.js';
import { renderDataTable }    from '../../../../../assets/ui/datatable.js';
import { showToast }          from '../../../../../assets/ui/toast.js';

let _ragEvalSource = null;
let _latestEvalSummary = null;
let _runtimeAtlasConfig = null;
let _activeEvalTab = 'retrieval';
let _historyRunsCache = [];
const EVAL_SUMMARY_CACHE_KEY = 'sd-atlas-eval-summary-v1';
const EVAL_TAB_CACHE_KEY = 'sd-atlas-eval-tab-v1';

// ── Columns shared across table renders ───────────────────────────────────────
const HISTORY_COLS_RETRIEVAL = [
  { header: 'Run',         width: 72,  renderText: function (r, i, all) { return '#' + (all.length - i); } },
  { header: 'Date & Time', width: 148, renderText: function (r) { return r.ranAt ? new Date(r.ranAt).toLocaleString() : '—'; } },
  { header: 'Mode',        width: 96,  renderHtml: function (r) { return '<span class="sd-eval-mode-chip">' + escapeHtml(_modeLabel(r.mode)) + '</span>'; } },
  { header: 'Recall@K',    width: 84,  align: 'right', renderText: function (r) { return r.metrics?.recallAtK != null ? (r.metrics.recallAtK * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Precision@K', width: 92,  align: 'right', renderText: function (r) { return r.metrics?.precisionAtK != null ? (r.metrics.precisionAtK * 100).toFixed(1) + '%' : '—'; } },
  { header: 'MRR',         width: 72,  align: 'right', renderText: function (r) { return r.metrics?.mrr       != null ? r.metrics.mrr.toFixed(3) : '—'; } },
  { header: 'Pass / Total',width: 84,  align: 'right', renderText: function (r) { return (r.hits || 0) + ' / ' + (r.total || 0); } },
  { header: 'Status',      width: 88,  renderHtml: function (r) {
    return _didRunPass(r)
      ? '<span class="sd-obs-badge sd-obs-badge--pass">PASS</span>'
      : '<span class="sd-obs-badge sd-obs-badge--fail">FAIL</span>';
  }},
  { header: 'Actions', width: 110, renderHtml: function (r) {
    if (r && r._localOnly) {
      return '<span class="sd-obs-none">Pending save</span>';
    }
    return '<button type="button" class="sd-eval-golden-remove" data-delete-run-id="' + escapeHtml(r.id || '') + '" title="Delete run">' +
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '</button>';
  }},
];

const HISTORY_COLS_GENERATION = [
  { header: 'Run',         width: 72,  renderText: function (r, i, all) { return '#' + (all.length - i); } },
  { header: 'Date & Time', width: 148, renderText: function (r) { return r.ranAt ? new Date(r.ranAt).toLocaleString() : '—'; } },
  { header: 'Mode',        width: 96,  renderHtml: function (r) { return '<span class="sd-eval-mode-chip">' + escapeHtml(_modeLabel(r.mode)) + '</span>'; } },
  { header: 'Faithfulness',width: 96,  align: 'right', renderText: function (r) { return r.metrics?.faithfulness != null ? (r.metrics.faithfulness * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Hallucination', width: 102, align: 'right', renderText: function (r) { return r.metrics?.hallucination != null ? (r.metrics.hallucination * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Answer Correctness', width: 126, align: 'right', renderText: function (r) { return r.metrics?.answerCorrectness != null ? (r.metrics.answerCorrectness * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Judge Status', width: 110, renderHtml: function (r) {
    return _hasGenerationMetrics(r)
      ? '<span class="sd-obs-badge sd-obs-badge--pass">AVAILABLE</span>'
      : '<span class="sd-obs-badge sd-obs-badge--miss">PENDING</span>';
  }},
  { header: 'Status',      width: 88,  renderHtml: function (r) {
    return _didGenerationPass(r)
      ? '<span class="sd-obs-badge sd-obs-badge--pass">PASS</span>'
      : '<span class="sd-obs-badge sd-obs-badge--fail">FAIL</span>';
  }},
  { header: 'Actions', width: 110, renderHtml: function (r) {
    if (r && r._localOnly) {
      return '<span class="sd-obs-none">Pending save</span>';
    }
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
  { header: 'Faithfulness', renderText: function (r) { return r.faithfulness != null ? (r.faithfulness * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Hallucination', renderText: function (r) { return r.hallucination != null ? (r.hallucination * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Answer Correctness', renderText: function (r) { return r.answerCorrectness != null ? (r.answerCorrectness * 100).toFixed(1) + '%' : '—'; } },
  { header: 'Actions', renderHtml: function (r) {
    return '<button type="button" class="sd-eval-golden-remove" data-dismiss-row="' + escapeHtml(String(r.index)) + '" title="Dismiss">' +
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '</button>';
  }},
];

// ── ① Render / init ───────────────────────────────────────────────────────────
export async function renderEvaluationPage(els) {
  _latestEvalSummary = null;
  const cfg = await _ensureAtlasConfig();
  const enabled = cfg && cfg.ragEnabled;
  if (els.runEvalBtn) {
    els.runEvalBtn.disabled = !enabled;
    els.runEvalBtn.title = enabled ? '' : 'Enable RAG in AI Configuration → Retrieval first.';
  }
  if (els.evalThresholdRecall && cfg)
    els.evalThresholdRecall.textContent = cfg.recallThreshold != null
      ? ((cfg.recallThreshold * 100).toFixed(0) + ' %') : '80 %';
  if (els.evalThresholdMrr && cfg)
    els.evalThresholdMrr.textContent = cfg.faithfulnessThreshold != null
      ? cfg.faithfulnessThreshold.toFixed(2) : '0.70';

  _wireEvalTabs(els);
  _setEvalTab(els, _readCachedTab());
  _renderGenerationEvalStatus(els);
  _applyCachedSummary(els);
  loadGoldenDataset(els);
  loadEvalHistory(els);
}

// ── ② Run evaluation ──────────────────────────────────────────────────────────
export function startRagEval(els, credential) {
  const cfg = _getActiveAtlasConfig();
  if (!cfg || !cfg.ragEnabled) {
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
      const livePass = typeof d.passed === 'boolean' ? d.passed : undefined;
      renderEvalMetrics(els, d.metrics, livePass);
      _latestEvalSummary = {
        id: d.savedRun && d.savedRun.id ? d.savedRun.id : '',
        ranAt: d.savedRun && d.savedRun.ranAt ? d.savedRun.ranAt : new Date().toISOString(),
        mode: d.savedRun && d.savedRun.mode ? d.savedRun.mode : mode,
        metrics: d.metrics,
        pass: typeof d.passed === 'boolean' ? d.passed : null,
        hits: d.savedRun && d.savedRun.hits != null ? d.savedRun.hits : null,
        total: d.savedRun && d.savedRun.total != null ? d.savedRun.total : null,
        _localOnly: !(d.savedRun && d.savedRun.id),
      };
      _persistLatestSummary(_latestEvalSummary);
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
export function renderEvalMetrics(els, metrics, forcedPass) {
  if (!els.evalMetricsMount && !els.evalGenerationMetricsMount) return;
  const cfg = _getActiveAtlasConfig();
  const rT = (cfg && cfg.recallThreshold)     || 0.80;
  const mT = (cfg && cfg.faithfulnessThreshold) || 0.70;

  const pct = function (v) { return v != null ? +(v * 100).toFixed(1) : null; };
  const fix = function (v) { return v != null ? +v.toFixed(3) : null; };

  const retrievalCards = [
    { title: 'Recall@K',           icon: 'manage_search',  iconVariant: 'ok',      value: pct(metrics.recallAtK)        != null ? pct(metrics.recallAtK) + ' %' : '—',   cardVariant: _pass(pct(metrics.recallAtK) / 100, rT),      trend: 'target ≥ ' + (rT * 100).toFixed(0) + ' %' },
    { title: 'Precision@K',        icon: 'target',         iconVariant: 'arr',     value: pct(metrics.precisionAtK)     != null ? pct(metrics.precisionAtK) + ' %' : '—', trend: 'of all retrieved slots' },
    { title: 'MRR',                icon: 'leaderboard',    iconVariant: 'mrr',     value: fix(metrics.mrr)              != null ? fix(metrics.mrr) : '—',                  cardVariant: _pass(metrics.mrr, mT),                       trend: 'target ≥ ' + mT.toFixed(2) },
  ];
  const generationCards = [
    { title: 'Faithfulness',       icon: 'verified',       iconVariant: 'users',   value: pct(metrics.faithfulness)     != null ? pct(metrics.faithfulness) + ' %' : '—',  cardVariant: _pass(pct(metrics.faithfulness), 70),          trend: 'LLM answer vs. chunks' },
    { title: 'Hallucination Score',icon: 'psychology_alt', iconVariant: 'danger',  value: pct(metrics.hallucination)    != null ? pct(metrics.hallucination) + ' %' : '—',  cardVariant: _passInv(pct(metrics.hallucination), 20),      trend: 'lower is better' },
    { title: 'Answer Correctness', icon: 'fact_check',     iconVariant: 'info',    value: pct(metrics.answerCorrectness)!= null ? pct(metrics.answerCorrectness) + ' %' : '—', cardVariant: _pass(pct(metrics.answerCorrectness), 70), trend: 'vs. golden answer' },
  ];

  if (els.evalMetricsMount) renderKpiCards(els.evalMetricsMount, { cards: retrievalCards });
  if (els.evalGenerationMetricsMount) renderKpiCards(els.evalGenerationMetricsMount, { cards: generationCards });
  _show(els.evalMetricsWrap, true);
  _show(els.evalGenerationMetricsWrap, true);

  const pass = typeof forcedPass === 'boolean'
    ? forcedPass
    : (metrics.recallAtK || 0) >= rT && (metrics.mrr || 0) >= mT;
  if (els.ragGateBadge) {
    els.ragGateBadge.textContent = pass
      ? '✓ PASS — Recall@K and MRR meet thresholds. Configuration is production-ready.'
      : '✗ BELOW THRESHOLD — Recall@K or MRR not met. Tune chunking/retrieval before promoting.';
    els.ragGateBadge.className = 'sd-observability-gate sd-observability-gate--' + (pass ? 'pass' : 'fail');
    _show(els.ragGateBadge, true);
  }
  _updateRetrievalSummary(els, metrics, pass);
  _updateGenerationSummary(els, metrics);
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
  const mergedRuns = _mergeLatestRunIntoHistory(runs);
  _historyRunsCache = mergedRuns;
  if (mergedRuns.length) {
    const latest = mergedRuns[0];
    if (latest && latest.metrics) {
      const cfg = _getActiveAtlasConfig();
      const rT = (cfg && cfg.recallThreshold)       || 0.80;
      const mT = (cfg && cfg.faithfulnessThreshold) || 0.70;
      const pass = (latest.metrics.recallAtK || 0) >= rT && (latest.metrics.mrr || 0) >= mT;
      const latestMs = latest.ranAt ? Date.parse(latest.ranAt) : 0;
      const liveMs = _latestEvalSummary && _latestEvalSummary.ranAt ? Date.parse(_latestEvalSummary.ranAt) : 0;
      if (!_latestEvalSummary || !liveMs || latestMs >= liveMs) {
        _latestEvalSummary = {
          id: latest.id || '',
          ranAt: latest.ranAt || null,
          mode: latest.mode || 'golden',
          metrics: latest.metrics,
          pass,
          hits: latest.hits,
          total: latest.total,
          _localOnly: !!latest._localOnly,
        };
        _persistLatestSummary(_latestEvalSummary);
        _updateSummary(els, { recallAtK: latest.metrics.recallAtK, mrr: latest.metrics.mrr, hits: latest.hits, total: latest.total }, pass, latest.ranAt);
      } else if (_latestEvalSummary && _latestEvalSummary.metrics) {
        _updateSummary(els, {
          recallAtK: _latestEvalSummary.metrics.recallAtK,
          mrr: _latestEvalSummary.metrics.mrr,
          hits: _latestEvalSummary.hits,
          total: _latestEvalSummary.total,
        }, _latestEvalSummary.pass, _latestEvalSummary.ranAt);
      }
    }
  }
  _renderHistoryTable(els, mergedRuns);
  _show(els.ragHistoryWrap, true);
  _wireHistoryDelete(els);
}

function _renderHistoryTable(els, mergedRuns) {
  // Pass index into renderText via closure over the array
  const baseCols = _activeEvalTab === 'generation' ? HISTORY_COLS_GENERATION : HISTORY_COLS_RETRIEVAL;
  const cols = baseCols.map(function (c) {
    if (c.header === 'Run') {
      return Object.assign({}, c, { renderText: function (r, i) { return '#' + (mergedRuns.length - i); } });
    }
    return c;
  });
  renderDataTable(els.ragHistoryMount, { columns: cols, rows: mergedRuns, emptyText: 'No runs recorded yet.' });
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
  _updateRetrievalSummary(els, metrics, pass, ranAt);
  _updateGenerationSummary(els, metrics, ranAt);
}

function _updateRetrievalSummary(els, metrics, pass, ranAt) {
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

function _updateGenerationSummary(els, metrics, ranAt) {
  if (!els.evalGenerationSummaryMount) return;
  const faithfulness = Number(metrics.faithfulness);
  const hallucination = Number(metrics.hallucination);
  const answerCorrectness = Number(metrics.answerCorrectness);
  const hasGenerationScores = [faithfulness, hallucination, answerCorrectness].some(function (v) { return Number.isFinite(v) && v >= 0; });
  const composite = hasGenerationScores
    ? _mean([
      Number.isFinite(faithfulness) ? faithfulness : null,
      Number.isFinite(answerCorrectness) ? answerCorrectness : null,
      Number.isFinite(hallucination) ? (1 - hallucination) : null,
    ])
    : null;
  const generationReady = Number.isFinite(faithfulness) && faithfulness >= 0.7
    && Number.isFinite(answerCorrectness) && answerCorrectness >= 0.7
    && Number.isFinite(hallucination) && hallucination <= 0.2;
  renderKpiCards(els.evalGenerationSummaryMount, {
    cards: [
      { title: 'Overall Score', icon: 'star', iconVariant: 'arr', value: composite != null ? (composite * 100).toFixed(1) + ' %' : '—' },
      { title: 'Judge Status', icon: 'fact_check', iconVariant: hasGenerationScores ? 'ok' : 'neutral', value: hasGenerationScores ? 'Available' : 'Pending' },
      { title: 'Last Run', icon: 'schedule', iconVariant: 'users', value: ranAt ? formatWhen(ranAt) : 'Just now' },
      { title: 'Generation Ready', icon: 'auto_awesome', iconVariant: generationReady ? 'ok' : hasGenerationScores ? 'danger' : 'neutral',
        value: generationReady ? 'Yes' : hasGenerationScores ? 'Not yet' : '—',
        cardVariant: generationReady ? 'pass' : hasGenerationScores ? 'fail' : '' },
    ],
  });
}

function _readCachedSummary() {
  try {
    const raw = localStorage.getItem(EVAL_SUMMARY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.metrics) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function _persistLatestSummary(summary) {
  if (!summary || !summary.metrics) return;
  try {
    localStorage.setItem(EVAL_SUMMARY_CACHE_KEY, JSON.stringify(summary));
  } catch (_) {}
}

function _applyCachedSummary(els) {
  const cached = _readCachedSummary();
  if (!cached || !cached.metrics) return;
  _latestEvalSummary = cached;
  _updateSummary(els, Object.assign({}, cached.metrics, {
    hits: cached.hits,
    total: cached.total,
  }), cached.pass, cached.ranAt);
}

function _renderGenerationEvalStatus(els) {
  const cfg = _getActiveAtlasConfig();
  const ready = !!(cfg && cfg._meta && cfg._meta.generationEvalsReady);
  const reason = cfg && cfg._meta && cfg._meta.generationEvalsReason
    ? String(cfg._meta.generationEvalsReason)
    : 'Generation eval status is unavailable.';
  if (els.generationEvalStatusBadge) {
    els.generationEvalStatusBadge.textContent = ready ? 'Enabled' : 'Disabled';
    els.generationEvalStatusBadge.className = 'sd-eval-generation-badge sd-eval-generation-badge--' + (ready ? 'ok' : 'off');
  }
  if (els.generationEvalStatusText) {
    els.generationEvalStatusText.textContent = ready
      ? reason + ' Old history rows will stay blank until you run a fresh evaluation.'
      : reason;
  }
  if (els.generationEvalStatusCard) {
    els.generationEvalStatusCard.classList.toggle('is-disabled', !ready);
  }
}

function _mergeLatestRunIntoHistory(runs) {
  const list = Array.isArray(runs) ? runs.slice() : [];
  if (!_latestEvalSummary || !_latestEvalSummary.metrics || !_latestEvalSummary.ranAt) return list;

  const latestMs = Date.parse(_latestEvalSummary.ranAt || '') || 0;
  if (!latestMs) return list;

  const alreadyPresent = list.some(function (run) {
    if (!run) return false;
    if (_latestEvalSummary.id && run.id && run.id === _latestEvalSummary.id) return true;
    const runMs = run.ranAt ? Date.parse(run.ranAt) : 0;
    return !!runMs && runMs === latestMs;
  });
  if (alreadyPresent) return list;

  const synthetic = {
    id: _latestEvalSummary.id || '',
    ranAt: _latestEvalSummary.ranAt,
    mode: _latestEvalSummary.mode || 'golden',
    metrics: _latestEvalSummary.metrics,
    hits: _latestEvalSummary.hits,
    total: _latestEvalSummary.total,
    passed: _latestEvalSummary.pass === true,
    _localOnly: true,
  };
  list.unshift(synthetic);
  return list;
}

function _didRunPass(run) {
  const cfg = _getActiveAtlasConfig();
  const rT = (cfg && cfg.recallThreshold) || 0.80;
  const mT = (cfg && cfg.faithfulnessThreshold) || 0.70;
  const metrics = run && run.metrics ? run.metrics : {};
  return Number(metrics.recallAtK || 0) >= rT && Number(metrics.mrr || 0) >= mT;
}

function _didGenerationPass(run) {
  const metrics = run && run.metrics ? run.metrics : {};
  return Number(metrics.faithfulness) >= 0.7
    && Number(metrics.answerCorrectness) >= 0.7
    && Number(metrics.hallucination) <= 0.2;
}

function _hasGenerationMetrics(run) {
  const metrics = run && run.metrics ? run.metrics : {};
  return metrics.faithfulness != null || metrics.hallucination != null || metrics.answerCorrectness != null;
}

function _getActiveAtlasConfig() {
  return atlasConfig || _runtimeAtlasConfig || null;
}

async function _ensureAtlasConfig() {
  const live = _getActiveAtlasConfig();
  if (live) return live;
  try {
    const data = await authedJson('/api/admin/atlas/config');
    _runtimeAtlasConfig = Object.assign({}, data && data.config ? data.config : {}, {
      _meta: data && data.meta ? data.meta : {},
    });
  } catch (_) {
    _runtimeAtlasConfig = {};
  }
  return _runtimeAtlasConfig;
}

function _pass(val, threshold)    { return val == null ? '' : val >= threshold ? 'pass' : 'fail'; }
function _passInv(val, threshold) { return val == null ? '' : val <= threshold ? 'pass' : 'fail'; }
function _modeLabel(mode) { return { golden: 'Golden', smoke: 'Smoke', regression: 'Full Regression' }[mode] || (mode || 'Golden'); }
function _show(el, show)  { if (el) el.hidden = !show; }
function _mean(values) {
  const nums = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); });
  if (!nums.length) return null;
  return nums.reduce(function (sum, v) { return sum + v; }, 0) / nums.length;
}
function _wireEvalTabs(els) {
  if (els.evalTabRetrievalBtn && !els.evalTabRetrievalBtn._wired) {
    els.evalTabRetrievalBtn._wired = true;
    els.evalTabRetrievalBtn.addEventListener('click', function () { _setEvalTab(els, 'retrieval'); });
  }
  if (els.evalTabGenerationBtn && !els.evalTabGenerationBtn._wired) {
    els.evalTabGenerationBtn._wired = true;
    els.evalTabGenerationBtn.addEventListener('click', function () { _setEvalTab(els, 'generation'); });
  }
}
function _setEvalTab(els, tab) {
  const nextTab = tab === 'generation' ? 'generation' : 'retrieval';
  _activeEvalTab = nextTab;
  if (els.evalTabRetrievalBtn) {
    const active = nextTab === 'retrieval';
    els.evalTabRetrievalBtn.classList.toggle('is-active', active);
    els.evalTabRetrievalBtn.setAttribute('aria-selected', String(active));
  }
  if (els.evalTabGenerationBtn) {
    const active = nextTab === 'generation';
    els.evalTabGenerationBtn.classList.toggle('is-active', active);
    els.evalTabGenerationBtn.setAttribute('aria-selected', String(active));
  }
  _show(els.evalRetrievalPanel, nextTab === 'retrieval');
  _show(els.evalGenerationPanel, nextTab === 'generation');
  if (_historyRunsCache && _historyRunsCache.length && els.ragHistoryMount) {
    _renderHistoryTable(els, _historyRunsCache);
  }
  try { localStorage.setItem(EVAL_TAB_CACHE_KEY, nextTab); } catch (_) {}
}
function _readCachedTab() {
  try {
    const tab = localStorage.getItem(EVAL_TAB_CACHE_KEY);
    return tab === 'generation' ? 'generation' : 'retrieval';
  } catch (_) {
    return 'retrieval';
  }
}
