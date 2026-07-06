/**
 * Sponsorships — CRUD for ad/sponsor placements.
 * S — all sponsor concerns live here.
 */

import { authedJson, setSectionStatus } from '../http.js';
import { escapeHtml } from '../utils.js';

const PLACEMENT_LABELS = {
  'article-footer': 'Article Footer',
  'homepage':       'Homepage — Right Column',
  'homepage-left':  'Homepage — Left Column',
  'sticky-corner':  'Sticky Corner (above chat agent)',
  'sidebar':        'System Design Sidebar',
};

let _sponsors         = [];
let _editingSponsorId = null;

export async function renderSponsorships(els) {
  const panel = els.sponsorshipsPanel;
  panel.innerHTML = '<p class="sd-article-settings-loading">Loading sponsors…</p>';
  closeSponsorDrawer(els);
  try {
    const data = await authedJson('/api/admin/sponsorships');
    _sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
  } catch (_) {
    _sponsors = [];
  }
  panel.innerHTML = '';
  if (!_sponsors.length) {
    panel.innerHTML = '<p class="sd-article-settings-loading">No sponsors yet. Click "New sponsor" to add one.</p>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'sd-sponsor-grid';
  _sponsors.forEach(function (s) {
    const card = document.createElement('div');
    card.className = 'sd-sponsor-card' + (s.active ? ' sd-sponsor-card--active' : '');
    card.innerHTML =
      '<div class="sd-sponsor-card-top">' +
        (s.logoUrl ? '<img src="' + s.logoUrl + '" alt="' + s.company + '" class="sd-sponsor-logo">' : '<div class="sd-sponsor-logo-placeholder"><span class="material-symbols-outlined">business</span></div>') +
        '<div class="sd-sponsor-badge ' + (s.active ? 'sd-sponsor-badge--active' : 'sd-sponsor-badge--inactive') + '">' + (s.active ? 'Active' : 'Inactive') + '</div>' +
      '</div>' +
      '<div class="sd-sponsor-card-body">' +
        '<strong>' + escapeHtml(s.company) + '</strong>' +
        '<span>' + escapeHtml(s.headline) + '</span>' +
        '<div class="sd-sponsor-meta">' +
          '<span class="material-symbols-outlined">location_on</span>' +
          (PLACEMENT_LABELS[s.placement] || s.placement) +
          (s.expiresAt ? ' · Expires ' + new Date(s.expiresAt).toLocaleDateString() : '') +
        '</div>' +
      '</div>' +
      '<button type="button" class="sd-sponsor-edit-btn" aria-label="Edit sponsor">Edit</button>';
    card.querySelector('.sd-sponsor-edit-btn').addEventListener('click', function () {
      openSponsorDrawer(els, s);
    });
    grid.appendChild(card);
  });
  panel.appendChild(grid);
}

export function openSponsorDrawer(els, sponsor) {
  _editingSponsorId = sponsor ? sponsor.id : null;
  els.sponsorDrawerTitle.textContent = sponsor ? 'Edit Sponsor' : 'New Sponsor';
  els.sponsorDrawer.hidden = false;
  els.deleteSponsorBtn.hidden = !sponsor;
  setSectionStatus(els.sponsorDrawerStatus, '', 'info');
  _fieldVal('sponsorCompany',     sponsor && sponsor.company);
  _fieldVal('sponsorHeadline',    sponsor && sponsor.headline);
  _fieldVal('sponsorCta',         sponsor ? sponsor.cta : 'Learn More');
  _fieldVal('sponsorCtaUrl',      sponsor && sponsor.ctaUrl);
  _fieldVal('sponsorLogoUrl',     sponsor && sponsor.logoUrl);
  _fieldVal('sponsorPlacement',   sponsor ? sponsor.placement : 'article-footer');
  _fieldVal('sponsorAdsenseSlot', sponsor && sponsor.adsenseSlot);
  _fieldChecked('sponsorActive',  sponsor ? sponsor.active : true);
  _fieldVal('sponsorStartsAt',    sponsor && sponsor.startsAt  ? new Date(sponsor.startsAt).toISOString().split('T')[0]  : '');
  _fieldVal('sponsorExpiresAt',   sponsor && sponsor.expiresAt ? new Date(sponsor.expiresAt).toISOString().split('T')[0] : '');
}

export function closeSponsorDrawer(els) {
  els.sponsorDrawer.hidden = true;
  _editingSponsorId = null;
}

export async function saveSponsor(els) {
  if (els.saveSponsorBtn.disabled) return;
  els.saveSponsorBtn.disabled = true;
  setSectionStatus(els.sponsorDrawerStatus, 'Saving…', 'info');
  try {
    const payload = {
      company:     _fieldGet('sponsorCompany'),
      headline:    _fieldGet('sponsorHeadline'),
      cta:         _fieldGet('sponsorCta') || 'Learn More',
      ctaUrl:      _fieldGet('sponsorCtaUrl'),
      logoUrl:     _fieldGet('sponsorLogoUrl'),
      placement:   _fieldGet('sponsorPlacement'),
      adsenseSlot: _fieldGet('sponsorAdsenseSlot'),
      active:      _fieldIsChecked('sponsorActive'),
      startsAt:    _fieldGet('sponsorStartsAt')  || null,
      expiresAt:   _fieldGet('sponsorExpiresAt') || null,
    };
    const url    = _editingSponsorId ? '/api/admin/sponsorships/' + _editingSponsorId : '/api/admin/sponsorships';
    const method = _editingSponsorId ? 'PUT' : 'POST';
    await authedJson(url, { method, body: JSON.stringify(payload) });
    setSectionStatus(els.sponsorDrawerStatus, 'Saved!', 'success');
    setTimeout(function () { closeSponsorDrawer(els); renderSponsorships(els); }, 800);
  } finally {
    els.saveSponsorBtn.disabled = false;
  }
}

export async function deleteSponsor(els) {
  if (!_editingSponsorId) return;
  if (!confirm('Delete this sponsor? This cannot be undone.')) return;
  await authedJson('/api/admin/sponsorships/' + _editingSponsorId, { method: 'DELETE' });
  closeSponsorDrawer(els);
  renderSponsorships(els);
}

// ── Internal ──────────────────────────────────────────────────────────────────
function _fieldVal(id, value)     { const el = document.getElementById(id); if (el) el.value   = value || ''; }
function _fieldChecked(id, value) { const el = document.getElementById(id); if (el) el.checked = !!value; }
function _fieldGet(id)            { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function _fieldIsChecked(id)      { const el = document.getElementById(id); return el ? el.checked : false; }
