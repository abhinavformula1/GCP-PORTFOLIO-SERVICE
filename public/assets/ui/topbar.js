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

function renderLanguageSelect(id) {
  return createEl('md-outlined-select', {
    id,
    className: 'lang-select',
    value: 'en',
    'aria-label': 'Language',
  }, [
    createEl('md-select-option', { value: 'en', selected: true }, [
      createEl('div', { slot: 'headline', text: 'English' }),
    ]),
    createEl('md-select-option', { value: 'fr' }, [
      createEl('div', { slot: 'headline', text: 'Français' }),
    ]),
  ]);
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

function renderSignInButton(id, initiallyHidden, i18nKey) {
  const labelAttrs = i18nKey ? { 'data-i18n': i18nKey } : {};
  return createEl('button', {
    id,
    className: 'topbar-signin-btn',
    'aria-label': 'Sign in',
    hidden: initiallyHidden,
  }, [
    materialIcon('login'),
    createEl('span', { ...labelAttrs, text: 'Sign in' }),
  ]);
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

  return createEl('div', { id: ids.user, className: 'topbar-user', hidden: true }, [
    avatarButton,
    createEl('div', { id: ids.dropdown, className: 'topbar-dropdown', hidden: true }, [
      createEl('div', { id: ids.userName, className: 'topbar-dropdown-name' }),
      signOutButton,
    ]),
  ]);
}

export function renderTopbar(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;

  const opts = options || {};
  const ids = {
    lang:       opts.langId       || 'langSelect',
    theme:      opts.themeId      || 'themeToggleBtn',
    signIn:     opts.signInId     || 'topbarSignInBtn',
    user:       opts.userId       || 'topbarUser',
    avatarBtn:  opts.avatarBtnId  || 'topbarAvatarBtn',
    userPhoto:  opts.userPhotoId  || 'topbarUserPhoto',
    dropdown:   opts.dropdownId   || 'topbarDropdown',
    userName:   opts.userNameId   || 'topbarUserName',
    signOutBtn: opts.signOutId    || '',
    photoAlt:   opts.photoAlt,
  };

  const left = opts.backHref ? createEl('a', {
    className: 'sd-admin-back',
    href: opts.backHref,
    'aria-label': opts.backAriaLabel || (opts.backText || 'Back'),
    title: opts.backTitle || (opts.backText || 'Back'),
  }, [
    materialIcon(opts.backIcon || 'arrow_back'),
    createEl('span', { text: opts.backText || 'Back' }),
  ]) : null;

  const controls = [
    renderLanguageSelect(ids.lang),
    renderThemeToggle(ids.theme),
    renderSignInButton(ids.signIn, !!opts.signInHidden, opts.signInI18nKey),
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

export function updateTopbarUser(p) {
  const el       = document.getElementById('topbarUser');
  const photo    = document.getElementById('topbarUserPhoto');
  const name     = document.getElementById('topbarUserName');
  const signInEl = document.getElementById('topbarSignInBtn');
  if (!el) return;

  const signedIn = !!(p && p.type !== 'guest' && p.picture);

  if (signedIn) {
    photo.src = p.picture;
    photo.alt = p.name;
    if (name) name.textContent = p.name;
    el.removeAttribute('hidden');
    if (signInEl) signInEl.setAttribute('hidden', '');
  } else {
    el.setAttribute('hidden', '');
    if (signInEl) signInEl.removeAttribute('hidden');
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
