/**
 * Analytics module — load and render the analytics dashboard.
 * S — all analytics rendering concerns live here.
 */

import { state }                from '../state.js';
import { authedJson, setSectionStatus } from '../http.js';
import { safeText }             from '../utils.js';
import { renderKpiCards }       from '../../../../assets/ui/kpi-cards.js';

export async function renderAnalytics(els) {
  if (!els.analyticsPanel) return;
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
  setSectionStatus(els.analyticsStatus, 'Loading analytics…', 'info');
  els.analyticsPanel.textContent = '';
  try {
    const month = (els.analyticsMonth && els.analyticsMonth.value) || '';
    const url = '/api/admin/analytics/overview' + (month ? '?month=' + encodeURIComponent(month) : '');
    const data = await authedJson(url);
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
  const recentVisitorChips = _buildRecentVisitorChips(analytics.recentUsers || []);

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
    if (recentVisitorChips) {
      const note = document.createElement('div');
      note.className = 'sd-analytics-kpi-note';
      note.innerHTML = 'Recent visitors · ' + recentVisitorChips;
      mount.appendChild(note);
    }
  } catch (_) {}
}

function _buildRecentVisitorChips(visitors) {
  if (!Array.isArray(visitors) || !visitors.length) return '';
  return visitors.slice(0, 8).map(function (v) {
    return '<span class="sd-visitor-chip">' + safeText(v.label || v.country || '?') + '</span>';
  }).join('');
}
