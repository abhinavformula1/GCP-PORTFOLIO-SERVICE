/**
 * Language picker: globe icon header + pill buttons.
 * Clicking a pill instantly applies the language and closes the modal.
 */
import { createEl, materialIcon } from './dom.js';
import { createModal } from './modal.js';
import { SUPPORTED_LANGUAGES, currentLang } from '../core/i18n.js';

// ── Public API ────────────────────────────────────────────────────────────────

export function renderLanguagePicker(ids) {
  // ── Trigger button ──────────────────────────────────────────────────────
  const triggerBtn = createEl('md-outlined-icon-button', {
    id: ids.btn,
    className: 'lang-picker-btn',
    'aria-label': 'Language',
    title: 'Language',
  }, [materialIcon('language')]);

  // ── Pill grid (built lazily so currentLang is always fresh) ────────────
  const grid = createEl('div', { className: 'lang-picker-grid' });

  function buildPills(activeLang) {
    grid.innerHTML = '';
    SUPPORTED_LANGUAGES.forEach(function (l) {
      const isActive = l.code === (activeLang || currentLang || 'en');
      const pill = createEl('button', {
        type: 'button',
        className: 'lang-picker-pill' + (isActive ? ' lang-picker-pill--active' : ''),
        'data-lang': l.code,
        'aria-pressed': isActive ? 'true' : 'false',
      }, [
        createEl('span', { className: 'lang-picker-pill-label', text: l.label }),
      ]);

      pill.addEventListener('click', function () {
        if (typeof window.setLang === 'function') window.setLang(l.code);
        modal.close();
      });

      grid.appendChild(pill);
    });
  }

  // ── Modal ───────────────────────────────────────────────────────────────
  const modal = createModal({
    id:        ids.dialog,
    className: 'lang-picker-dialog',
    icon:      'language',
    title:     'Choose language',
    subtitle:  'Select your preferred language.',
    content:   grid,
    showClose: true,
  });

  // Refresh active pill every time the modal opens.
  modal.el.addEventListener('open', function () { buildPills(currentLang); });
  buildPills(currentLang);

  triggerBtn.addEventListener('click', function () {
    buildPills(currentLang);
    modal.open();
  });

  return createEl('div', { className: 'lang-picker' }, [triggerBtn, modal.el]);
}

export function updateLanguagePicker(lang, ids) {
  const btn = document.getElementById(ids.btn);
  if (btn) {
    const match = (SUPPORTED_LANGUAGES || []).find(function (l) { return l.code === lang; });
    btn.title = match ? match.label : 'Language';
  }

  const dialog = document.getElementById(ids.dialog);
  if (!dialog) return;
  dialog.querySelectorAll('.lang-picker-pill').forEach(function (pill) {
    const active = pill.dataset.lang === lang;
    pill.classList.toggle('lang-picker-pill--active', active);
    pill.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
