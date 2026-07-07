/**
 * Tier Settings — free / premium feature-flag management.
 * S — all tier logic lives here.
 *
 * Builds the entire panel DOM dynamically inside els.tierSettingsPanel so no
 * extra static HTML is needed beyond the single mount-point div that already
 * exists in index.html.
 */

import { authedJson, setSectionStatus, makeIcon } from '../http.js';

let _tierConfig = null;

export async function renderTierSettings(els) {
  await _loadTierConfig();
  _buildPanel(els);
}

export async function saveTierSettings(els) {
  const free    = _collectTierItems(els.tierSettingsPanel, 'free');
  const premium = _collectTierItems(els.tierSettingsPanel, 'premium');
  setSectionStatus(els.tierSettingsStatus, 'Saving tier settings…', 'info');
  try {
    await authedJson('/api/admin/system-design/tier-config', {
      method: 'PUT',
      body:   JSON.stringify({ free: { items: free }, premium: { items: premium } }),
    });
    setSectionStatus(els.tierSettingsStatus, 'Tier settings saved.', 'success');
  } catch (err) {
    setSectionStatus(els.tierSettingsStatus, err.message || 'Save failed.', 'error');
    throw err;
  }
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

function _buildPanel(els) {
  const panel = els.tierSettingsPanel;
  if (!panel) return;
  panel.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'sd-tier-settings-grid';

  [
    { key: 'free',    title: 'Free Tier',    icon: 'lock',     sub: 'Visible to all visitors.' },
    { key: 'premium', title: 'Premium Tier', icon: 'verified', sub: 'Unlocked by subscribers.' },
  ].forEach(function (t) {
    const items = (_tierConfig && _tierConfig[t.key] && _tierConfig[t.key].items) || [];
    grid.appendChild(_buildTierCard(t.key, t.title, t.icon, t.sub, items));
  });

  panel.appendChild(grid);
}

function _buildTierCard(tierKey, title, iconName, subtitle, items) {
  const card = document.createElement('div');
  card.className = 'sd-tier-settings-card';
  card.dataset.tierCard = tierKey;

  const head = document.createElement('div');
  head.className = 'sd-tier-settings-card-head';
  const iconEl = makeIcon(iconName);
  const titleWrap = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = title;
  const p = document.createElement('p');
  p.textContent = subtitle;
  titleWrap.append(h3, p);
  head.append(iconEl, titleWrap);

  const editor = document.createElement('div');
  editor.className = 'sd-tier-items-editor';
  editor.dataset.tierList = tierKey;
  items.forEach(function (item) {
    editor.appendChild(_buildTierItemRow(item.label || ''));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'sd-tier-add-btn';
  addBtn.appendChild(makeIcon('add'));
  addBtn.appendChild(document.createTextNode(' Add item'));
  addBtn.addEventListener('click', function () {
    const row = _buildTierItemRow('');
    editor.appendChild(row);
    row.querySelector('input').focus();
  });

  card.append(head, editor, addBtn);
  return card;
}

function _buildTierItemRow(label) {
  const row = document.createElement('div');
  row.className = 'sd-tier-item-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sd-tier-item-label';
  input.value = label;
  input.placeholder = 'Feature label…';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'sd-tier-remove-btn';
  del.setAttribute('aria-label', 'Remove item');
  del.appendChild(makeIcon('close'));
  del.addEventListener('click', function () { row.remove(); });

  row.append(input, del);
  return row;
}

function _collectTierItems(panel, tierKey) {
  if (!panel) return [];
  const editor = panel.querySelector('[data-tier-list="' + tierKey + '"]');
  if (!editor) return [];
  return Array.from(editor.querySelectorAll('.sd-tier-item-label'))
    .map(function (inp) { return { label: inp.value.trim() }; })
    .filter(function (item) { return item.label; });
}
