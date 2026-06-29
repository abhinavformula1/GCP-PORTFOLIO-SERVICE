/**
 * Toggle Cards — reusable “feature toggle list” renderer.
 *
 * Used for the System Design admin: Metadata Configuration.
 */

function safeText(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @typedef {Object} ToggleCardItem
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {string} icon
 * @property {boolean} enabled
 */

/**
 * @typedef {Object} ToggleCardGroup
 * @property {string} title
 * @property {ToggleCardItem[]} items
 */

/**
 * Render groups of toggle cards into a mount.
 *
 * Styling is expected to exist in the consumer (e.g. `.sd-meta-config-*`).
 *
 * @param {HTMLElement} mount
 * @param {{
 *   ariaLabel?: string,
 *   idPrefix?: string,
 *   groups: ToggleCardGroup[],
 *   onToggle?: (item: ToggleCardItem, enabled: boolean, input: HTMLInputElement, card: HTMLElement) => void,
 * }} opts
 */
export function renderToggleCardGroups(mount, opts) {
  const options = opts || {};
  const groups = Array.isArray(options.groups) ? options.groups : [];
  const idPrefix = String(options.idPrefix || 'toggle-');

  const root = document.createElement('div');
  root.className = 'sd-metadata-config-panel';
  if (options.ariaLabel) {
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', String(options.ariaLabel));
  }

  groups.forEach(function (g) {
    const section = document.createElement('div');
    section.className = 'sd-meta-config-group';

    const heading = document.createElement('h3');
    heading.className = 'sd-meta-config-group-title';
    heading.textContent = String(g && g.title || '');
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'sd-meta-config-grid';

    const items = Array.isArray(g && g.items) ? g.items : [];
    items.forEach(function (item) {
      const isEnabled = !!(item && item.enabled);
      const card = document.createElement('label');
      card.className = 'sd-meta-config-card' + (isEnabled ? ' sd-meta-config-card--on' : '');
      const inputId = idPrefix + String(item && item.id || '');
      card.htmlFor = inputId;

      card.innerHTML =
        '<div class="sd-meta-config-card-left">' +
          '<div class="sd-meta-config-icon"><span class="material-symbols-outlined" aria-hidden="true">' + safeText(item && item.icon || 'toggle_on') + '</span></div>' +
          '<div class="sd-meta-config-info"><strong>' + safeText(item && item.label || '') + '</strong><span>' + safeText(item && item.hint || '') + '</span></div>' +
        '</div>' +
        '<div class="sd-meta-config-toggle">' +
          '<input type="checkbox" id="' + safeText(inputId) + '" data-comp-id="' + safeText(item && item.id || '') + '"' + (isEnabled ? ' checked' : '') + '>' +
          '<span class="sd-meta-toggle-track"><span class="sd-meta-toggle-thumb"></span></span>' +
        '</div>';

      const input = /** @type {HTMLInputElement|null} */ (card.querySelector('input[type="checkbox"]'));
      if (input) {
        input.addEventListener('change', function (e) {
          const checked = !!(e && e.target && e.target.checked);
          card.classList.toggle('sd-meta-config-card--on', checked);
          try {
            if (typeof options.onToggle === 'function') options.onToggle(item, checked, input, card);
          } catch (_) {}
        });
      }

      grid.appendChild(card);
    });

    section.appendChild(grid);
    root.appendChild(section);
  });

  mount.replaceChildren(root);
  return root;
}

