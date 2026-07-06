/**
 * Tier Settings — free / premium feature-flag management.
 * S — all tier logic lives here.
 */

import { authedJson, setSectionStatus, makeIcon } from '../http.js';

let _tierConfig = null;

export async function renderTierSettings(els) {
  await _loadTierConfig();
  _buildTierList(els, 'free');
  _buildTierList(els, 'premium');
}

export async function saveTierSettings(els) {
  const free    = _collectTierItems(els.freeTierList);
  const premium = _collectTierItems(els.premiumTierList);
  setSectionStatus(els.tierStatus, 'Saving tier settings…', 'info');
  await authedJson('/api/admin/system-design/tier-config', {
    method: 'PUT',
    body:   JSON.stringify({ config: { free: { items: free }, premium: { items: premium } } }),
  });
  setSectionStatus(els.tierStatus, 'Tier settings saved.', 'success');
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _loadTierConfig() {
  try {
    const data = await authedJson('/api/system-design/tier-config');
    _tierConfig = data.config || { free: { items: [] }, premium: { items: [] } };
  } catch (_) {
    _tierConfig = { free: { items: [] }, premium: { items: [] } };
  }
}

function _buildTierList(els, tier) {
  const listEl = tier === 'free' ? els.freeTierList : els.premiumTierList;
  if (!listEl) return;
  const items = (_tierConfig && _tierConfig[tier] && _tierConfig[tier].items) || [];
  listEl.innerHTML = '';
  items.forEach(function (item) {
    listEl.appendChild(_buildTierItem(item));
  });
}

function _buildTierItem(item) {
  const row = document.createElement('div');
  row.className = 'sd-tier-item';
  const label = document.createElement('span');
  label.textContent = item.label || item.id || '';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sd-tier-item-del';
  del.appendChild(makeIcon('close'));
  del.addEventListener('click', function () { row.remove(); });
  row.append(label, del);
  return row;
}

function _collectTierItems(listEl) {
  if (!listEl) return [];
  return Array.from(listEl.querySelectorAll('.sd-tier-item')).map(function (row) {
    return { label: row.querySelector('span')?.textContent || '' };
  });
}
