function createEl(tag, attrs, children) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(function ([key, value]) {
    if (value === false || value === null || value === undefined) return;
    if (key === 'className') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'hidden' && value) el.setAttribute('hidden', '');
    else el.setAttribute(key, value === true ? '' : value);
  });
  (children || []).forEach(function (child) {
    if (child) el.appendChild(child);
  });
  return el;
}

function materialIcon(name, attrs) {
  return createEl('span', {
    ...(attrs || {}),
    className: 'material-symbols-outlined',
    'aria-hidden': 'true',
    text: name,
  });
}

function renderLanguageSelect(id) {
  return createEl('md-outlined-select', {
    id,
    className: 'lang-select',
    label: 'Language',
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
  const avatarButtonAttrs = {
    id: ids.avatarBtn,
    className: 'topbar-avatar-btn',
    'aria-label': 'User menu',
  };
  if (handlers?.toggleUserMenu) avatarButtonAttrs.onclick = handlers.toggleUserMenu;

  const signOutAttrs = { className: 'topbar-signout', text: 'Sign out' };
  if (ids.signOutBtn) signOutAttrs.id = ids.signOutBtn;
  if (handlers?.signOut) signOutAttrs.onclick = handlers.signOut;

  return createEl('div', { id: ids.user, className: 'topbar-user', hidden: true }, [
    createEl('button', avatarButtonAttrs, [
      createEl('img', {
        id: ids.userPhoto,
        className: 'topbar-user-photo',
        src: '',
        alt: ids.photoAlt || 'Signed-in user profile photo',
      }),
    ]),
    createEl('div', { id: ids.dropdown, className: 'topbar-dropdown', hidden: true }, [
      createEl('div', { id: ids.userName, className: 'topbar-dropdown-name' }),
      createEl('button', signOutAttrs),
    ]),
  ]);
}

export function renderTopbar(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;

  const opts = options || {};
  const ids = {
    lang: opts.langId || 'langSelect',
    theme: opts.themeId || 'themeToggleBtn',
    signIn: opts.signInId || 'topbarSignInBtn',
    user: opts.userId || 'topbarUser',
    avatarBtn: opts.avatarBtnId || 'topbarAvatarBtn',
    userPhoto: opts.userPhotoId || 'topbarUserPhoto',
    dropdown: opts.dropdownId || 'topbarDropdown',
    userName: opts.userNameId || 'topbarUserName',
    signOutBtn: opts.signOutId || '',
    photoAlt: opts.photoAlt,
  };

  const left = opts.backHref ? createEl('a', { className: 'sd-admin-back', href: opts.backHref }, [
    materialIcon('arrow_back'),
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
}

export function renderTechFooter(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;
  const opts = options || {};
  const footer = createEl('footer', { className: opts.className || 'sponsors-footer' }, [
    createEl('div', { className: 'sponsors-inner' }, [
      createEl('span', {
        className: 'sponsors-label',
        'data-i18n': opts.i18n !== false ? 'footerBuiltWith' : null,
        text: 'Built with',
      }),
      createEl('div', { className: 'sponsors-logos' }, [
        createEl('a', {
          href: 'https://cloud.google.com',
          target: '_blank',
          rel: 'noopener',
          className: 'sponsor-link sponsor-link-gcp',
          'aria-label': 'Google Cloud',
        }, [
          createEl('img', {
            className: 'sponsor-logo',
            src: '/assets/img/google-cloud.svg',
            alt: 'Google Cloud',
            width: '155',
            height: '24',
          }),
        ]),
        createEl('span', { className: 'sponsor-divider' }),
        createEl('a', {
          href: 'https://www.salesforce.com',
          target: '_blank',
          rel: 'noopener',
          className: 'sponsor-link sponsor-link-sf',
          'aria-label': 'Salesforce',
        }, [
          createEl('img', {
            className: 'sponsor-logo',
            src: '/assets/img/salesforce.svg',
            alt: 'Salesforce',
            width: '50',
            height: '36',
          }),
        ]),
      ]),
    ]),
    createEl('p', {
      className: 'sponsors-disclaimer',
      'data-i18n': opts.i18n !== false ? 'footerTrademarkNote' : null,
      text: 'Trademarks are property of their respective owners. This is a personal portfolio; no endorsement or sponsorship is implied.',
    }),
  ]);

  root.replaceChildren(footer);
}
