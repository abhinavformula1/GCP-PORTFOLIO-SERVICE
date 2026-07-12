/**
 * Header navigation (public site).
 *
 * Keep `index.html` as a static shell; render this nav from JS so we can
 * iterate without bloating markup and keep responsibilities separated.
 */
import { createEl, injectShadowStyle, materialIcon } from './dom.js';

let _mounted = false;

function closeMenus() {
  const overflow = document.getElementById('headerOverflowMenu');
  const sheet = document.getElementById('headerMobileSheet');
  if (overflow) overflow.setAttribute('hidden', '');
  if (sheet) sheet.setAttribute('hidden', '');
}

function toggleMenu(id, anchorId) {
  const el = document.getElementById(id);
  const anchor = anchorId ? document.getElementById(anchorId) : null;
  if (!el) return;
  const isHidden = el.hasAttribute('hidden');
  closeMenus();
  if (!isHidden) return;
  el.removeAttribute('hidden');

  if (anchor && id === 'headerOverflowMenu') {
    try {
      const r = anchor.getBoundingClientRect();
      el.style.top = Math.round(r.bottom + 8) + 'px';
      el.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    } catch (_) {}
  }

  setTimeout(function () {
    document.addEventListener('click', function onDocClick(e) {
      const t = e && e.target;
      if (t && (el.contains(t) || (anchor && anchor.contains(t)))) return;
      closeMenus();
    }, { once: true });
  }, 0);
}

function hookMenuButtons() {
  const overflowBtn = document.getElementById('headerOverflowBtn');
  const mobileBtn = document.getElementById('headerMobileMenuBtn');
  if (overflowBtn) overflowBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu('headerOverflowMenu', 'headerOverflowBtn');
  });
  if (mobileBtn) mobileBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu('headerMobileSheet', 'headerMobileMenuBtn');
  });
  document.addEventListener('keydown', function (e) {
    if (e && e.key === 'Escape') closeMenus();
  });
  window.addEventListener('scroll', closeMenus, { passive: true });
  window.addEventListener('resize', closeMenus);
  window.addEventListener('popstate', closeMenus);
}

export function setHeaderAdminVisible(visible) {
  const adminBtn = document.getElementById('systemDesignAdminBtn');
  const adminBtnMobile = document.getElementById('systemDesignAdminBtnMobile');
  if (adminBtn) adminBtn.toggleAttribute('hidden', !visible);
  if (adminBtnMobile) adminBtnMobile.toggleAttribute('hidden', !visible);
}

export function renderHeaderNavIntoTopbar(opts) {
  if (_mounted) return;
  const topbarInner = document.querySelector('#sharedTopbar .topbar-inner');
  if (!topbarInner) return;
  const topbar = document.querySelector('#sharedTopbar .topbar');
  if (topbar) topbar.classList.add('topbar-with-header-nav');
  const o = opts || {};

  const nav = createEl('div', { className: 'header-nav', 'aria-label': 'Primary navigation' }, [
    createEl('div', { className: 'header-nav-left' }, [
      createEl('div', { className: 'header-nav-links', 'aria-label': 'Sections' }, [
        createEl('md-text-button', {
          className: 'home-btn header-nav-link',
          'aria-label': 'Home',
          'aria-pressed': 'true',
        }, [
          createEl('span', { 'data-i18n': 'home', text: 'Home' }),
        ]),
        createEl('md-text-button', {
          className: 'systemdesign-btn header-nav-link',
          'aria-label': 'Software Architecture',
          'aria-pressed': 'false',
        }, [
          createEl('span', { 'data-i18n': 'systemDesign', text: 'Software Architecture' }),
        ]),
      ]),
    ]),
    createEl('div', { className: 'header-nav-right', 'aria-label': 'Actions' }, [
      createEl('md-filled-button', {
        className: 'download-resume-btn header-nav-download',
        'aria-label': 'Resume',
      }, [
        materialIcon('download', { slot: 'icon' }),
        createEl('span', { text: 'Resume' }),
      ]),
      createEl('md-filled-button', {
        className: 'hire-me-btn header-nav-primary',
        'aria-label': 'Get in touch',
      }, [
        materialIcon('waving_hand', { slot: 'icon' }),
        createEl('span', { 'data-i18n': 'getInTouch', text: 'Get in touch' }),
      ]),
      createEl('md-outlined-icon-button', {
        className: 'header-nav-overflow-btn',
        id: 'headerOverflowBtn',
        'aria-label': 'More',
      }, [materialIcon('more_horiz')]),
      createEl('md-outlined-icon-button', {
        className: 'header-nav-hamburger',
        id: 'headerMobileMenuBtn',
        'aria-label': 'Menu',
      }, [materialIcon('menu')]),
      // Slot for topbar controls (lang/theme/sign-in/avatar) that topbar.js renders.
      createEl('div', { className: 'header-nav-topbar-controls', id: 'headerNavTopbarControls', 'aria-label': 'Preferences' }),
      createEl('div', {
        className: 'header-nav-menu',
        id: 'headerOverflowMenu',
        hidden: true,
        role: 'menu',
        'aria-label': 'More actions',
      }, [
        createEl('button', { type: 'button', className: 'header-nav-menu-item', role: 'menuitem' }, [
          materialIcon('person'),
          createEl('span', { 'data-i18n': 'referMe', text: 'Refer Me' }),
        ]),
        createEl('button', { type: 'button', className: 'header-nav-menu-item', role: 'menuitem' }, [
          materialIcon('contact_page'),
          createEl('span', { 'data-i18n': 'contactInfo', text: 'Contact info' }),
        ]),
        createEl('button', { type: 'button', className: 'header-nav-menu-item', role: 'menuitem' }, [
          materialIcon('link'),
          createEl('span', { text: 'LinkedIn' }),
        ]),
        createEl('button', { type: 'button', className: 'header-nav-menu-item', role: 'menuitem' }, [
          materialIcon('verified'),
          createEl('span', { text: 'Trailblazer' }),
        ]),
        createEl('button', { type: 'button', className: 'header-nav-menu-item', role: 'menuitem' }, [
          materialIcon('code'),
          createEl('span', { text: 'GitHub' }),
        ]),
        createEl('button', {
          type: 'button',
          className: 'header-nav-menu-item',
          role: 'menuitem',
          id: 'systemDesignAdminBtn',
          hidden: true,
        }, [
          materialIcon('lock'),
          createEl('span', { text: 'Admin' }),
        ]),
      ]),
      createEl('div', {
        className: 'header-mobile-sheet',
        id: 'headerMobileSheet',
        hidden: true,
        'aria-label': 'Menu',
      }, [
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('home'),
          createEl('span', { 'data-i18n': 'home', text: 'Home' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('account_tree'),
          createEl('span', { 'data-i18n': 'systemDesign', text: 'Software Architecture' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('person'),
          createEl('span', { 'data-i18n': 'referMe', text: 'Refer Me' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('link'),
          createEl('span', { text: 'LinkedIn' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('verified'),
          createEl('span', { text: 'Trailblazer' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('code'),
          createEl('span', { text: 'GitHub' }),
        ]),
        createEl('button', {
          type: 'button',
          className: 'header-mobile-item',
          id: 'systemDesignAdminBtnMobile',
          hidden: true,
        }, [
          materialIcon('lock'),
          createEl('span', { text: 'Admin' }),
        ]),
        createEl('button', { type: 'button', className: 'header-mobile-item' }, [
          materialIcon('contact_page'),
          createEl('span', { 'data-i18n': 'contactInfo', text: 'Contact info' }),
        ]),
      ]),
    ]),
  ]);

  // Insert nav before the right-side topbar controls.
  topbarInner.prepend(nav);

  // Move topbar-controls into header-nav-right for unified right-side grouping
  const topbarControls = topbarInner.querySelector('.topbar-controls');
  const headerNavRight = nav.querySelector('.header-nav-right');
  if (topbarControls && headerNavRight) {
    const slot = headerNavRight.querySelector('#headerNavTopbarControls');
    // Move all control children (lang, theme, signin, avatar) into header-nav-right
    Array.from(topbarControls.children).forEach(function(child) {
      (slot || headerNavRight).appendChild(child);
    });
    // Remove empty topbar-controls container
    topbarControls.remove();
  }

  // Wire actions (use window exports already present from main.js).
  const homeBtn = nav.querySelector('.home-btn');
  const sysBtn = nav.querySelector('.systemdesign-btn');
  const resumeBtn = nav.querySelector('.download-resume-btn');
  const touchBtn = nav.querySelector('.header-nav-primary');
  const menuRefer = nav.querySelector('#headerOverflowMenu .header-nav-menu-item:nth-child(1)');
  const menuContact = nav.querySelector('#headerOverflowMenu .header-nav-menu-item:nth-child(2)');
  const menuLinkedIn = nav.querySelector('#headerOverflowMenu .header-nav-menu-item:nth-child(3)');
  const menuTrailblazer = nav.querySelector('#headerOverflowMenu .header-nav-menu-item:nth-child(4)');
  const menuGitHub = nav.querySelector('#headerOverflowMenu .header-nav-menu-item:nth-child(5)');
  const menuAdmin = nav.querySelector('#systemDesignAdminBtn');
  const mobileItems = Array.from(nav.querySelectorAll('#headerMobileSheet .header-mobile-item'));
  const mobileHome = mobileItems[0] || null;
  const mobileSys = mobileItems[1] || null;
  const mobileRefer = mobileItems[2] || null;
  const mobileLinkedIn = mobileItems[3] || null;
  const mobileTrailblazer = mobileItems[4] || null;
  const mobileGitHub = mobileItems[5] || null;
  const mobileAdmin = nav.querySelector('#systemDesignAdminBtnMobile');
  const mobileContact = mobileItems[6] || null;

  function openExternal(url) {
    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
  }

  if (homeBtn) homeBtn.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onHome === 'function') return o.onHome();
    if (typeof window.closeSystemDesign === 'function') window.closeSystemDesign();
  });
  if (sysBtn) sysBtn.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onSystemDesign === 'function') return o.onSystemDesign();
    if (typeof window.openSystemDesign === 'function') window.openSystemDesign();
  });
  if (resumeBtn) resumeBtn.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onResume === 'function') return o.onResume();
    if (typeof window.generateResumePdf === 'function') window.generateResumePdf();
  });
  if (touchBtn) touchBtn.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onGetInTouch === 'function') return o.onGetInTouch();
    if (typeof window.openHireMe === 'function') window.openHireMe();
  });
  if (menuRefer) menuRefer.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onReferMe === 'function') return o.onReferMe();
    if (typeof window.openReferMe === 'function') window.openReferMe();
  });
  if (menuContact) menuContact.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onContactInfo === 'function') return o.onContactInfo();
    if (typeof window.openContactInfo === 'function') window.openContactInfo();
  });
  if (menuLinkedIn) menuLinkedIn.addEventListener('click', function () {
    closeMenus();
    openExternal('https://linkedin.com/in/abhinavformula1');
  });
  if (menuTrailblazer) menuTrailblazer.addEventListener('click', function () {
    closeMenus();
    openExternal('https://trailblazer.me/id/abhinavformula1');
  });
  if (menuGitHub) menuGitHub.addEventListener('click', function () {
    closeMenus();
    openExternal('https://github.com/abhinavformula1');
  });
  if (menuAdmin) menuAdmin.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onAdmin === 'function') return o.onAdmin();
    if (typeof window.openSystemDesignAdmin === 'function') window.openSystemDesignAdmin();
  });

  if (mobileHome) mobileHome.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onHome === 'function') return o.onHome();
    if (typeof window.closeSystemDesign === 'function') window.closeSystemDesign();
  });
  if (mobileSys) mobileSys.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onSystemDesign === 'function') return o.onSystemDesign();
    if (typeof window.openSystemDesign === 'function') window.openSystemDesign();
  });
  if (mobileRefer) mobileRefer.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onReferMe === 'function') return o.onReferMe();
    if (typeof window.openReferMe === 'function') window.openReferMe();
  });
  if (mobileLinkedIn) mobileLinkedIn.addEventListener('click', function () {
    closeMenus();
    openExternal('https://linkedin.com/in/abhinavformula1');
  });
  if (mobileTrailblazer) mobileTrailblazer.addEventListener('click', function () {
    closeMenus();
    openExternal('https://trailblazer.me/id/abhinavformula1');
  });
  if (mobileGitHub) mobileGitHub.addEventListener('click', function () {
    closeMenus();
    openExternal('https://github.com/abhinavformula1');
  });
  if (mobileAdmin) mobileAdmin.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onAdmin === 'function') return o.onAdmin();
    if (typeof window.openSystemDesignAdmin === 'function') window.openSystemDesignAdmin();
  });
  if (mobileContact) mobileContact.addEventListener('click', function () {
    closeMenus();
    if (typeof o.onContactInfo === 'function') return o.onContactInfo();
    if (typeof window.openContactInfo === 'function') window.openContactInfo();
  });

  // The Material <md-filled-button> in this project sometimes ends up with
  // `padding: 0` inside its shadow button for this specific instance. Force
  // breathing room so the icon/text don't touch the edges.
  customElements.whenDefined('md-filled-button').then(function () {
    if (!resumeBtn) return;
    injectShadowStyle(
      resumeBtn,
      [
        '#button {',
        '  padding-inline: 18px !important;',
        '  column-gap: 12px !important;',
        '  justify-content: center !important;',
        '}',
        'slot[name="icon"]::slotted(*) {',
        '  margin: 0 !important;',
        '}',
      ].join('\n')
    );
  });

  // Make menu close helper available to inline handlers if any.
  window.closeHeaderMenus = closeMenus;
  hookMenuButtons();

  _mounted = true;
}

