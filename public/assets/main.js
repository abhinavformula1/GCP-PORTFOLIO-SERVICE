// ─────────────────────────────────────────────────────────────────────────────
// main.js — boot/orchestrator
//
// All feature code lives in focused ES modules under
// public/assets/{core,ui,chat,refer,recommendations}/. This file's job is
// to: (1) import the public surface of each module, (2) re-export the
// inline-onclick'd functions onto `window` so the HTML still resolves
// them by global name, (3) wire the cross-module orchestration that
// doesn't belong in any single module — sign-in (which has to update
// chat + topbar + recommendations + welcome at once), language flip
// (which has to re-render the open chat), Google Sign-In bootstrap,
// and a couple of @material/web shadow-DOM CSS workarounds.
//
// If you're adding a new feature: create a new module, export its
// public functions, then add an `import` + `window.X = X` here.
// Resist the urge to dump anything else into this file.
// ─────────────────────────────────────────────────────────────────────────────
import {
  generateResumePdf,
  downloadResumePdf,
  closeResumePreview,
} from './refer/resume-pdf.js';
import { initTheme }         from './core/theme.js';
import { initLocationPopover } from './ui/location.js';
import {
  googleCredential,    siteProfile,
                       setSiteProfile,
                       setGoogleCredential,
                       setPendingChatHistory,
                       setMyRecommendation,
                       broadcastSignOut,
                       onCrossTabSignOut,
} from './core/state.js';
import {
  applyPageLang, t,
  setCurrentLang,
} from './core/i18n.js';
import {
  authedFetch, applyContactPolicy, initGoogleSignIn,
} from './core/auth.js';
import {
  updateTopbarUser, toggleUserMenu, closeUserMenu,
} from './ui/topbar.js';
import {
  showWelcomeOverlay, hideWelcomeOverlay,
  showWelcomeToast,   closeWelcomeToast,
} from './ui/welcome.js';
import { openHireMe, closeHireMe, initHireMe } from './ui/hireme.js';
import { openReferMe, closeReferMe, initRefer } from './refer/refer.js';
import {
  openContactInfo, closeContactInfo, initContactInfo,
} from './ui/contact.js';
import { GOOGLE_CLIENT_ID } from './core/config.js';
import {
  openAssistant, closeAssistant, forceCloseAssistant,
  minimiseAssistant, restartAssistant, resumeAssistant,
  toggleChatTeaser,
  resetChatState, applyGoogleProfileToChat,
  initChat,
} from './chat/chat.js';
import {
  refreshRecommendations, updateRecommendationCta,
  openLeaveRecommendation, closeLeaveRecommendation,
  initRecommendations,
} from './recommendations/recommendations.js';
import {
  initSystemDesign, openSystemDesign, closeSystemDesign,
} from './ui/software-architecture.js?v=2026-06-28-force-locked-2';
import { renderTopbar, updateTopbarLanguage } from './ui/topbar.js';
import { renderHeaderNavIntoTopbar, setHeaderAdminVisible } from './ui/header-nav.js';
import { renderTechFooter } from './ui/footer.js';
import { renderAtlasShell } from './ui/atlas-shell.js';
import { mountSponsorSlot } from './ui/sponsorship.js';
import '/assets/ui/loader.js';

(function () {
  'use strict';

  renderTechFooter('#sharedFooter');

  // ── Lightweight first-party analytics (no GA) ───────────────────────────────
  // Anonymous client id stored in localStorage. Used to compute monthly uniques
  // without storing IP/email. Admin dashboard reads aggregates from Firestore.
  (function initAnalytics() {
    try {
      if (location.pathname.startsWith('/admin/')) return;
      if (location.pathname.startsWith('/print/')) return;

      const KEY = 'portfolio_anon_cid_v1';
      function uuid() {
        if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
          return globalThis.crypto.randomUUID();
        }
        // Fallback: non-crypto unique-ish token (good enough for a portfolio).
        return 'cid-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      }
      let clientId = localStorage.getItem(KEY);
      if (!clientId) {
        clientId = uuid();
        localStorage.setItem(KEY, clientId);
      }

      let lastPath = '';
      let timer = 0;
      let activePath = '';
      let activeStart = Date.now();
      let activeMs = 0;
      let visible = true;
      let maxScrollPct = 0;

      function getApproxRegion() {
        // Best-effort only. Prefer BCP-47 region from browser locale (e.g. en-IN → IN).
        try {
          if (globalThis.Intl && Intl.Locale) {
            const loc = new Intl.Locale(navigator.language || 'en');
            return (loc && loc.region) ? String(loc.region) : '';
          }
        } catch (_) {}
        return '';
      }

      function getTimezone() {
        try {
          return String(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
        } catch (_) {
          return '';
        }
      }

      function userPayload() {
        // Uses live ES-module binding `siteProfile` imported at top.
        try {
          if (!siteProfile || siteProfile.type === 'guest') return null;
          const sub = String(siteProfile.sub || '').trim();
          const name = String(siteProfile.name || '').trim();
          if (!sub) return null;
          return { sub, name };
        } catch (_) {
          return null;
        }
      }

      function computeScrollPct() {
        try {
          const doc = document.documentElement;
          const scrollTop = window.scrollY || doc.scrollTop || 0;
          const viewport = window.innerHeight || doc.clientHeight || 0;
          const height = Math.max(doc.scrollHeight || 0, doc.offsetHeight || 0);
          const bottom = scrollTop + viewport;
          if (!height) return 0;
          const pct = Math.max(0, Math.min(100, Math.round((bottom / height) * 100)));
          return pct;
        } catch (_) {
          return 0;
        }
      }

      function sendEvent(type, data) {
        const payload = JSON.stringify(Object.assign({
          clientId,
          type,
          host: location.host || '',
          lang: document.documentElement.lang || '',
          device: (function () {
            try {
              if (globalThis.matchMedia && matchMedia('(max-width: 720px)').matches) return 'mobile';
              if (globalThis.matchMedia && matchMedia('(pointer: coarse)').matches) return 'mobile';
            } catch (_) {}
            return 'desktop';
          })(),
          tz: getTimezone(),
          region: getApproxRegion(),
          user: userPayload(),
        }, data || {}));

        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/analytics/event', blob);
          return;
        }
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
          credentials: 'same-origin',
        }).catch(function () {});
      }

      function flushEngagement(reason) {
        try {
          const now = Date.now();
          if (visible) activeMs += Math.max(0, now - activeStart);
          activeStart = now;
          const dwellMs = Math.max(0, Math.round(activeMs));
          const path = activePath || (location.pathname + location.search);
          if (dwellMs >= 1500 && path) {
            sendEvent('engagement', {
              path,
              dwellMs,
              scrollPct: Math.max(0, Math.min(100, Math.round(maxScrollPct))),
              reason: String(reason || ''),
            });
          }
          activeMs = 0;
          maxScrollPct = 0;
        } catch (_) {}
      }

      function send() {
        const path = location.pathname + location.search;
        if (!path || path === lastPath) return;

        // Previous page engagement (SPA nav).
        if (activePath && activePath !== path) {
          flushEngagement('nav');
        }

        lastPath = path;
        if (!activePath) activePath = path;
        if (activePath !== path) activePath = path;
        activeStart = Date.now();
        activeMs = 0;
        maxScrollPct = computeScrollPct();

        let utm = null;
        try {
          const sp = new URLSearchParams(location.search || '');
          const source = (sp.get('utm_source') || '').trim();
          const medium = (sp.get('utm_medium') || '').trim();
          const campaign = (sp.get('utm_campaign') || '').trim();
          const content = (sp.get('utm_content') || '').trim();
          const term = (sp.get('utm_term') || '').trim();
          if (source || medium || campaign || content || term) {
            utm = { source, medium, campaign, content, term };
          }
        } catch (_) {}

        sendEvent('page_view', {
          path,
          referrer: document.referrer || '',
          utm,
        });
      }

      function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = 0; send(); }, 150);
      }

      // Initial page load.
      send();

      // SPA navigations (History API) for software-architecture pages.
      const _push = history.pushState;
      const _replace = history.replaceState;
      history.pushState = function () { _push.apply(this, arguments); schedule(); };
      history.replaceState = function () { _replace.apply(this, arguments); schedule(); };
      window.addEventListener('popstate', schedule);

      window.addEventListener('scroll', function () {
        const pct = computeScrollPct();
        if (pct > maxScrollPct) maxScrollPct = pct;
      }, { passive: true });

      document.addEventListener('visibilitychange', function () {
        const now = Date.now();
        if (document.visibilityState === 'hidden') {
          if (visible) activeMs += Math.max(0, now - activeStart);
          visible = false;
        } else {
          visible = true;
          activeStart = now;
        }
      });

      window.addEventListener('pagehide', function () {
        flushEngagement('hide');
      });
    } catch (_) { /* analytics must never break the page */ }
  })();

  // Shared state (siteProfile, googleCredential, pendingChatHistory,
  // myRecommendation) lives in ./core/state.js. Reads use the live
  // bindings — ES module imports stay in sync when the setter mutates
  // the module-internal variable. Writes go through the setter
  // functions because named imports are read-only at the call site.

  function saveSiteProfile(p) {
    setSiteProfile(p);
    updateTopbarUser(p);
    refreshAdminNav();
    // The contact reveal lives in sessionStorage too — on reload we want the
    // phone to stay revealed without re-asking the server until the token
    // expires. We re-apply whatever the server last decided.
    applyContactPolicy(p && p.contact);
  }

  // Re-export onto window so the inline onclick="toggleUserMenu()" in the
  // topbar avatar button keeps resolving (extracted module is ESM-private).
  window.toggleUserMenu = toggleUserMenu;

  function signOut(opts) {
    const options = opts || {};
    saveSiteProfile(null); // clears sessionStorage + topbar + phone reveal
    try { sessionStorage.removeItem('welcome_toast_shown'); } catch (_) {}
    setGoogleCredential(null);
    setPendingChatHistory(null);
    // Drop the previous session's myRecommendation pointer so the section
    // CTA reappears (it was hidden because the signed-in user owned a card).
    // The card itself stays public — signed-out visitors just can't manage
    // it (re-auth required to access kebab actions, by design).
    setMyRecommendation(null);
    if (typeof updateRecommendationCta === 'function') updateRecommendationCta();
    updateTopbarUser(null);
    refreshAdminNav();
    closeUserMenu();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }

    // Wipe any in-flight chat state so the next user starts clean
    resetChatState();
    const assistantOverlay = document.getElementById('assistantOverlay');
    const chatOpen = !!(assistantOverlay && !assistantOverlay.hasAttribute('hidden'));
    if (chatOpen) {
      forceCloseAssistant();
    }

    if (options.broadcast !== false) broadcastSignOut();
    if (options.showOverlay !== false) showWelcomeOverlayWithGsi();
  }
  window.signOut = signOut;
  onCrossTabSignOut(function () {
    signOut({ broadcast: false, showOverlay: false });
  });
  renderTopbar('#sharedTopbar', {
    // Show Sign in for guests by default; updateTopbarUser() will hide it for signed-in users.
    signInHidden: false,
    signInI18nKey: 'topbarSignIn',
    handlers: {
      toggleUserMenu,
      signOut,
      signIn: showWelcomeOverlayWithGsi,
      manageBilling: function () {
        closeUserMenu();
        // Always available for signed-in subscribers via avatar menu.
        if (!googleCredential) {
          showWelcomeOverlayWithGsi();
          return;
        }
        fetch('/api/billing/portal-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + googleCredential },
          credentials: 'same-origin',
          body: JSON.stringify({}),
        })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            const url = data && data.url ? String(data.url) : '';
            if (!url) return;
            try {
              const win = window.open(url, '_blank', 'noopener');
              if (!win) location.href = url;
            } catch (_) {
              location.href = url;
            }
          })
          .catch(function () {});
      },
    },
  });

  renderHeaderNavIntoTopbar({
    onHome: closeSystemDesign,
    onSystemDesign: openSystemDesign,
    onGetInTouch: openHireMe,
    onReferMe: openReferMe,
    onContactInfo: openContactInfo,
    onAdmin: openSystemDesignAdmin,
    onResume: generateResumePdf,
  });

  function setAdminNavVisible(visible) {
    setHeaderAdminVisible(visible);
  }

  function refreshAdminNav() {
    setAdminNavVisible(false);
    fetch('/api/local-preview')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.enabled) setAdminNavVisible(true);
      })
      .catch(function () {});
    if (!siteProfile || siteProfile.type === 'guest') return;
    authedFetch('/api/admin/me').then(function (data) {
      setAdminNavVisible(!!(data && data.isAdmin));
    });
  }

  function openSystemDesignAdmin() {
    try {
      if (googleCredential && siteProfile && siteProfile.type !== 'guest') {
        localStorage.setItem('portfolio_admin_handoff', JSON.stringify({
          credential: googleCredential,
          expiresAt:  Date.now() + 60000,
        }));
      }
    } catch (_) {}
    window.open('/admin/software-architecture/', '_blank', 'noopener');
  }
  window.openSystemDesignAdmin = openSystemDesignAdmin;

  // Header-nav menus are handled inside ui/header-nav.js

  // initGoogleSignIn → ./core/auth.js. We wrap the module function so we
  // can inject the GOOGLE_CLIENT_ID + handleGoogleSignIn callback. The
  // callback orchestrates chat + welcome + recommendations, so it has to
  // stay here at the boot layer — that's the only place that knows about
  // all three modules at once.
  function bootGoogleSignIn() {
    initGoogleSignIn({
      clientId: GOOGLE_CLIENT_ID,
      onSignIn: handleGoogleSignIn,
    });
  }

  // showWelcomeOverlay is wrapped here so opening the welcome modal also
  // kicks off Google Sign-In init once the GIS library is loaded. The
  // wrapper, not the raw module function, gets re-exported on `window`
  // so the topbar Sign-in button and signOut() trigger the same flow.
  function showWelcomeOverlayWithGsi() {
    showWelcomeOverlay({
      onShown: function () {
        if (window.google && window.google.accounts) bootGoogleSignIn();
      },
    });
  }
  window.showWelcomeOverlay = showWelcomeOverlayWithGsi;
  window.closeWelcomeToast  = closeWelcomeToast;

  function handleGoogleSignIn(response) {
    let profile;
    try {
      const payload = JSON.parse(atob(response.credential.split('.')[1]));
      // sub = Google's stable user identifier. Stored alongside the visible
      // profile fields so the client can identify "its own" recommendation
      // in the public list (the Firestore doc id IS this sub claim) without
      // needing a separate /api/recommendation/me round-trip.
      profile = {
        sub:     payload.sub,
        name:    payload.name,
        email:   payload.email,
        picture: payload.picture,
      };
    } catch (_) {
      hideWelcomeOverlay();
      return;
    }

    // If a different user is signing in (or this was previously a guest
    // session), wipe any in-memory chat state so the new user starts clean.
    const prevEmail = (siteProfile && siteProfile.email) || '';
    if (prevEmail && prevEmail !== profile.email) {
      resetChatState();
      setPendingChatHistory(null);
      const ov = document.getElementById('assistantOverlay');
      if (ov && !ov.hasAttribute('hidden')) forceCloseAssistant();
    }

    // Cache the credential — chat APIs use it as a Bearer token
    setGoogleCredential(response.credential);

    hideWelcomeOverlay();

    // Ask the backend whether this is a returning visitor. We do this in
    // parallel with the rest of the UI flow — if the call fails we still
    // sign the user in, just without the "welcome back" personalisation.
    fetch('/api/session/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential: response.credential }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data && data.success) {
          profile.isReturning = !!data.isReturning;
          profile.visitCount  = data.visitCount  || 1;
          profile.lastSeenAt  = data.lastSeenAt  || null;
          // Apply the server's contact-reveal decision. The phone number
          // never lived in HTML — the server only returns it when the
          // verified email belongs to an allow-listed org (google.com,
          // salesforce.com). Any other path (guest / @gmail / random)
          // gets contact.canSeePhone === false and the masked placeholder
          // remains in place.
          profile.contact = data.contact || null;
          profile.subscription = data.subscription || null;
          applyContactPolicy(profile.contact);
        }
        saveSiteProfile(profile);

        // Reset the once-per-session guard so a fresh sign-in always shows
        try { sessionStorage.removeItem('welcome_toast_shown'); } catch (_) {}
        showWelcomeToast(profile, { force: true });

        // Fetch the user's in-progress chat (if any) so we can resume
        // exactly where they left off when they next open the assistant.
        return authedFetch('/api/chat/active');
      })
      .then(function (chatRes) {
        if (chatRes && chatRes.success && chatRes.chat) {
          setPendingChatHistory(chatRes.chat);
        }
        const assistantOverlay = document.getElementById('assistantOverlay');
        const chatOpen = !!(assistantOverlay && !assistantOverlay.hasAttribute('hidden'));
        if (chatOpen) applyGoogleProfileToChat(profile);

        // Now that we know the visitor's sub, re-fetch the recommendation
        // list so myRecommendation gets populated. The section CTA hides
        // itself for visitors who already have a card (the kebab on the
        // card owns Edit/Delete from there on out).
        // Cheap call — Cloud Run sets s-maxage=30 on this endpoint.
        if (typeof refreshRecommendations === 'function') refreshRecommendations();
      });
  }

  function restoreSessionFromCredential(token) {
    return fetch('/api/session/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ credential: token }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.success) return false;
        const profile = {
          sub:         data.sub,
          name:        data.name || '',
          email:       data.email || '',
          picture:     data.picture || null,
          isReturning: !!data.isReturning,
          visitCount:  data.visitCount || 1,
          lastSeenAt:  data.lastSeenAt || null,
          contact:     data.contact || null,
          subscription: data.subscription || null,
        };
        saveSiteProfile(profile);
        applyContactPolicy(profile.contact);
        if (profile.name) {
          setTimeout(function () { showWelcomeToast(profile); }, 200);
        }
        refreshRecommendations();
        return authedFetch('/api/chat/active').then(function (chatRes) {
          if (chatRes && chatRes.success && chatRes.chat) {
            setPendingChatHistory(chatRes.chat);
          }
          return true;
        });
      })
      .catch(function () { return false; });
  }

  // setLang is the language-flip orchestrator — it lives here (not in
  // i18n.js) because flipping the language has to also re-render the
  // chat assistant if the panel is open. That cross-module concern
  // belongs at the boot layer, where we can see both modules at once.
  function setLang(lang) {
    setCurrentLang(lang);
    try { localStorage.setItem('portfolio_lang', lang); } catch (_) {}
    try { updateTopbarLanguage(lang); } catch (_) {}
    applyPageLang(lang);
    const teaserText = document.querySelector('.chat-teaser-text');
    const teaserCta  = document.querySelector('.chat-teaser-cta');
    if (teaserText) teaserText.textContent = t().teaserText;
    if (teaserCta)  teaserCta.textContent  = t().teaserCta;
    const overlay = document.getElementById('assistantOverlay');
    if (overlay && !overlay.hasAttribute('hidden')) {
      openAssistant();
    }
  }
  window.setLang = setLang;

  /**
   * Inject a stylesheet into a custom element's shadow root.
   *
   * Several @material/web@1.5.1 components (notably <md-outlined-select>'s
   * internal field height and <md-filled-button>'s internal padding) have
   * baked-in values that the *public* CSS custom-property tokens don't
   * actually override. We reach into the shadow DOM via `adoptedStyleSheets`
   * — the modern Web-Components-friendly equivalent of `!important` — and
   * fall back to a plain <style> on browsers without constructable
   * stylesheet support.
   *
   * Idempotent and silent on failure: each call still works if a previous
   * sheet was already adopted.
   */
  function injectShadowStyle(host, css) {
    if (!host || !host.shadowRoot) return;
    const sr = host.shadowRoot;
    try {
      if (typeof CSSStyleSheet === 'function' && Array.isArray(sr.adoptedStyleSheets)) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sr.adoptedStyleSheets = sr.adoptedStyleSheets.concat([sheet]);
        return;
      }
    } catch (_) { /* fall through to <style> fallback */ }
    const style = document.createElement('style');
    style.textContent = css;
    sr.appendChild(style);
  }

  // Language is driven by the globe icon + dialog in ui/language-picker.js.

  // Force breathing space inside <md-filled-button> for our two brand
  // buttons (.hire-me-btn and .hm-submit). In @material/web@1.5.1, the
  // inner `<button class="button">` rendered into the shadow DOM has zero
  // horizontal padding and an 8px icon-label gap baked into the component
  // stylesheet — the public --md-filled-button-leading-space / -with-icon-
  // spacing tokens don't actually reach it. We use the same shadow-DOM
  // injection trick as the language select to add real padding + a wider
  // icon-label gap, so our primary CTA reads as substantial instead of
  // cramped.
  const BRAND_BUTTON_CSS = [
    '.button {',
    '  padding-inline: 28px !important;',
    '  gap: 12px !important;',
    '}',
    '.label { white-space: nowrap; }',
  ].join('\n');
  customElements.whenDefined('md-filled-button').then(function () {
    document.querySelectorAll('.hire-me-btn, .hm-submit, .refer-copy-btn').forEach(function (btn) {
      injectShadowStyle(btn, BRAND_BUTTON_CSS);
    });
  });
  // The "Refer Me" CTA is an <md-outlined-button>, which uses a separate
  // custom element. Same horizontal-padding fix applies — without it the
  // icon and label crash into each other. Wait until the outlined variant
  // is registered before injecting. We also extend this to .recos-cta
  // (the "Leave a Recommendation" button), .home-btn, and .systemdesign-btn so all
  // outlined CTAs share the same internal padding as the filled brand
  // buttons.
  customElements.whenDefined('md-outlined-button').then(function () {
    document.querySelectorAll('.hire-me-btn-neutral, .home-btn, .refer-btn, .recos-cta, .systemdesign-btn, .admin-btn').forEach(function (btn) {
      injectShadowStyle(btn, BRAND_BUTTON_CSS);
    });
  });

  // Theme toggle (light/dark): extracted to ./core/theme.js
  initTheme();

  // Populate page content in preferred language on load
  (function initLanguageFromStorage() {
    let lang = 'en';
    try {
      const stored = localStorage.getItem('portfolio_lang');
      if (stored) lang = stored;
    } catch (_) {}
    setLang(lang);
  })();

  // Location popover (timezone-aware): extracted to ./ui/location.js
  initLocationPopover();

  // Rehydrate signed-in state from the server using the stored credential.
  function shouldSkipWelcomeOverlayForLocalPreview() {
    return fetch('/api/local-preview', { credentials: 'same-origin' })
      .then(function (resp) { return resp.json().catch(function () { return null; }).then(function (data) { return { ok: resp.ok, data }; }); })
      .then(function (out) {
        const enabled = !!(out && out.ok && out.data && out.data.enabled);
        if (!enabled) return false;
        // In local preview mode, default to a guest session and avoid forcing sign-in.
        if (!siteProfile) saveSiteProfile({ type: 'guest' });
        hideWelcomeOverlay();
        return true;
      })
      .catch(function () { return false; });
  }

  shouldSkipWelcomeOverlayForLocalPreview().then(function (skipped) {
    if (skipped) return;
    if (googleCredential) {
      restoreSessionFromCredential(googleCredential).then(function (restored) {
        if (!restored && !siteProfile) showWelcomeOverlayWithGsi();
      });
    } else {
      showWelcomeOverlayWithGsi();
    }
  });

  // Guest button on welcome overlay
  document.getElementById('welcomeGuestBtn').addEventListener('click', function () {
    saveSiteProfile({ type: 'guest' });
    hideWelcomeOverlay();
  });

  // Close (X) button on welcome overlay — same effect as "Continue as Guest"
  // (dismiss the modal, browse anonymously, signin remains available in the topbar).
  const welcomeCloseBtn = document.getElementById('welcomeCloseBtn');
  if (welcomeCloseBtn) {
    welcomeCloseBtn.addEventListener('click', function () {
      saveSiteProfile({ type: 'guest' });
      hideWelcomeOverlay();
    });
  }

  // Catch-all: if the welcome <md-dialog> closes for ANY reason (Esc key,
  // scrim click, Maybe later, X) and we still don't have a profile, default
  // to a guest session so the topbar Sign-in button reveals itself.
  customElements.whenDefined('md-dialog').then(function () {
    const welcomeOverlay = document.getElementById('welcomeOverlay');
    if (!welcomeOverlay) return;
    welcomeOverlay.addEventListener('close', function () {
      if (!siteProfile) {
        saveSiteProfile({ type: 'guest' });
      }
    });
  });

  // Top-bar "Sign in" click handler is wired by ui/topbar.js via handlers.signIn

  // Init Google Sign-In once the GIS library has loaded
  if (GOOGLE_CLIENT_ID) {
    const _gsiPoll = setInterval(function () {
      if (window.google && window.google.accounts) {
        clearInterval(_gsiPoll);
        bootGoogleSignIn();
      }
    }, 200);
  }

  /* ── Chat assistant ──
     The whole guided assistant — state machine, render pipeline, FAB
     launcher, panel resize, Esc-to-close, persistence to /api/chat/active,
     AI summarisation — lives in ./chat/chat.js. main.js just wires the
     window.* exports for inline-onclick handlers and calls initChat().  */
  window.toggleChatTeaser  = toggleChatTeaser;
  window.openAssistant     = openAssistant;
  window.closeAssistant    = closeAssistant;
  window.minimiseAssistant = minimiseAssistant;
  window.restartAssistant  = restartAssistant;
  window.resumeAssistant   = resumeAssistant;
  renderAtlasShell('#sharedAtlasShell', {
    toggleChatTeaser,
    openAssistant,
    closeAssistant,
    minimiseAssistant,
    restartAssistant,
  });
  initChat();

  // Hire Me modal → ./ui/hireme.js
  // Refer Me modal → ./refer/refer.js
  // Resume PDF generator → ./refer/resume-pdf.js
  // Re-export the inline-onclick'd functions onto window so HTML calls resolve.
  window.openHireMe        = openHireMe;
  window.closeHireMe       = closeHireMe;
  window.openReferMe       = openReferMe;
  window.closeReferMe      = closeReferMe;
  window.openContactInfo   = openContactInfo;
  window.closeContactInfo  = closeContactInfo;
  window.generateResumePdf  = generateResumePdf;
  window.downloadResumePdf  = downloadResumePdf;
  window.closeResumePreview = closeResumePreview;
  initHireMe();
  initRefer();
  initContactInfo();

  // Catch-all close hook: if md-dialog fires its `close` event for any
  // reason (Esc key, scrim click, programmatic) we want the blob URL
  // revoked. closeResumePreview is idempotent, so calling it again
  // after the X button already fired it is harmless.
  customElements.whenDefined('md-dialog').then(function () {
    const preview = document.getElementById('resumePreviewOverlay');
    if (preview) preview.addEventListener('close', closeResumePreview);
  });

  /* ── Recommendations section ──
     Render, gate (sign-in required), submit handler, edit handler →
     ./recommendations/recommendations.js. We re-export the inline-onclick'd
     openers onto window and call initRecommendations() to wire the form
     and visibilitychange listener.  */
  window.openLeaveRecommendation  = openLeaveRecommendation;
  window.closeLeaveRecommendation = closeLeaveRecommendation;
  initRecommendations();

  /* ── Homepage sponsor slots ──
     Right column (top of Work Experience) and Left column (bottom of aside).
     Each placement is configured independently in Admin → Sponsorships.     */
  mountSponsorSlot(document.getElementById('homepageSponsorSlot'),     'homepage');
  mountSponsorSlot(document.getElementById('homepageSponsorSlotLeft'), 'homepage-left');

  /* ── System Design view ──
     Master/detail topic browser that swaps the body grid (resume DOM is
     hidden, not removed, so the Download Resume scraper still works).
     Uses History API (/software-architecture/<id>) for crawlable, shareable URLs.
     → ./ui/systemdesign.js  */
  window.openSystemDesign  = openSystemDesign;
  window.closeSystemDesign = closeSystemDesign;
  initSystemDesign();
})();

