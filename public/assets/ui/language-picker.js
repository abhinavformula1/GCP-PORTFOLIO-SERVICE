/**
 * Compact language picker: globe icon in header + full-screen-ish dialog.
 *
 * Goal: reduce header width and make future language additions trivial.
 */
import { createEl, materialIcon } from './dom.js';
import { SUPPORTED_LANGUAGES } from '../core/i18n.js';

function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

export function renderLanguagePicker(ids) {
  const btn = createEl('md-outlined-icon-button', {
    id: ids.btn,
    className: 'lang-picker-btn',
    'aria-label': 'Language',
    title: 'Language',
  }, [materialIcon('language')]);

  const grid = createEl('div', { className: 'lang-picker-grid' }, SUPPORTED_LANGUAGES.map(function (l) {
    return createEl('button', {
      type: 'button',
      className: 'lang-picker-option',
      'data-lang': l.code,
      'aria-label': l.label,
    }, [createEl('span', { text: l.label })]);
  }));

  const dialog = createEl('md-dialog', {
    id: ids.dialog,
    className: 'lang-picker-dialog',
    'aria-label': 'Choose language',
  }, [
    createEl('div', { slot: 'headline', className: 'lang-picker-title', text: 'Choose language' }),
    createEl('div', { slot: 'content' }, [grid]),
    createEl('div', { slot: 'actions' }, [
      createEl('md-text-button', { className: 'lang-picker-close', 'aria-label': 'Close' }, [
        createEl('span', { text: 'Close' }),
      ]),
    ]),
  ]);

  // Open dialog on click.
  btn.addEventListener('click', function () {
    whenMdDialogReady(function () {
      if (typeof dialog.show === 'function') dialog.show();
      else dialog.removeAttribute('hidden');
    });
  });

  // Close action.
  const closeBtn = dialog.querySelector('.lang-picker-close');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.setAttribute('hidden', '');
  });

  // Delegate option picks.
  grid.addEventListener('click', function (e) {
    const t = e && e.target;
    const opt = t && t.closest ? t.closest('.lang-picker-option') : null;
    if (!opt) return;
    const lang = opt.getAttribute('data-lang') || 'en';
    if (typeof window.setLang === 'function') window.setLang(lang);
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.setAttribute('hidden', '');
  });

  return createEl('div', { className: 'lang-picker' }, [btn, dialog]);
}

export function updateLanguagePicker(lang, ids) {
  const dialog = document.getElementById(ids.dialog);
  const btn = document.getElementById(ids.btn);
  if (btn) {
    const match = (SUPPORTED_LANGUAGES || []).find(function (l) { return l.code === lang; });
    btn.title = match ? match.label : 'Language';
  }
  if (!dialog) return;
  dialog.querySelectorAll('.lang-picker-option').forEach(function (el) {
    const code = el.getAttribute('data-lang');
    const selected = code === lang;
    el.toggleAttribute('data-selected', selected);
    el.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

