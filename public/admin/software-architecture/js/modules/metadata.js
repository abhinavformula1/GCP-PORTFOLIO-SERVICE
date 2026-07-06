/**
 * Metadata Configuration — component registry toggles.
 * S — controls which block types are enabled per article.
 */

import { authedJson, setSectionStatus } from '../http.js';
import { COMPONENT_REGISTRY } from '../../../../assets/ui/component-registry.js';
import { renderToggleCardGroups } from '../../../../assets/ui/toggle-cards.js';

let _metaEnabledMap = null;

/** Called by loadArticles during initial boot to seed the map. */
export function setMetaEnabledMap(enabled) {
  _metaEnabledMap = enabled || {};
}

export function getMetaEnabledMap() {
  return _metaEnabledMap || {};
}

export async function renderMetadataConfig(els) {
  const panel = els.metadataConfigPanel;
  panel.innerHTML = '<p class="sd-article-settings-loading">Loading configuration…</p>';
  try {
    const data = await authedJson('/api/system-design/component-registry');
    _metaEnabledMap = data.enabled || {};
  } catch (_) {
    _metaEnabledMap = {};
  }

  const byGroup = {};
  COMPONENT_REGISTRY.forEach(function (comp) {
    if (!byGroup[comp.group]) byGroup[comp.group] = [];
    byGroup[comp.group].push(comp);
  });

  const groups = Object.entries(byGroup).map(function ([groupName, comps]) {
    return {
      title: groupName,
      items: comps.map(function (comp) {
        return {
          id:      comp.id,
          label:   comp.label,
          hint:    comp.hint,
          icon:    comp.icon,
          enabled: _metaEnabledMap[comp.id] !== false,
        };
      }),
    };
  });

  renderToggleCardGroups(panel, {
    ariaLabel: 'Metadata configuration',
    idPrefix:  'meta-toggle-',
    groups,
    onToggle:  function (item, enabled) {
      if (!_metaEnabledMap) _metaEnabledMap = {};
      _metaEnabledMap[item.id] = enabled;
    },
  });
}

export async function saveMetadataConfig(els) {
  setSectionStatus(els.metadataConfigStatus, 'Saving configuration…', 'info');
  const enabled = {};
  els.metadataConfigPanel.querySelectorAll('input[data-comp-id]').forEach(function (input) {
    enabled[input.dataset.compId] = input.checked;
  });
  await authedJson('/api/admin/system-design/component-registry', {
    method: 'PUT', body: JSON.stringify({ enabled }),
  });
  _metaEnabledMap = enabled;
  setSectionStatus(els.metadataConfigStatus, 'Configuration saved.', 'success');
}
