/**
 * Central state module — single source of truth for cross-cutting state
 * that used to live as IIFE closure variables in main.js.
 *
 * Why split: as we break up main.js into focused modules (auth, chat,
 * recommendations, refer, etc.), they all need to read and sometimes
 * mutate the signed-in profile, the Google credential, etc. Without a
 * shared module each extraction would have to either thread these
 * through arguments or add window.* exports. The state module makes
 * the cross-cutting bits explicit.
 *
 * Persistence layers:
 *   - sessionStorage: `siteProfile`, `googleCredential`. Survive reloads
 *     within the tab; cleared on tab close or sign-out.
 *   - in-memory only: `pendingChatHistory`, `myRecommendation`. They're
 *     recomputed from the server on every page load — no point
 *     persisting and risking staleness.
 *
 * Exports use ES module live bindings: any importer sees updates
 * whenever the setter is called. Writes MUST go through setters because
 * the ES module spec makes named imports read-only at the call site.
 */

// ── Persistence keys ─────────────────────────────────────────────────────────
// Centralised so sign-out cleanup (auth.js, once extracted) and tests can
// reference the same names without typos drifting apart.
export const STORAGE_PROFILE    = 'portfolio_profile';
export const STORAGE_CREDENTIAL = 'portfolio_credential';
export const STORAGE_TOAST_FLAG = 'welcome_toast_shown';
export const STORAGE_SIGNOUT_EVENT = 'portfolio_signout_event';

// ── siteProfile ──────────────────────────────────────────────────────────────
// The persisted snapshot of the signed-in (or guest) visitor. Shape:
//   { sub, name, email, picture, contact, isReturning?, visitCount?, ... }
// `null` when nothing has been persisted yet (very first visit).
// `{ type: 'guest' }` for anonymous browsing (see saveSiteProfile callers).
export let siteProfile = (function readInitialProfile() {
  try { return JSON.parse(sessionStorage.getItem(STORAGE_PROFILE) || 'null'); }
  catch (_) { return null; }
}());

export function setSiteProfile(p) {
  siteProfile = p;
  try {
    if (p) sessionStorage.setItem(STORAGE_PROFILE, JSON.stringify(p));
    else   sessionStorage.removeItem(STORAGE_PROFILE);
  } catch (_) {}
}

// ── googleCredential ─────────────────────────────────────────────────────────
// The raw Google ID token (1-hour validity). Stamped on every authedFetch
// as `Authorization: Bearer …`. Persisted in sessionStorage so a tab
// refresh doesn't bounce the user back to the sign-in overlay.
export let googleCredential = sessionStorage.getItem(STORAGE_CREDENTIAL) || null;

export function setGoogleCredential(token) {
  googleCredential = token || null;
  try {
    if (token) sessionStorage.setItem(STORAGE_CREDENTIAL, token);
    else       sessionStorage.removeItem(STORAGE_CREDENTIAL);
  } catch (_) {}
}

export function broadcastSignOut() {
  try {
    localStorage.setItem(STORAGE_SIGNOUT_EVENT, String(Date.now()));
  } catch (_) {}
}

export function onCrossTabSignOut(callback) {
  if (typeof callback !== 'function') return;
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_SIGNOUT_EVENT) return;
    callback();
  });
}

// ── pendingChatHistory (in-memory only) ──────────────────────────────────────
// Set by handleGoogleSignIn after fetching /api/chat/active, consumed by
// the chat module when the panel next opens so the conversation resumes
// from where the visitor left off.
export let pendingChatHistory = null;
export function setPendingChatHistory(h) { pendingChatHistory = h; }

// ── myRecommendation (in-memory only) ────────────────────────────────────────
// Recomputed on every refreshRecommendations() call by matching
// siteProfile.sub against the public list. Two consumers:
//   1. The recommendation card render path uses it to attach the kebab
//      menu (Edit/Delete) onto the visitor's own card.
//   2. updateRecommendationCta() hides the section-level "Leave a
//      Recommendation" CTA when this is set, so the kebab is the sole
//      management entry point and the CTA isn't redundant.
export let myRecommendation = null;
export function setMyRecommendation(r) { myRecommendation = r; }
