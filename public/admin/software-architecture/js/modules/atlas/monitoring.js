/**
 * Atlas AI Monitoring
 *
 * S — all monitoring display concerns here; no nav dependency.
 * D — renderKpiCards / renderDataTable from shared primitives.
 */

import { authedJson, setSectionStatus } from '../../http.js';
import { escapeHtml }                   from '../../utils.js';
import { renderKpiCards }               from '../../../../../assets/ui/kpi-cards.js';
import { renderDataTable }              from '../../../../../assets/ui/datatable.js';

// ── Column definitions ────────────────────────────────────────────────────────
const DEPS_COLS = [
  { header: 'Service',      renderHtml: function (d) { return '<strong>' + escapeHtml(d.label) + '</strong>'; } },
  { header: 'Endpoint',     renderHtml: function (d) { return '<span class="sd-obs-monospace">' + escapeHtml(d.endpoint || '—') + '</span>'; } },
  { header: 'Status',       renderHtml: function (d) { return '<span class="sd-mon-dep-badge sd-mon-dep-badge--' + _statusClass(d.status) + '">' + escapeHtml(d.status) + '</span>'; } },
  { header: 'Latency',      renderText: function (d) { return d.latencyMs != null ? (d.latencyMs >= 1000 ? (d.latencyMs / 1000).toFixed(2) + ' s' : d.latencyMs + ' ms') : '—'; }, align: 'right' },
  { header: 'Last Checked', renderText: function (d) { return d.lastChecked ? new Date(d.lastChecked).toLocaleTimeString() : '—'; } },
];

const INCIDENTS_COLS = [
  { header: 'Time',        renderText: function (i) { return i.startedAt ? new Date(i.startedAt).toLocaleString() : '—'; } },
  { header: 'Severity',    renderHtml: function (i) { const s = (i.severity || 'info').toLowerCase(); return '<span class="sd-mon-sev-chip sd-mon-sev-chip--' + s + '">' + escapeHtml(i.severity || 'info') + '</span>'; } },
  { header: 'Service',     renderText: function (i) { return i.service || '—'; } },
  { header: 'Description', renderText: function (i) { return i.description || '—'; } },
  { header: 'Duration',    renderText: function (i) { return i.durationMinutes != null ? i.durationMinutes + ' min' : '—'; }, align: 'right' },
  { header: 'Status',      renderHtml: function (i) { return i.resolved ? '<span class="sd-obs-badge sd-obs-badge--pass">Resolved</span>' : '<span class="sd-obs-badge sd-obs-badge--miss">Active</span>'; } },
];

// ── Entry point ───────────────────────────────────────────────────────────────
export async function renderMonitoringPage(els) {
  setSectionStatus(els.atlasMonitoringStatus, 'Loading…', 'info');
  try {
    const [healthData, usageData] = await Promise.all([
      _safeFetch('/api/admin/system/health'),
      authedJson('/api/atlas/usage'),
    ]);
    setSectionStatus(els.atlasMonitoringStatus, '', '');
    _renderInfrastructure(els, healthData);
    _renderServiceHealth(els, healthData);
    _renderResourceUtilization(els, healthData, usageData);
    _renderAppPerformance(els, healthData, usageData);
    _renderDependencies(els, healthData);
    _renderAlerts(els, healthData);
    _renderHistory(els, healthData, usageData);
  } catch (err) {
    setSectionStatus(els.atlasMonitoringStatus, 'Load failed: ' + err.message, 'error');
  }
}

// ── ① Infrastructure Summary — renderKpiCards ─────────────────────────────────
function _renderInfrastructure(els, data) {
  if (!els.monInfraMount) return;
  const infra = (data && data.infrastructure) || {};
  renderKpiCards(els.monInfraMount, {
    cards: [
      { title: 'Uptime',      icon: 'timer',   value: _formatUptime(infra.uptimeSeconds) },
      { title: 'Node.js',     icon: 'code',    value: infra.nodeVersion  || '—' },
      { title: 'Environment', icon: 'cloud',   value: infra.environment  || '—' },
      { title: 'Heap Used',   icon: 'storage', value: infra.heapUsedMb   != null ? infra.heapUsedMb.toFixed(1)  + ' MB' : '—' },
      { title: 'Heap Total',  icon: 'memory',  value: infra.heapTotalMb  != null ? infra.heapTotalMb.toFixed(1) + ' MB' : '—' },
      { title: 'Platform',    icon: 'apps',    value: infra.platform     || '—' },
    ],
  });
}

// ── ② Service Health (custom card grid — no table primitive fits) ─────────────
function _renderServiceHealth(els, data) {
  if (!els.monServicesGrid) return;
  const services = (data && data.services) || _defaultServices();
  if (els.monServicesEmpty) els.monServicesEmpty.hidden = true;
  els.monServicesGrid.innerHTML = services.map(function (svc) {
    const cls = _statusClass(svc.status);
    return '<div class="sd-mon-service-card sd-mon-service-card--' + cls + '">' +
      '<div class="sd-mon-service-header"><span class="material-symbols-outlined sd-mon-service-icon" aria-hidden="true">' + (svc.icon || 'circle') + '</span><span class="sd-mon-service-name">' + escapeHtml(svc.label) + '</span><span class="sd-mon-service-badge sd-mon-service-badge--' + cls + '">' + escapeHtml(svc.status) + '</span></div>' +
      (svc.detail ? '<p class="sd-mon-service-detail">' + escapeHtml(svc.detail) + '</p>' : '') +
      '</div>';
  }).join('');
}

// ── ③ Resource Utilization (progress bars — no table) ─────────────────────────
function _renderResourceUtilization(els, healthData, usageData) {
  const res    = (healthData && healthData.resources) || {};
  const budget = (usageData  && usageData.budget)     || {};
  _bar(els.monCpuBar, els.monCpuPct, res.cpuPct, function (v) { return v.toFixed(1) + ' %'; });
  _bar(els.monMemBar, els.monMemPct, res.memPct, function (v) { return v.toFixed(1) + ' %'; });
  _bar(els.monHeapBar, els.monHeapPct, res.heapPct, function (v) { return v.toFixed(1) + ' %'; });
  const monthly = Number(budget.budgetCapInr || 0);
  const mSpend  = Number(budget.monthlySpend || 0);
  _bar(els.monBudgetMonthlyBar, els.monBudgetMonthlyLabel, monthly ? (mSpend / monthly) * 100 : null,
    function () { return monthly ? '₹' + mSpend.toFixed(2) + ' / ₹' + monthly.toFixed(2) : 'No cap set'; }, true);
  const daily  = Number(budget.dailyBudgetCapInr || 0);
  const dSpend = Number(budget.dailySpend || 0);
  _bar(els.monBudgetDailyBar, els.monBudgetDailyLabel, daily ? (dSpend / daily) * 100 : null,
    function () { return daily ? '₹' + dSpend.toFixed(2) + ' / ₹' + daily.toFixed(2) : 'No cap set'; }, true);
}

// ── ④ Application Performance — renderKpiCards ────────────────────────────────
function _renderAppPerformance(els, healthData, usageData) {
  if (!els.monPerfMount) return;
  const perf  = (healthData && healthData.performance) || {};
  const usage = (usageData  && usageData.usage)        || {};
  renderKpiCards(els.monPerfMount, {
    cards: [
      { title: 'Total Requests',      icon: 'swap_horiz',     value: perf.totalRequests   != null ? String(perf.totalRequests)              : '—' },
      { title: 'Avg Response Time',   icon: 'schedule',       value: perf.avgResponseMs   != null ? perf.avgResponseMs.toFixed(0) + ' ms'   : '—' },
      { title: 'Req / min',           icon: 'bolt',           value: perf.reqPerMin        != null ? perf.reqPerMin.toFixed(1)               : '—' },
      { title: 'Total Tokens (month)',icon: 'token',          value: Number(usage.totalTokens || 0).toLocaleString() },
      { title: 'Est. Cost (₹, month)',icon: 'currency_rupee', value: '₹' + Number(usage.estimatedCostInr || 0).toFixed(2) },
      { title: 'Error Rate',          icon: 'error_outline',  value: (Number(usage.errorRate || 0) * 100).toFixed(1) + ' %' },
    ],
  });
}

// ── ⑤ External Dependencies — renderDataTable ─────────────────────────────────
function _renderDependencies(els, data) {
  if (!els.monDepsMount) return;
  renderDataTable(els.monDepsMount, {
    columns: DEPS_COLS,
    rows: (data && data.dependencies) || _defaultDeps(),
    emptyText: 'No dependency data.',
  });
}

// ── ⑥ Alerts & Incidents ─────────────────────────────────────────────────────
function _renderAlerts(els, data) {
  const alerts    = (data && data.alerts)    || [];
  const incidents = (data && data.incidents) || [];
  const active    = alerts.filter(function (a) { return a.status === 'active'; });

  if (els.monActiveAlertCount) {
    els.monActiveAlertCount.textContent = active.length + ' active';
    els.monActiveAlertCount.className = 'sd-mon-alert-count-badge ' + (active.length > 0 ? 'sd-mon-alert-count-badge--warn' : 'sd-mon-alert-count-badge--ok');
  }
  if (els.monAckAllBtn) els.monAckAllBtn.hidden = active.length === 0;

  if (els.monAlertsList) {
    els.monAlertsList.innerHTML = active.length
      ? active.map(function (a) {
          const sev = (a.severity || 'info').toLowerCase();
          return '<div class="sd-mon-alert-card sd-mon-alert-card--' + sev + '">' +
            '<div class="sd-mon-alert-header"><span class="material-symbols-outlined" aria-hidden="true">' + _alertIcon(sev) + '</span><strong class="sd-mon-alert-title">' + escapeHtml(a.title || 'Alert') + '</strong><span class="sd-mon-alert-sev">' + escapeHtml(a.severity || 'info') + '</span><span class="sd-mon-alert-time">' + (a.firedAt ? new Date(a.firedAt).toLocaleTimeString() : '') + '</span></div>' +
            (a.description ? '<p class="sd-mon-alert-desc">' + escapeHtml(a.description) + '</p>' : '') +
            '</div>';
        }).join('')
      : '<p class="sd-observability-empty">No active alerts. All systems nominal.</p>';
  }

  if (els.monIncidentsMount)
    renderDataTable(els.monIncidentsMount, { columns: INCIDENTS_COLS, rows: incidents, emptyText: 'No incidents recorded.' });
}

// ── ⑦ Historical Metrics ──────────────────────────────────────────────────────
function _renderHistory(els, healthData, usageData) {
  if (!els.monHistoryGrid) return;
  const history = (healthData && healthData.history) || (usageData && usageData.history) || [];
  if (!history.length) { if (els.monHistoryEmpty) els.monHistoryEmpty.hidden = false; return; }
  if (els.monHistoryEmpty) els.monHistoryEmpty.hidden = true;
  const metrics = [
    { key: 'requests', label: 'Requests', color: 'var(--primary)' },
    { key: 'errors',   label: 'Errors',   color: '#ef4444' },
    { key: 'tokens',   label: 'Tokens',   color: '#f59e0b' },
    { key: 'cost',     label: 'Cost (₹)', color: '#22c55e' },
  ];
  els.monHistoryGrid.innerHTML = metrics.map(function (m) {
    const vals = history.map(function (d) { return Number(d[m.key] || 0); });
    const max  = Math.max(...vals, 1);
    return '<div class="sd-mon-hist-chart"><div class="sd-mon-hist-title">' + m.label + '</div><div class="sd-mon-hist-bars">' +
      history.map(function (d, i) {
        const h   = Math.round((vals[i] / max) * 60);
        const tip = (d.date || '') + ': ' + vals[i].toLocaleString();
        return '<div class="sd-mon-hist-bar-wrap" title="' + escapeHtml(tip) + '"><div class="sd-mon-hist-bar" style="height:' + h + 'px;background:' + m.color + '"></div><span class="sd-mon-hist-label">' + escapeHtml((d.date || '').slice(-5)) + '</span></div>';
      }).join('') +
      '</div></div>';
  }).join('');
}

// ── Fallback data ─────────────────────────────────────────────────────────────
function _defaultServices() {
  return [
    { label: 'Express Server',  status: 'healthy',  icon: 'router',         detail: 'HTTP server running' },
    { label: 'Firestore',       status: 'unknown',  icon: 'database',       detail: 'No GCP credentials locally' },
    { label: 'Primary LLM API', status: 'unknown',  icon: 'smart_toy',      detail: 'Current provider configured via GEMINI_API_KEY' },
    { label: 'Vertex AI',       status: 'unknown',  icon: 'model_training', detail: 'Embedding endpoint' },
    { label: 'Stripe',          status: 'unknown',  icon: 'payments',       detail: 'Subscription billing' },
    { label: 'Cloud Storage',   status: 'unknown',  icon: 'cloud_upload',   detail: 'Media asset storage' },
  ];
}
function _defaultDeps() {
  return [
    { label: 'Primary LLM API', endpoint: 'generativelanguage.googleapis.com', status: 'unknown', latencyMs: null, lastChecked: null },
    { label: 'Firestore',     endpoint: 'firestore.googleapis.com',          status: 'unknown', latencyMs: null, lastChecked: null },
    { label: 'Stripe',        endpoint: 'api.stripe.com',                    status: 'unknown', latencyMs: null, lastChecked: null },
    { label: 'Cloud Storage', endpoint: 'storage.googleapis.com',            status: 'unknown', latencyMs: null, lastChecked: null },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _bar(barEl, labelEl, pctValue, labelFn, useLabelFn) {
  const v = pctValue != null ? Math.min(Math.max(pctValue, 0), 100) : 0;
  if (barEl) {
    barEl.style.width = pctValue != null ? v.toFixed(1) + '%' : '0%';
    barEl.className = barEl.className.replace(/ ?sd-mon-resource-bar--(warn|danger)/g, '');
    if (v >= 90) barEl.classList.add('sd-mon-resource-bar--danger');
    else if (v >= 70) barEl.classList.add('sd-mon-resource-bar--warn');
  }
  if (labelEl) labelEl.textContent = useLabelFn ? labelFn(v) : (pctValue != null ? labelFn(v) : '—');
}

function _formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function _statusClass(status) {
  const s = (status || '').toLowerCase();
  if (['healthy','ok','up','operational'].includes(s)) return 'healthy';
  if (['degraded','warn','warning','slow'].includes(s)) return 'degraded';
  if (['error','down','unreachable','critical'].includes(s)) return 'down';
  return 'unknown';
}
function _alertIcon(sev) { return { critical: 'emergency', error: 'error', warning: 'warning', info: 'info' }[sev] || 'notifications'; }
async function _safeFetch(url) {
  try { const r = await fetch(url, { headers: { 'Accept': 'application/json' } }); return r.ok ? await r.json() : {}; }
  catch (_) { return {}; }
}
