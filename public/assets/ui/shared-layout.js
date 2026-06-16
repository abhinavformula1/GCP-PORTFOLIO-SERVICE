function createEl(tag, attrs, children) {
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
    } else if (key === 'data-i18n') {
      el.dataset.i18n = value;
    }
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

function injectShadowStyle(host, css) {
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

function syncTopbarControlHeights(root) {
  customElements.whenDefined('md-outlined-select').then(function () {
    root.querySelectorAll('.lang-select').forEach(function (langSelect) {
      injectShadowStyle(
        langSelect,
        'md-outlined-field { min-height: 40px !important; height: 40px !important; }'
      );
    });
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
  syncTopbarControlHeights(root);
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
