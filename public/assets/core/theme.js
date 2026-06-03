/**
 * Light / dark theme toggle.
 *
 * - Honours OS preference on first visit (`prefers-color-scheme`), then
 *   pins the user's explicit choice in localStorage so subsequent visits
 *   skip the OS query.
 * - Theme is driven by a `data-theme="light"|"dark"` attribute on <html>.
 *   The CSS swaps M3 color tokens off that attribute, which cascade to
 *   every brand alias automatically.
 * - The pre-paint boot script in index.html sets the attribute *before*
 *   the page renders to avoid a dark→light flash. This module re-syncs
 *   on script load and wires the toggle button.
 *
 * Public API: `initTheme()`. Call once on boot from main.js. No state is
 * exposed — it lives in localStorage, which is the source of truth.
 */

var THEME_KEY = 'portfolio_theme';

function applyTheme(theme) {
  var root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

function currentTheme() {
  var stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function initTheme() {
  // Re-sync attribute (defensive — pre-paint script already did this,
  // but we may have been loaded after a different code path mutated it).
  applyTheme(currentTheme());

  customElements.whenDefined('md-outlined-icon-button').then(function () {
    var btn = document.getElementById('themeToggleBtn');
    if (!btn) return;
    var isLight = currentTheme() === 'light';
    btn.selected = isLight;
    btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    btn.addEventListener('change', function () {
      var nextTheme = btn.selected ? 'light' : 'dark';
      applyTheme(nextTheme);
      localStorage.setItem(THEME_KEY, nextTheme);
      btn.setAttribute(
        'aria-label',
        btn.selected ? 'Switch to dark mode' : 'Switch to light mode'
      );
    });
  });
}
