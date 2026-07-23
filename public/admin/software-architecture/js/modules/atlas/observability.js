/**
 * Atlas AI Observability
 *
 * S — all observability display concerns here; no nav dependency.
 * D — renderDataTable from shared primitive for the two log tables.
 */

import { state }            from '../../state.js';
import { authedJson, setSectionStatus } from '../../http.js';
import { escapeHtml } from '../../utils.js';
import { atlasConfig }      from './config.js';
import { renderDataTable }  from '../../../../../assets/ui/datatable.js';

let _allTraces = [];
let _cfg = null;
let _meta = null;
let _langsmithToggleWired = false;

// ── Column definitions ────────────────────────────────────────────────────────
const TRACE_COLS = [
  { header: 'Time',       renderText: function (t) { return t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '—'; } },
  { header: 'Session',    renderHtml: function (t) { return '<span class="sd-obs-monospace">' + escapeHtml(t.sessionId ? t.sessionId.slice(0, 8) + '…' : '—') + '</span>'; } },
  { header: 'Model',      renderText: function (t) { return t.model || '—'; } },
  { header: 'Mode',       renderHtml: function (t) { return t.ragEnabled ? '<span class="sd-obs-mode-chip sd-obs-mode-chip--rag">RAG</span>' : '<span class="sd-obs-mode-chip">Direct</span>'; } },
  { header: 'Tokens In',  renderText: function (t) { return t.tokensIn  != null ? String(t.tokensIn)  : '—'; }, align: 'right' },
  { header: 'Tokens Out', renderText: function (t) { return t.tokensOut != null ? String(t.tokensOut) : '—'; }, align: 'right' },
  { header: 'Chunks',     renderText: function (t) { return t.chunksRetrieved != null ? String(t.chunksRetrieved) : '—'; }, align: 'right' },
  { header: 'Latency',    renderText: function (t) { return t.latencyMs != null ? (t.latencyMs >= 1000 ? (t.latencyMs / 1000).toFixed(2) + ' s' : t.latencyMs + ' ms') : '—'; }, align: 'right' },
  { header: 'Status',     renderHtml: function (t) { return t.status === 'error' ? '<span class="sd-obs-badge sd-obs-badge--miss">Error</span>' : '<span class="sd-obs-badge sd-obs-badge--pass">OK</span>'; } },
];

const FEEDBACK_COLS = [
  { header: 'Time',     renderText: function (r) { return r.timestamp ? new Date(r.timestamp).toLocaleString() : '—'; } },
  { header: 'Question', renderText: function (r) { return r.question || '—'; }, className: 'sd-obs-question' },
  { header: 'Rating',   renderHtml: function (r) {
    return r.rating === 'up'
      ? '<span class="material-symbols-outlined sd-obs-rating-up" aria-label="Positive">thumb_up</span>'
      : '<span class="material-symbols-outlined sd-obs-rating-down" aria-label="Negative">thumb_down</span>';
  }},
  { header: 'Comment',  renderText: function (r) { return r.comment || '—'; } },
];

// ── Entry point ───────────────────────────────────────────────────────────────
export function renderObservabilityPage(els) {
  const cfg = atlasConfig || {};
  _wireLangsmithToggle(els);
  _setBadge(els.obsTracingStatus, cfg.tracingEnabled);
  _setBadge(els.obsPromptsStatus, cfg.capturePrompts);
  _setBadge(els.obsChunksStatus,  cfg.captureChunks);
  _setBadge(els.obsTokensStatus,  cfg.captureTokens !== false);
  if (els.obsLangsmithTracingEnabled) {
    els.obsLangsmithTracingEnabled.checked = !!cfg.langsmithTracingEnabled;
    els.obsLangsmithTracingEnabled.disabled = true;
  }
  if (els.obsLangsmithHint) els.obsLangsmithHint.textContent = '';

  setSectionStatus(els.atlasObservabilityStatus, '', '');
  _show(els.obsTraceDetailWrap,    false);
  _show(els.obsPromptTimelineWrap, false);
  _show(els.obsChunksWrap,         false);

  loadObservabilityData(els);
}

export function loadObservabilityData(els) {
  setSectionStatus(els.atlasObservabilityStatus, 'Loading…', 'info');
  const token   = state.credential || '';
  const headers = token ? { 'Authorization': 'Bearer ' + token } : {};

  Promise.all([
    authedJson('/api/admin/atlas/config'),
    _fetch('/api/admin/atlas/traces?limit=50',    headers),
    _fetch('/api/admin/atlas/analytics',          headers),
    _fetch('/api/admin/atlas/feedback?limit=50',  headers),
  ]).then(function ([configData, tracesData, analyticsData, feedbackData]) {
    setSectionStatus(els.atlasObservabilityStatus, '', '');
    _cfg = (configData && configData.config) ? configData.config : null;
    _meta = (configData && configData.meta) ? configData.meta : null;
    _refreshConfigBadges(els);
    _allTraces = (tracesData.success) ? (tracesData.traces || []) : [];

    _renderSummaryKpis(els, _allTraces, analyticsData);
    _renderTraces(els, _allTraces);
    _renderRouting(els, analyticsData);
    _renderTokenCost(els, analyticsData);
    _renderLatency(els, analyticsData);
    _renderFeedback(els, feedbackData);
  }).catch(function (err) {
    setSectionStatus(els.atlasObservabilityStatus, err.message || 'Load failed.', 'error');
  });
}

function _wireLangsmithToggle(els) {
  if (_langsmithToggleWired) return;
  if (!els || !els.obsLangsmithTracingEnabled) return;
  _langsmithToggleWired = true;

  els.obsLangsmithTracingEnabled.addEventListener('change', async function () {
    const desired = els.obsLangsmithTracingEnabled.checked === true;
    els.obsLangsmithTracingEnabled.disabled = true;
    setSectionStatus(els.atlasObservabilityStatus, 'Saving LangSmith toggle…', 'info');
    try {
      const data = await authedJson('/api/admin/atlas/observability', {
        method: 'PUT',
        body: JSON.stringify({ langsmithTracingEnabled: desired }),
      });
      _cfg = data && data.config ? data.config : _cfg;
      setSectionStatus(els.atlasObservabilityStatus, 'LangSmith tracing updated.', 'success');
      _refreshConfigBadges(els);
    } catch (err) {
      els.obsLangsmithTracingEnabled.checked = !desired;
      setSectionStatus(els.atlasObservabilityStatus, 'Save failed: ' + (err.message || 'Request failed.'), 'error');
    } finally {
      const envReady = !!(_meta && _meta.langsmithReady);
      els.obsLangsmithTracingEnabled.disabled = !envReady;
    }
  });
}

function _refreshConfigBadges(els) {
  const cfg = _cfg || atlasConfig || {};
  const meta = _meta || {};
  _setBadge(els.obsTracingStatus, cfg.tracingEnabled);
  _setBadge(els.obsPromptsStatus, cfg.capturePrompts);
  _setBadge(els.obsChunksStatus,  cfg.captureChunks);
  _setBadge(els.obsTokensStatus,  cfg.captureTokens !== false);
  if (els.obsLangsmithTracingEnabled) {
    els.obsLangsmithTracingEnabled.checked = !!cfg.langsmithTracingEnabled;
    els.obsLangsmithTracingEnabled.disabled = !meta.langsmithReady;
  }
  if (els.obsLangsmithHint) {
    els.obsLangsmithHint.textContent = meta && meta.langsmithReady
      ? ''
      : (meta && meta.langsmithReason ? String(meta.langsmithReason) : 'LangSmith is not configured in this environment.');
  }
}

// ── ① Summary KPIs ────────────────────────────────────────────────────────────
function _renderSummaryKpis(els, traces, analytics) {
  const a = (analytics && analytics.success) ? analytics : {};
  if (els.obsTotalTraces)  els.obsTotalTraces.textContent  = String(traces.length);
  const lats = traces.map(function (t) { return t.latencyMs; }).filter(Boolean);
  if (lats.length && els.obsAvgLatency) {
    const avg = lats.reduce(function (s, v) { return s + v; }, 0) / lats.length;
    els.obsAvgLatency.textContent = avg >= 1000 ? (avg / 1000).toFixed(2) + ' s' : Math.round(avg) + ' ms';
  }
  const errs = traces.filter(function (t) { return t.status === 'error'; }).length;
  if (els.obsErrorRate) els.obsErrorRate.textContent = traces.length ? ((errs / traces.length) * 100).toFixed(1) + ' %' : '0 %';
  if (els.obsCost24h)   els.obsCost24h.textContent   = a.cost24h != null ? '$' + Number(a.cost24h).toFixed(4) : '—';
}

// ── ② Request Traces — renderDataTable + row click ────────────────────────────
function _renderTraces(els, traces) {
  if (!els.obsTracesMount) return;
  renderDataTable(els.obsTracesMount, {
    columns: TRACE_COLS,
    rows: traces,
    emptyText: 'No traces captured yet. Enable Tracing in AI Configuration.',
  });
  // Attach row-click handlers after render
  els.obsTracesMount.querySelectorAll('tbody tr').forEach(function (tr, i) {
    if (!traces[i]) return;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function () {
      els.obsTracesMount.querySelectorAll('tbody tr').forEach(function (r) { r.classList.remove('sd-obs-trace-row--active'); });
      tr.classList.add('sd-obs-trace-row--active');
      _showTraceDetail(els, traces[i]);
    });
  });
}

export function filterTraces(els) {
  const q      = (els.obsTracesSearch  ? els.obsTracesSearch.value  : '').toLowerCase();
  const status = (els.obsTracesFilter  ? els.obsTracesFilter.value  : 'all');
  const filtered = _allTraces.filter(function (t) {
    const matchQ = !q || (t.question || '').toLowerCase().includes(q) || (t.model || '').toLowerCase().includes(q) || (t.sessionId || '').toLowerCase().includes(q);
    const matchS = status === 'all' || (status === 'error' && t.status === 'error') || (status === 'ok' && t.status !== 'error');
    return matchQ && matchS;
  });
  _renderTraces(els, filtered);
}

// ── ③ Trace Details ───────────────────────────────────────────────────────────
function _showTraceDetail(els, trace) {
  if (!trace || !els.obsTraceDetailGrid) return;
  const fields = [
    { label: 'Trace ID',         value: trace.id          || '—' },
    { label: 'Session ID',       value: trace.sessionId   || '—' },
    { label: 'Timestamp',        value: trace.timestamp ? new Date(trace.timestamp).toLocaleString() : '—' },
    { label: 'Model',            value: trace.model       || '—' },
    { label: 'Mode',             value: trace.ragEnabled ? 'RAG' : 'Direct' },
    { label: 'Tokens In',        value: trace.tokensIn    != null ? String(trace.tokensIn)  : '—' },
    { label: 'Tokens Out',       value: trace.tokensOut   != null ? String(trace.tokensOut) : '—' },
    { label: 'Chunks Retrieved', value: trace.chunksRetrieved != null ? String(trace.chunksRetrieved) : '—' },
    { label: 'Latency',          value: trace.latencyMs != null ? (trace.latencyMs >= 1000 ? (trace.latencyMs / 1000).toFixed(2) + ' s' : trace.latencyMs + ' ms') : '—' },
    { label: 'Status',           value: trace.status || '—' },
    { label: 'Est. Cost',        value: trace.estCost != null ? '$' + trace.estCost.toFixed(6) : '—' },
    { label: 'Error',            value: trace.error || '—', wide: true },
  ];
  els.obsTraceDetailGrid.innerHTML = fields
    .filter(function (f) { return f.value !== '—' || f.label === 'Status'; })
    .map(function (f) {
      return '<div class="sd-obs-detail-field' + (f.wide ? ' sd-obs-detail-field--wide' : '') + '">' +
        '<span class="sd-obs-detail-label">' + f.label + '</span>' +
        '<span class="sd-obs-detail-value">' + escapeHtml(String(f.value)) + '</span>' +
        '</div>';
    }).join('');
  _show(els.obsTraceDetailWrap, true);
  _showPromptTimeline(els, trace);
  _showChunks(els, trace);
}

export function closeTraceDetail(els) {
  _show(els.obsTraceDetailWrap,    false);
  _show(els.obsPromptTimelineWrap, false);
  _show(els.obsChunksWrap,         false);
  if (els.obsTracesMount) els.obsTracesMount.querySelectorAll('.sd-obs-trace-row--active').forEach(function (r) { r.classList.remove('sd-obs-trace-row--active'); });
}

// ── ④ Prompt Timeline ─────────────────────────────────────────────────────────
function _showPromptTimeline(els, trace) {
  if (!els.obsPromptTimeline) return;
  const msgs = [];
  if (trace.systemPrompt) msgs.push({ role: 'system', text: trace.systemPrompt });
  if (trace.question)     msgs.push({ role: 'user',   text: trace.question });
  if (trace.answer)       msgs.push({ role: 'model',  text: trace.answer });
  if (!msgs.length) { _show(els.obsPromptTimelineWrap, false); return; }
  const icons  = { system: 'smart_toy', user: 'person', model: 'assistant' };
  const labels = { system: 'System Prompt', user: 'User', model: 'Model' };
  els.obsPromptTimeline.innerHTML = msgs.map(function (m) {
    return '<div class="sd-obs-timeline-msg sd-obs-timeline-msg--' + m.role + '">' +
      '<div class="sd-obs-timeline-role"><span class="material-symbols-outlined" aria-hidden="true">' + (icons[m.role] || 'chat') + '</span>' + (labels[m.role] || m.role) + '</div>' +
      '<pre class="sd-obs-timeline-text">' + escapeHtml(m.text) + '</pre>' +
      '</div>';
  }).join('');
  _show(els.obsPromptTimelineWrap, true);
}

// ── ⑤ Retrieved Chunks ────────────────────────────────────────────────────────
function _showChunks(els, trace) {
  if (!els.obsChunksList) return;
  const chunks = trace.retrievedChunks || [];
  if (!chunks.length) { _show(els.obsChunksWrap, false); return; }
  els.obsChunksList.innerHTML = chunks.map(function (c, i) {
    const score = c.score != null ? (c.score * 100).toFixed(1) + ' %' : '—';
    return '<div class="sd-obs-chunk-card">' +
      '<div class="sd-obs-chunk-header"><span class="sd-obs-chunk-rank">#' + (i + 1) + '</span><span class="sd-obs-chunk-article">' + escapeHtml(c.articleId || '—') + '</span><span class="sd-obs-chunk-score">similarity ' + score + '</span></div>' +
      '<p class="sd-obs-chunk-text">' + escapeHtml((c.text || '').slice(0, 400)) + (c.text && c.text.length > 400 ? '…' : '') + '</p>' +
      '</div>';
  }).join('');
  _show(els.obsChunksWrap, true);
}

// ── ⑥ Model Routing ───────────────────────────────────────────────────────────
function _renderRouting(els, analytics) {
  if (!els.obsRoutingGrid) return;
  const routing = analytics && analytics.routing;
  if (!routing || !Object.keys(routing).length) { if (els.obsRoutingEmpty) els.obsRoutingEmpty.hidden = false; return; }
  if (els.obsRoutingEmpty) els.obsRoutingEmpty.hidden = true;
  const total = Object.values(routing).reduce(function (s, v) { return s + v; }, 0);
  els.obsRoutingGrid.innerHTML = Object.entries(routing).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) {
    const pct = total ? ((entry[1] / total) * 100).toFixed(1) : '0';
    return '<div class="sd-obs-routing-row"><span class="sd-obs-routing-model">' + escapeHtml(entry[0]) + '</span><div class="sd-obs-routing-bar-wrap"><div class="sd-obs-routing-bar" style="width:' + pct + '%"></div></div><span class="sd-obs-routing-count">' + entry[1] + ' req (' + pct + ' %)</span></div>';
  }).join('');
}

// ── ⑦ Token & Cost Analytics ─────────────────────────────────────────────────
function _renderTokenCost(els, analytics) {
  const a = (analytics && analytics.success) ? analytics : {};
  const fmt = function (n) { return n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' K' : String(n); };
  if (els.obsTokenStatsIn)   els.obsTokenStatsIn.textContent   = fmt(a.tokensIn7d);
  if (els.obsTokenStatsOut)  els.obsTokenStatsOut.textContent  = fmt(a.tokensOut7d);
  if (els.obsTokenStatsCost) els.obsTokenStatsCost.textContent = a.cost7d != null ? '$' + Number(a.cost7d).toFixed(4) : '—';
  if (els.obsTokenStatsAvg)  els.obsTokenStatsAvg.textContent  = a.avgTokensPerRequest != null ? fmt(a.avgTokensPerRequest) : '—';
  const bars = a.dailyCosts;
  if (els.obsCostBarList && bars && bars.length) {
    const maxCost = Math.max(...bars.map(function (d) { return d.cost || 0; }));
    els.obsCostBarList.innerHTML = bars.map(function (d) {
      const pct = maxCost > 0 ? ((d.cost / maxCost) * 100).toFixed(1) : '0';
      return '<div class="sd-obs-cost-bar-row"><span class="sd-obs-cost-bar-label">' + escapeHtml(d.date || '') + '</span><div class="sd-obs-cost-bar-track"><div class="sd-obs-cost-bar" style="width:' + pct + '%"></div></div><span class="sd-obs-cost-bar-value">$' + Number(d.cost || 0).toFixed(4) + '</span></div>';
    }).join('');
  }
}

// ── ⑧ Latency Breakdown ───────────────────────────────────────────────────────
function _renderLatency(els, analytics) {
  if (!els.obsLatencyGrid) return;
  const lat = analytics && analytics.latency;
  if (!lat) { if (els.obsLatencyEmpty) els.obsLatencyEmpty.hidden = false; return; }
  if (els.obsLatencyEmpty) els.obsLatencyEmpty.hidden = true;
  const ms = function (v) { return v != null ? (v >= 1000 ? (v / 1000).toFixed(2) + ' s' : v + ' ms') : '—'; };
  els.obsLatencyGrid.innerHTML = [
    { label: 'Embedding', key: 'embedding' }, { label: 'Retrieval', key: 'retrieval' },
    { label: 'LLM Generation', key: 'llm' }, { label: 'Total', key: 'total' },
  ].map(function (s) {
    const d = lat[s.key] || {};
    return '<div class="sd-obs-latency-card"><h4 class="sd-obs-latency-stage">' + s.label + '</h4><div class="sd-obs-latency-stats"><div><span class="sd-obs-latency-label">p50</span><strong>' + ms(d.p50) + '</strong></div><div><span class="sd-obs-latency-label">p95</span><strong>' + ms(d.p95) + '</strong></div><div><span class="sd-obs-latency-label">p99</span><strong>' + ms(d.p99) + '</strong></div></div></div>';
  }).join('');
}

// ── ⑨ User Feedback — renderDataTable ─────────────────────────────────────────
function _renderFeedback(els, feedbackData) {
  const rows = (feedbackData && feedbackData.success) ? (feedbackData.feedback || []) : [];
  const pos = rows.filter(function (r) { return r.rating === 'up'; }).length;
  const neg = rows.filter(function (r) { return r.rating === 'down'; }).length;
  if (els.obsFeedbackPositive)     els.obsFeedbackPositive.textContent     = String(pos);
  if (els.obsFeedbackNegative)     els.obsFeedbackNegative.textContent     = String(neg);
  if (els.obsFeedbackSatisfaction) els.obsFeedbackSatisfaction.textContent = rows.length ? ((pos / rows.length) * 100).toFixed(0) + ' %' : '—';
  if (!els.obsFeedbackMount) return;
  renderDataTable(els.obsFeedbackMount, { columns: FEEDBACK_COLS, rows, emptyText: 'No feedback collected yet.' });
  _show(els.obsFeedbackMount, true);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _setBadge(el, on) {
  if (!el) return;
  el.textContent = on ? 'ON' : 'OFF';
  el.className   = 'sd-obs-capture-badge ' + (on ? 'sd-obs-capture-badge--on' : 'sd-obs-capture-badge--off');
}
function _show(el, show) { if (el) el.hidden = !show; }
function _fetch(url, headers) {
  return fetch(url, { headers }).then(function (r) { return r.json(); }).catch(function () { return {}; });
}
