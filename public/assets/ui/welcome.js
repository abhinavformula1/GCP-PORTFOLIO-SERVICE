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

var WELCOME_TOAST_TTL_MS = 10000;
var _welcomeToastTimer = null;

export function showWelcomeOverlay(opts) {
  var overlay = document.getElementById('welcomeOverlay');
  if (!overlay) return;
  var onShown = (opts && opts.onShown) || null;
  function show() {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
    if (typeof onShown === 'function') {
      try { onShown(); } catch (_) {}
    }
  }
  // <md-dialog> may not be upgraded yet (ESM module loads async from CDN).
  if (customElements.get('md-dialog')) show();
  else customElements.whenDefined('md-dialog').then(show);
}

export function hideWelcomeOverlay() {
  var overlay = document.getElementById('welcomeOverlay');
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
  var parts = String(fullName).trim().split(/\s+/);
  var first = parts[0] ? parts[0][0] : '';
  var last  = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

export function closeWelcomeToast() {
  var toast = document.getElementById('welcomeToast');
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

  var toast    = document.getElementById('welcomeToast');
  var photoEl  = document.getElementById('welcomeToastPhoto');
  var titleEl  = document.getElementById('welcomeToastTitle');
  var nameEl   = document.getElementById('welcomeToastName');
  var closeEl  = document.getElementById('welcomeToastClose');
  if (!toast || !photoEl || !titleEl || !nameEl) return;

  var first = profile.name.split(' ')[0];
  titleEl.textContent = profile.isReturning ? t().toastWelcomeBack : t().toastWelcomeNew;
  nameEl.textContent  = first;

  photoEl.innerHTML = '';
  if (profile.picture) {
    var img = document.createElement('img');
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
