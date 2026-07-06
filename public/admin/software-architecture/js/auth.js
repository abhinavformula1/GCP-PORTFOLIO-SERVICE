/**
 * Authentication — Google Sign-In, session lifecycle, avatar loading.
 *
 * S — all auth concerns live here; no article/media/config logic.
 * D — depends on state, http, shared UI modules; never on feature modules.
 *     The one exception is `onSessionReady` callback injected at init time
 *     (DIP: caller decides what to do after sign-in, not this module).
 */

import { GOOGLE_CLIENT_ID } from '../../../assets/core/config.js';
import {
  STORAGE_CREDENTIAL,
  STORAGE_PROFILE,
  googleCredential,
  broadcastSignOut,
  setGoogleCredential,
  setSiteProfile,
} from '../../../assets/core/state.js';
import { hideWelcomeOverlay } from '../../../assets/ui/welcome.js';
import { state } from './state.js';
import { setStatus } from './http.js';

const ADMIN_HANDOFF_KEY = 'portfolio_admin_handoff';

/** Callback injected by admin.js so auth never imports feature modules. */
let _onSessionReady = null;
let _onSessionReset = null;

export function initAuth({ onSessionReady, onSessionReset }) {
  _onSessionReady = onSessionReady;
  _onSessionReset = onSessionReset;

  // Restore credential from handoff key (cross-tab redirect).
  const handoff = readAdminHandoffCredential();
  if (handoff) state.credential = handoff;
  else if (googleCredential) state.credential = googleCredential;
}

export function readAdminHandoffCredential() {
  try {
    const raw = localStorage.getItem(ADMIN_HANDOFF_KEY);
    if (!raw) return '';
    localStorage.removeItem(ADMIN_HANDOFF_KEY);
    const handoff = JSON.parse(raw);
    if (!handoff || Number(handoff.expiresAt || 0) < Date.now()) return '';
    if (handoff.credential) {
      setGoogleCredential(handoff.credential);
      return handoff.credential;
    }
  } catch (_) {}
  return '';
}

export function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1] || '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (_) {
    return {};
  }
}

export function profileFromCredential(token) {
  const payload = decodeJwtPayload(token);
  return { sub: payload.sub, name: payload.name, email: payload.email, picture: payload.picture };
}

function saveSharedSession(token) {
  const profile = profileFromCredential(token);
  setGoogleCredential(token);
  setSiteProfile({ sub: profile.sub, name: profile.name, email: profile.email });
  return profile;
}

export function isTrustedGoogleProfilePhoto(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('googleusercontent.com');
  } catch (_) { return false; }
}

export function safeDisplayName(profile) {
  const raw = String(profile?.name || profile?.email || 'Admin').trim();
  return raw.replace(/[<>]/g, '').slice(0, 80) || 'Admin';
}

export function initialsFor(profile) {
  const display = safeDisplayName(profile);
  const parts = display.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'A';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase().slice(0, 2);
}

export function updateAdminChrome(profile) {
  const els = _getEls();
  const signedIn = !!profile;
  if (els.topbarSignIn) els.topbarSignIn.hidden = signedIn;
  if (els.topbarUser)   els.topbarUser.hidden   = !signedIn;
  if (els.signOut)      els.signOut.hidden       = !signedIn;
  if (!signedIn) {
    if (els.userName)   els.userName.textContent = '';
    if (els.avatarBtn)  delete els.avatarBtn.dataset.initials;
    clearAdminAvatarPhoto();
    if (els.userPhoto)  els.userPhoto.alt = 'Signed-in admin profile photo';
    return;
  }
  const displayName = safeDisplayName(profile);
  if (els.userName)  els.userName.textContent = displayName;
  if (els.avatarBtn) els.avatarBtn.dataset.initials = initialsFor(profile);
  if (!profile.verified) clearAdminAvatarPhoto();
  if (els.userPhoto) els.userPhoto.alt = displayName + ' profile';
}

export function clearAdminAvatarPhoto() {
  if (state.adminAvatarObjectUrl) {
    URL.revokeObjectURL(state.adminAvatarObjectUrl);
    state.adminAvatarObjectUrl = '';
  }
  const els = _getEls();
  if (els.userPhoto) els.userPhoto.removeAttribute('src');
  if (els.avatarBtn) delete els.avatarBtn.dataset.hasPhoto;
}

export async function loadAdminAvatarPhoto(photoUrl) {
  if (!isTrustedGoogleProfilePhoto(photoUrl)) return;
  const resp = await fetch(photoUrl, { referrerPolicy: 'no-referrer' });
  if (!resp.ok) return;
  const type = resp.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return;
  const blob = await resp.blob();
  clearAdminAvatarPhoto();
  state.adminAvatarObjectUrl = URL.createObjectURL(blob);
  const els = _getEls();
  if (els.userPhoto) els.userPhoto.src = state.adminAvatarObjectUrl;
  if (els.avatarBtn) els.avatarBtn.dataset.hasPhoto = 'true';
}

async function verifySharedSession(token) {
  const resp = await fetch('/api/session/start', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ credential: token }),
  });
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || data.success === false) throw new Error(data.error || data.message || 'Session verification failed.');
  const verifiedProfile = {
    sub:      data.sub,
    name:     data.name,
    email:    data.email,
    picture:  isTrustedGoogleProfilePhoto(data.picture) ? data.picture : '',
    verified: true,
  };
  setSiteProfile(verifiedProfile);
  return verifiedProfile;
}

export function syncAdminCredentialToWindow() {
  window.__adminCredential = state.credential;
}

export function resetAdminSession() {
  state.credential = '';
  syncAdminCredentialToWindow();
  setGoogleCredential(null);
  setSiteProfile(null);
  sessionStorage.removeItem(STORAGE_CREDENTIAL);
  sessionStorage.removeItem(STORAGE_PROFILE);
  // Hide all workspaces — injected via onSessionReset callback.
  if (_onSessionReset) _onSessionReset();
  updateAdminChrome(null);
}

export function signOutAdmin(opts) {
  resetAdminSession();
  setStatus('', 'info');
  if ((opts || {}).broadcast !== false) broadcastSignOut();
}

export async function startAdminSession(token) {
  state.credential = token || '';
  syncAdminCredentialToWindow();
  saveSharedSession(state.credential);
  updateAdminChrome(profileFromCredential(state.credential));
  try {
    const verifiedProfile = await verifySharedSession(state.credential);
    updateAdminChrome(verifiedProfile);
    await loadAdminAvatarPhoto(verifiedProfile.picture);
  } catch (_) {
    setStatus('Verified profile photo is unavailable. Using initials.', 'info');
  }
  if (_onSessionReady) await _onSessionReady();
}

export async function startLocalAdminPreview() {
  const resp = await fetch('/api/local-preview');
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || !data.enabled) return false;
  state.credential = 'local-admin-preview';
  syncAdminCredentialToWindow();
  const profile = { sub: 'local-admin-preview', name: 'Local Admin Preview', email: 'local-admin@localhost' };
  setGoogleCredential(state.credential);
  setSiteProfile(profile);
  updateAdminChrome(profile);
  if (_onSessionReady) await _onSessionReady();
  return true;
}

export function handleAdminLoadError(err) {
  // Hide workspaces — delegate to reset callback.
  if (_onSessionReset) _onSessionReset();
  if (err?.status === 401 || err?.status === 403) {
    const attempted = (function () {
      try { return String(profileFromCredential(state.credential || '').email || '').trim(); } catch (_) { return ''; }
    })();
    resetAdminSession();
    if (err?.status === 403) {
      setStatus(
        attempted
          ? 'Signed in as ' + attempted + ', but this account is not allowed to access the admin CMS.'
          : 'This account is not allowed to access the admin CMS.',
        'error'
      );
    } else {
      setStatus('Your session expired. Please sign in again.', 'warning');
    }
    const authWall = document.getElementById('adminAuthWall');
    if (authWall) {
      authWall.hidden = false;
      document.body.dataset.authwall = '1';
    }
    return;
  }
  setStatus(err.message, 'error');
}

export function initGoogle(els) {
  if (!GOOGLE_CLIENT_ID) { setStatus('Google Sign-In is not configured.', 'error'); return; }
  if (!globalThis.google?.accounts) { setTimeout(function () { initGoogle(els); }, 200); return; }
  google.accounts.id.initialize({
    client_id:             GOOGLE_CLIENT_ID,
    callback:              function (resp) {
      hideWelcomeOverlay();
      startAdminSession(resp.credential || '').catch(handleAdminLoadError);
    },
    ux_mode:               'popup',
    use_fedcm_for_prompt:  true,
    use_fedcm_for_button:  true,
  });
  if (els && els.welcomeGoogle) {
    renderGoogleButtonRobust(els.welcomeGoogle, { text: 'continue_with', shape: 'pill' });
  }
  const authWallBtn = document.getElementById('authWallGoogleBtn');
  if (authWallBtn && authWallBtn.childElementCount === 0) {
    google.accounts.id.renderButton(authWallBtn, {
      theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280,
    });
  }
  if (state.credential) {
    startAdminSession(state.credential).catch(handleAdminLoadError);
  } else {
    updateAdminChrome(null);
  }
}

/**
 * Google's button takes a fixed pixel width — measure the actual container
 * so it lines up exactly with sibling buttons instead of a hardcoded guess
 * that can drift out of sync with the card's padding/max-width (Google
 * clamps to 200–400px).
 *
 * A single requestAnimationFrame right after <md-dialog>.show() isn't
 * always enough: clientWidth can still read 0 on that frame (the dialog's
 * open animation hasn't committed layout yet), silently falling back to a
 * guessed width that leaves the wrapper's own border pill visibly wider
 * than Google's actual rendered button — a "pill behind the pill" look.
 * ResizeObserver removes the guesswork: it fires the moment the
 * container's real box is known, however many frames that takes, and
 * again if it ever changes (e.g. viewport resize), so the button is
 * re-rendered at the correct width instead of a stale guess.
 */
function renderGoogleButtonRobust(container, opts) {
  if (container._gsiResizeObserver) return; // already wired up once
  let lastWidth = 0;
  const render = function () {
    const measured = Math.round(container.clientWidth);
    if (!measured || Math.abs(measured - lastWidth) < 2) return;
    lastWidth = measured;
    const width = Math.min(400, Math.max(200, measured));
    container.innerHTML = '';
    google.accounts.id.renderButton(container, Object.assign({
      theme: 'outline', size: 'large', width,
    }, opts));
  };
  if (typeof ResizeObserver === 'function') {
    container._gsiResizeObserver = new ResizeObserver(render);
    container._gsiResizeObserver.observe(container);
  } else {
    requestAnimationFrame(render);
  }
}

// onCrossTabSignOut is imported from assets/core/state.js and re-exported
// so admin.js (entry point) can use it without importing assets/core/state.js.
export { onCrossTabSignOut } from '../../../assets/core/state.js';

// ── Internal ──────────────────────────────────────────────────────────────────
// Lazy accessor so auth.js doesn't hard-import els.js at module parse time
// (avoids a parse-order dependency).
let _els = null;
function _getEls() {
  if (!_els) _els = /** @type {any} */ (window.__adminEls || {});
  return _els;
}
