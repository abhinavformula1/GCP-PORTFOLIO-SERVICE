/**
 * Analytics module — load and render the analytics dashboard.
 * S — all analytics rendering concerns live here.
 */

import { state }                from '../state.js';
import { authedJson, setSectionStatus } from '../http.js';
import { safeText }             from '../utils.js';
import { renderKpiCards }       from '../../../../assets/ui/kpi-cards.js';
import { renderDataTable }      from '../../../../assets/ui/datatable.js';

export async function renderAnalytics(els) {
  if (!els.analyticsPanel) return;
  _ensureCurrentMonthSelected(els);
  if (state.analyticsState) {
    _paintAnalytics(els);
    return;
  }
  await _refreshAnalytics(els);
}

export async function refreshAnalytics(els) {
  state.analyticsState = null;
  await _refreshAnalytics(els);
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _refreshAnalytics(els) {
  if (!els.analyticsPanel) return;
  _ensureCurrentMonthSelected(els);
  setSectionStatus(els.analyticsStatus, 'Loading analytics…', 'info');
  els.analyticsPanel.textContent = '';
  try {
    const month = (els.analyticsMonth && els.analyticsMonth.value) || '';
    const url = '/api/admin/analytics/overview' + (month ? '?month=' + encodeURIComponent(month) : '');
    const data = await authedJson(url);
    if (els.analyticsMonth && data && data.month) els.analyticsMonth.value = data.month;
    state.analyticsState = data;
    _paintAnalytics(els);
    setSectionStatus(els.analyticsStatus, '', '');
  } catch (err) {
    setSectionStatus(els.analyticsStatus, err.message || 'Failed to load analytics.', 'error');
  }
}

function _paintAnalytics(els) {
  if (!els.analyticsPanel) return;
  els.analyticsPanel.textContent = '';
  const analytics = state.analyticsState || {};
  const totals    = analytics.totals || {};

  try {
    const mount = document.createElement('div');
    mount.id = 'analyticsKpiMount';
    els.analyticsPanel.appendChild(mount);
    renderKpiCards(mount, {
      ariaLabel: 'Analytics KPIs',
      cards: [
        { title: 'Monthly Unique Visitors', value: Number(totals.uniqueVisitors || 0).toLocaleString(), icon: 'person', iconVariant: 'users', trend: 'vs last 30 days' },
        { title: 'Monthly Page Views',      value: Number(totals.pageViews || 0).toLocaleString(),       icon: 'bar_chart', iconVariant: 'mrr', trend: 'vs last 30 days' },
        { title: 'Monthly PDF Downloads',   value: Number((analytics.state && analytics.state.totals && analytics.state.totals.pdfDownloads) || totals.pdfDownloads || 0).toLocaleString(), icon: 'picture_as_pdf', iconVariant: 'arr', trend: 'vs last 30 days' },
      ],
    });
  } catch (_) {}

  _renderAnalyticsSection(els.analyticsPanel, {
    title: 'Recent visitors',
    subtitle: 'Latest signed-in and anonymous visitors seen for the selected month.',
    columns: [
      { key: 'label', header: 'Visitor', renderText: function (row) { return row.label || row.name || 'Anonymous visitor'; } },
      { key: 'kind', header: 'Type', renderText: function (row) { return row.kind === 'signed' ? 'Signed in' : 'Anonymous'; } },
      { key: 'location', header: 'Location', renderText: function (row) { return _formatVisitorLocation(row); } },
      { key: 'device', header: 'Device', renderText: function (row) { return row.device || '—'; } },
      { key: 'lastSeenAt', header: 'Last seen', renderText: function (row) { return _formatLastSeen(row.lastSeenAt); } },
    ],
    rows: analytics.recentUsers || [],
    emptyText: 'No visitor activity recorded for this month yet.',
  });

  _renderAnalyticsSection(els.analyticsPanel, {
    title: 'Top pages',
    subtitle: 'Most visited pages for the selected month.',
    columns: [
      { key: 'path', header: 'Path', renderText: function (row) { return row.path || '—'; } },
      { key: 'pageViews', header: 'Page views', align: 'right', renderText: function (row) { return Number(row.pageViews || 0).toLocaleString(); } },
    ],
    rows: analytics.topPages || [],
    emptyText: 'No page view data recorded for this month yet.',
  });
}

function _ensureCurrentMonthSelected(els) {
  if (!els || !els.analyticsMonth || els.analyticsMonth.value) return;
  const now = new Date();
  const month = now.getMonth() + 1;
  els.analyticsMonth.value = String(now.getFullYear()) + '-' + String(month).padStart(2, '0');
}

function _renderAnalyticsSection(panel, config) {
  if (!panel || !config) return;
  const section = document.createElement('section');
  section.className = 'sd-analytics-section';

  const head = document.createElement('div');
  head.className = 'sd-analytics-section-head';
  head.innerHTML = ''
    + '<h3>' + safeText(config.title || '') + '</h3>'
    + '<p>' + safeText(config.subtitle || '') + '</p>';

  const mount = document.createElement('div');
  section.appendChild(head);
  section.appendChild(mount);
  panel.appendChild(section);

  renderDataTable(mount, {
    ariaLabel: config.title || 'Analytics table',
    columns: config.columns || [],
    rows: config.rows || [],
    emptyText: config.emptyText || 'No rows.',
    responsive: true,
  });
}

function _formatVisitorLocation(row) {
  const parts = [row && row.geoCity, row && row.geoRegion, row && row.geoCountry]
    .map(function (v) { return String(v || '').trim(); })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function _formatLastSeen(ts) {
  const millis = Number(ts || 0);
  if (!millis) return '—';
  try { return new Date(millis).toLocaleString(); } catch (_) { return '—'; }
}
