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
  siteProfile,         setSiteProfile,
                       setGoogleCredential,
                       setPendingChatHistory,
                       setMyRecommendation,
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
} from './ui/systemdesign.js';

(function () {
  'use strict';

  // Shared state (siteProfile, googleCredential, pendingChatHistory,
  // myRecommendation) lives in ./core/state.js. Reads use the live
  // bindings — ES module imports stay in sync when the setter mutates
  // the module-internal variable. Writes go through the setter
  // functions because named imports are read-only at the call site.

  function saveSiteProfile(p) {
    setSiteProfile(p);
    updateTopbarUser(p);
    // The contact reveal lives in sessionStorage too — on reload we want the
    // phone to stay revealed without re-asking the server until the token
    // expires. We re-apply whatever the server last decided.
    applyContactPolicy(p && p.contact);
  }

  // Re-export onto window so the inline onclick="toggleUserMenu()" in the
  // topbar avatar button keeps resolving (extracted module is ESM-private).
  window.toggleUserMenu = toggleUserMenu;

  function signOut() {
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
    closeUserMenu();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }

    // Wipe any in-flight chat state so the next user starts clean
    resetChatState();
    const chatOpen = !document.getElementById('assistantOverlay').hasAttribute('hidden');
    if (chatOpen) {
      forceCloseAssistant();
    }

    showWelcomeOverlayWithGsi();
  }
  window.signOut = signOut;

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
        const chatOpen = !document.getElementById('assistantOverlay').hasAttribute('hidden');
        if (chatOpen) applyGoogleProfileToChat(profile);

        // Now that we know the visitor's sub, re-fetch the recommendation
        // list so myRecommendation gets populated. The section CTA hides
        // itself for visitors who already have a card (the kebab on the
        // card owns Edit/Delete from there on out).
        // Cheap call — Cloud Run sets s-maxage=30 on this endpoint.
        if (typeof refreshRecommendations === 'function') refreshRecommendations();
      });
  }

  // setLang is the language-flip orchestrator — it lives here (not in
  // i18n.js) because flipping the language has to also re-render the
  // chat assistant if the panel is open. That cross-module concern
  // belongs at the boot layer, where we can see both modules at once.
  function setLang(lang) {
    setCurrentLang(lang);
    const langSelect = document.getElementById('langSelect');
    if (langSelect && langSelect.value !== lang) langSelect.value = lang;
    applyPageLang(lang);
    const teaserText = document.querySelector('.chat-teaser-text');
    const teaserCta  = document.querySelector('.chat-teaser-cta');
    if (teaserText) teaserText.textContent = t().teaserText;
    if (teaserCta)  teaserCta.textContent  = t().teaserCta;
    const overlay = document.getElementById('assistantOverlay');
    if (!overlay.hasAttribute('hidden')) {
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

  // Wire the M3 outlined-select to setLang. Listen on `change` (fires when
  // the user picks an option from the dropdown menu).
  //
  // Also: force the inner <md-outlined-field>'s height to 40px so the
  // select harmonises with the 40px theme-toggle and Sign-in button. The
  // public --md-outlined-field-container-height token *is* set on the
  // host, but @material/web@1.5.1 hard-codes a `min-height: 56px` on the
  // internal field that the token doesn't override.
  customElements.whenDefined('md-outlined-select').then(function () {
    const langSelect = document.getElementById('langSelect');
    if (!langSelect) return;
    langSelect.addEventListener('change', function () {
      setLang(langSelect.value);
    });
    injectShadowStyle(
      langSelect,
      'md-outlined-field { min-height: 40px !important; height: 40px !important; }'
    );
  });

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
    document.querySelectorAll('.hire-me-btn-neutral, .home-btn, .refer-btn, .recos-cta, .systemdesign-btn').forEach(function (btn) {
      injectShadowStyle(btn, BRAND_BUTTON_CSS);
    });
  });

  // Theme toggle (light/dark): extracted to ./core/theme.js
  initTheme();

  // Populate page content in default language on load
  applyPageLang('en');

  // Location popover (timezone-aware): extracted to ./ui/location.js
  initLocationPopover();

  // Restore topbar user if session exists
  if (siteProfile) {
    updateTopbarUser(siteProfile);
    // Re-apply the cached server contact-reveal decision so a returning
    // signed-in viewer's phone stays revealed across reloads (until token
    // expiry / sign-out clears the profile).
    applyContactPolicy(siteProfile.contact);
    // Show the once-per-session welcome toast for signed-in (non-guest) users
    if (siteProfile.type !== 'guest' && siteProfile.name) {
      // Defer to next tick so DOM/CSS are settled before the slide-in
      setTimeout(function () { showWelcomeToast(siteProfile); }, 200);
    }
  } else {
    showWelcomeOverlayWithGsi();
  }

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

  // Top-bar "Sign in" button — re-opens the welcome overlay so guests can
  // upgrade to a signed-in session at any time.
  const topbarSignInBtn = document.getElementById('topbarSignInBtn');
  if (topbarSignInBtn) {
    topbarSignInBtn.addEventListener('click', showWelcomeOverlayWithGsi);
  }

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

  /* ── System Design view ──
     Master/detail topic browser that swaps the body grid (resume DOM is
     hidden, not removed, so the Download Resume scraper still works).
     Wires its own hashchange listener for #/system-design/<id> deep
     links. → ./ui/systemdesign.js  */
  window.openSystemDesign  = openSystemDesign;
  window.closeSystemDesign = closeSystemDesign;
  initSystemDesign();
})();

