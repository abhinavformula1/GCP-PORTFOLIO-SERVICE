/**
 * Topbar component.
 *
 * Renders the shared navigation bar (language selector, theme toggle,
 * sign-in button, user avatar + dropdown) into a target element.
 * Also exports imperative helpers to update the signed-in/guest state
 * and toggle/close the user dropdown menu.
 *
 * Used by: portfolio page (main.js) and admin page (admin.js).
 */

import { createEl, materialIcon, syncTopbarControlHeights } from './dom.js';
import { renderLanguagePicker, updateLanguagePicker } from './language-picker.js';

function renderLanguageControl(ids) {
  return renderLanguagePicker({ btn: ids.langBtn, dialog: ids.langDialog });
}

function renderThemeToggle(id) {
  return createEl('md-outlined-icon-button', {
    id,
    className: 'theme-toggle',
    toggle: true,
    'aria-label': 'Switch to light mode',
    title: 'Switch theme',
  }, [
    materialIcon('light_mode'),
    materialIcon('dark_mode', { slot: 'selected' }),
  ]);
}

function renderSignInButton(id, initiallyHidden, i18nKey, onClick) {
  const labelAttrs = i18nKey ? { 'data-i18n': i18nKey } : {};
  const btn = createEl('button', {
    id,
    className: 'topbar-signin-btn',
    'aria-label': 'Sign in',
    hidden: initiallyHidden,
  }, [
    materialIcon('login'),
    createEl('span', { ...labelAttrs, text: 'Sign in' }),
  ]);
  if (typeof onClick === 'function') {
    btn.addEventListener('click', onClick);
  }
  return btn;
}

function renderUserMenu(ids, handlers) {
  const avatarButton = createEl('button', {
    id: ids.avatarBtn,
    className: 'topbar-avatar-btn',
    'aria-label': 'User menu',
  }, [
    createEl('img', {
      id: ids.userPhoto,
      className: 'topbar-user-photo',
      src: '',
      alt: ids.photoAlt || 'Signed-in user profile photo',
    }),
  ]);
  if (typeof handlers?.toggleUserMenu === 'function') {
    avatarButton.addEventListener('click', handlers.toggleUserMenu);
  }

  const signOutAttrs = { className: 'topbar-signout', text: 'Sign out' };
  if (ids.signOutBtn) signOutAttrs.id = ids.signOutBtn;
  const signOutButton = createEl('button', signOutAttrs);
  if (typeof handlers?.signOut === 'function') {
    signOutButton.addEventListener('click', handlers.signOut);
  }

  const billingBtn = createEl('button', {
    id: ids.manageBillingBtn,
    className: 'topbar-menuitem',
    text: 'Billing & invoices',
    hidden: true,
  });
  if (typeof handlers?.manageBilling === 'function') {
    billingBtn.addEventListener('click', handlers.manageBilling);
  }

  return createEl('div', { id: ids.user, className: 'topbar-user', hidden: true }, [
    avatarButton,
    createEl('div', { id: ids.dropdown, className: 'topbar-dropdown', hidden: true }, [
      createEl('div', { id: ids.userName, className: 'topbar-dropdown-name' }),
      billingBtn,
      signOutButton,
    ]),
  ]);
}

export function renderTopbar(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;

  const opts = options || {};
  const ids = {
    langBtn:    opts.langBtnId    || 'langPickerBtn',
    langDialog: opts.langDialogId || 'langPickerDialog',
    theme:      opts.themeId      || 'themeToggleBtn',
    signIn:     opts.signInId     || 'topbarSignInBtn',
    user:       opts.userId       || 'topbarUser',
    avatarBtn:  opts.avatarBtnId  || 'topbarAvatarBtn',
    userPhoto:  opts.userPhotoId  || 'topbarUserPhoto',
    dropdown:   opts.dropdownId   || 'topbarDropdown',
    userName:   opts.userNameId   || 'topbarUserName',
    manageBillingBtn: opts.manageBillingId || 'topbarManageBillingBtn',
    signOutBtn: opts.signOutId    || '',
    photoAlt:   opts.photoAlt,
  };

  const shouldShowBackIcon = opts.backIcon !== null && opts.backIcon !== false && opts.backIcon !== '';
  const backIconName = opts.backIcon === undefined ? 'arrow_back' : String(opts.backIcon || '');

  const left = opts.backHref ? createEl('a', {
    className: 'topbar-back',
    href: opts.backHref,
    'aria-label': opts.backAriaLabel || (opts.backText || 'Back'),
    title: opts.backTitle || (opts.backText || 'Back'),
  }, [
    ...(shouldShowBackIcon ? [materialIcon(backIconName)] : []),
    createEl('span', { text: opts.backText || 'Back' }),
  ]) : null;

  const controls = [
    renderLanguageControl(ids),
    renderThemeToggle(ids.theme),
    renderSignInButton(ids.signIn, !!opts.signInHidden, opts.signInI18nKey, opts.handlers && opts.handlers.signIn),
    renderUserMenu(ids, opts.handlers || {}),
  ];

  const topbar = createEl('div', { className: opts.className || 'topbar' }, [
    createEl('div', { className: 'topbar-inner' }, [
      left,
      createEl('div', { className: opts.controlsClassName || 'topbar-controls' }, controls),
    ]),
  ]);

  root.replaceChildren(topbar);
  syncTopbarControlHeights(root);
}

export function updateTopbarLanguage(lang) {
  updateLanguagePicker(lang, { btn: 'langPickerBtn', dialog: 'langPickerDialog' });
}

export function updateTopbarUser(p) {
  const el       = document.getElementById('topbarUser');
  const photo    = document.getElementById('topbarUserPhoto');
  const name     = document.getElementById('topbarUserName');
  const billing  = document.getElementById('topbarManageBillingBtn');
  const signInEl = document.getElementById('topbarSignInBtn');
  if (!el) return;

  const signedIn = !!(p && p.type !== 'guest' && p.picture);

  if (signedIn) {
    photo.src = p.picture;
    photo.alt = p.name;
    if (name) name.textContent = p.name;
    el.removeAttribute('hidden');
    if (signInEl) signInEl.setAttribute('hidden', '');
    if (billing) {
      billing.removeAttribute('hidden');
    }
  } else {
    el.setAttribute('hidden', '');
    if (signInEl) signInEl.removeAttribute('hidden');
    if (billing) billing.setAttribute('hidden', '');
  }
}

export function toggleUserMenu() {
  const dd = document.getElementById('topbarDropdown');
  if (!dd) return;
  if (dd.hasAttribute('hidden')) {
    dd.removeAttribute('hidden');
    setTimeout(function () {
      document.addEventListener('click', closeUserMenu, { once: true });
    }, 0);
  } else {
    dd.setAttribute('hidden', '');
  }
}

export function closeUserMenu() {
  const dd = document.getElementById('topbarDropdown');
  if (dd) dd.setAttribute('hidden', '');
}
