/**
 * DOM utility helpers shared across all UI components.
 *
 * Kept separate so any component can import just these helpers without
 * pulling in topbar, footer, or Atlas shell code.
 */

export function createEl(tag, attrs, children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(function ([key, value]) {
    if (value === false || value === null || value === undefined) return;
    if (key === 'className') {
      el.className = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'hidden' && value) {
      el.hidden = true;
    } else if (key === 'id') {
      el.id = value;
    } else if (key === 'slot') {
      el.slot = value;
    } else if (key === 'value') {
      el.value = value;
    } else if (key === 'title') {
      el.title = value;
    } else if (key === 'href') {
      el.href = value;
    } else if (key === 'target') {
      el.target = value;
    } else if (key === 'rel') {
      el.rel = value;
    } else if (key === 'src') {
      el.src = value;
    } else if (key === 'alt') {
      el.alt = value;
    } else if (key === 'width') {
      el.width = value;
    } else if (key === 'height') {
      el.height = value;
    } else if (key === 'label') {
      el.label = value;
    } else if (key === 'selected' && value) {
      el.selected = true;
    } else if (key === 'toggle' && value) {
      el.toggle = true;
    } else if (key === 'aria-hidden') {
      el.ariaHidden = value;
    } else if (key === 'aria-label') {
      el.ariaLabel = value;
    } else if (key === 'aria-modal') {
      el.ariaModal = value;
    } else if (key === 'role') {
      el.role = value;
    } else if (key === 'data-i18n') {
      el.dataset.i18n = value;
    }
  });
  (children || []).forEach(function (child) {
    if (child) el.appendChild(child);
  });
  return el;
}

export function materialIcon(name, attrs) {
  return createEl('span', {
    ...(attrs || {}),
    className: 'material-symbols-outlined',
    'aria-hidden': 'true',
    text: name,
  });
}

export function injectShadowStyle(host, css) {
  if (!host || !host.shadowRoot) return;
  const sr = host.shadowRoot;
  try {
    if (typeof CSSStyleSheet === 'function' && Array.isArray(sr.adoptedStyleSheets)) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sr.adoptedStyleSheets = sr.adoptedStyleSheets.concat(sheet);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      sr.appendChild(style);
    }
  } catch (_) {}
}

export function syncTopbarControlHeights(root) {
  customElements.whenDefined('md-outlined-select').then(function () {
    root.querySelectorAll('.lang-select').forEach(function (langSelect) {
      injectShadowStyle(
        langSelect,
        'md-outlined-field { min-height: 40px !important; height: 40px !important; }'
      );
    });
  });
}
