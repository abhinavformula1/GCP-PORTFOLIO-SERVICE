/**
 * Welcome overlay (the modal) + welcome-back toast.
 *
 * Two distinct UI surfaces, but they share enough plumbing (one-shot
 * "shown this session" guard, dependency on the signed-in profile,
 * `<md-dialog>` upgrade waiting) that it's tidier to keep them in one
 * module.
 *
 * Decoupling note: `showWelcomeOverlay` historically also kicked off
 * Google Sign-In initialisation (so the GIS button renders inside the
 * dialog). To keep this module free of auth dependencies, callers can
 * pass an `onShown` callback that fires once the dialog is visible —
 * main.js wires that to `initGoogleSignIn`.
 */

import { t } from '../core/i18n.js';

const WELCOME_TOAST_TTL_MS = 10000;
let _welcomeToastTimer = null;

function wireOverlayControls() {
  const closeBtn = document.getElementById('welcomeCloseBtn');
  if (closeBtn && !closeBtn.dataset.wiredWelcomeClose) {
    closeBtn.addEventListener('click', hideWelcomeOverlay);
    closeBtn.dataset.wiredWelcomeClose = 'true';
  }

  const guestBtn = document.getElementById('welcomeGuestBtn');
  if (guestBtn && !guestBtn.dataset.wiredWelcomeGuest) {
    guestBtn.addEventListener('click', hideWelcomeOverlay);
    guestBtn.dataset.wiredWelcomeGuest = 'true';
  }
}

/**
 * Dynamically create the welcome overlay modal if it doesn't exist.
 * This allows any page to use the sign-in modal without duplicating HTML.
 */
function ensureOverlayExists(opts) {
  if (document.getElementById('welcomeOverlay')) {
    wireOverlayControls();
    return;
  }

  const noteText = opts && opts.noteText
    ? opts.noteText
    : t().welcomeNote || 'Your details are only used to personalise the scheduling assistant.';

  const html = `
    <md-dialog id="welcomeOverlay" aria-labelledby="welcomeTitleId">
      <div slot="headline" class="welcome-headline">
        <div class="welcome-brand">
          <div class="welcome-avatar">AK</div>
          <div>
            <div class="welcome-title" id="welcomeTitleId">${t().welcomeTitle || "Abhinav's Portfolio"}</div>
            <div class="welcome-sub">${t().welcomeSub || 'Senior Salesforce & GenAI Application Engineer'}</div>
          </div>
        </div>
        <button type="button" class="welcome-close" id="welcomeCloseBtn" aria-label="Close">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <div slot="content" class="welcome-content">
        <div id="welcomeGoogleBtn" class="welcome-google-wrap"></div>
        <div class="welcome-sep"><span>${t().welcomeOr || 'or'}</span></div>
        <md-outlined-button id="welcomeGuestBtn" class="welcome-guest-btn">
          <span class="material-symbols-outlined" slot="icon" aria-hidden="true">schedule</span>
          <span>${t().welcomeGuestBtn || 'Maybe later'}</span>
        </md-outlined-button>
        <p class="welcome-note">
          <span class="material-symbols-outlined welcome-note-icon" aria-hidden="true">lock</span>
          <span>${noteText}</span>
        </p>
      </div>
    </md-dialog>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  wireOverlayControls();
}

export function showWelcomeOverlay(opts) {
  ensureOverlayExists(opts);
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;
  const onShown = (opts && opts.onShown) || null;
  function show() {
    // A defensive hideWelcomeOverlay() call earlier in the page lifecycle
    // (e.g. before <md-dialog> finished upgrading) may have fallen back to
    // setAttribute('hidden', '') instead of the native close(). That stale
    // attribute forces display:none and isn't cleared by show() itself, so
    // always remove it here regardless of which show path we take below.
    overlay.removeAttribute('hidden');
    if (typeof overlay.show === 'function') overlay.show();
    if (typeof onShown === 'function') {
      try { onShown(); } catch (_) {}
    }
  }
  // <md-dialog> may not be upgraded yet (ESM module loads async from CDN).
  if (customElements.get('md-dialog')) show();
  else customElements.whenDefined('md-dialog').then(show);
}

export function hideWelcomeOverlay() {
  const overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;
  if (typeof overlay.close === 'function') overlay.close();
  else overlay.setAttribute('hidden', '');
}

/* ── Welcome-Back Toast ──────────────────────────────────────
   Transient banner pinned top-right, auto-dismisses after 10s.
   Shows once per session to avoid being annoying on refresh.
─────────────────────────────────────────────────────────── */

function getInitials(fullName) {
  if (!fullName) return '?';
  const parts = String(fullName).trim().split(/\s+/);
  const first = parts[0] ? parts[0][0] : '';
  const last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function closeWelcomeToast() {
  const toast = document.getElementById('welcomeToast');
  if (!toast) return;
  toast.classList.remove('show');
  if (_welcomeToastTimer) { clearTimeout(_welcomeToastTimer); _welcomeToastTimer = null; }
  setTimeout(function () { toast.setAttribute('hidden', ''); }, 300);
}

export function showWelcomeToast(profile, opts) {
  if (!profile || !profile.name) return;
  opts = opts || {};

  // Show only once per browser-tab session unless explicitly forced
  // (forced = right after a fresh Google sign-in).
  if (!opts.force) {
    try {
      if (sessionStorage.getItem('welcome_toast_shown') === '1') return;
    } catch (_) {}
  }

  const toast    = document.getElementById('welcomeToast');
  const photoEl  = document.getElementById('welcomeToastPhoto');
  const titleEl  = document.getElementById('welcomeToastTitle');
  const nameEl   = document.getElementById('welcomeToastName');
  const closeEl  = document.getElementById('welcomeToastClose');
  if (!toast || !photoEl || !titleEl || !nameEl) return;

  const first = profile.name.split(' ')[0];
  titleEl.textContent = profile.isReturning ? t().toastWelcomeBack : t().toastWelcomeNew;
  nameEl.textContent  = first;

  photoEl.innerHTML = '';
  if (profile.picture) {
    const img = document.createElement('img');
    img.src = profile.picture;
    img.alt = first;
    img.referrerPolicy = 'no-referrer';
    img.onerror = function () { photoEl.textContent = getInitials(profile.name); };
    photoEl.appendChild(img);
  } else {
    photoEl.textContent = getInitials(profile.name);
  }

  if (closeEl && !closeEl._wired) {
    closeEl.addEventListener('click', closeWelcomeToast);
    closeEl._wired = true;
  }

  toast.removeAttribute('hidden');
  // Kick off the slide-in on the next frame so the transition runs
  requestAnimationFrame(function () { toast.classList.add('show'); });

  if (_welcomeToastTimer) clearTimeout(_welcomeToastTimer);
  _welcomeToastTimer = setTimeout(closeWelcomeToast, WELCOME_TOAST_TTL_MS);

  try { sessionStorage.setItem('welcome_toast_shown', '1'); } catch (_) {}
}
