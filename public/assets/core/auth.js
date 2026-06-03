/**
 * Authentication primitives.
 *
 * What lives here:
 *   - `authedFetch(url, opts)` — fetch wrapper that stamps the cached
 *     Google ID token as `Authorization: Bearer …`. Returns null on
 *     missing credential or network error so callers can degrade
 *     gracefully without try/catch noise.
 *   - `applyContactPolicy(contact)` — applies the server's contact-reveal
 *     decision to the DOM. Privacy-sensitive: the phone number itself
 *     never enters the page until the server explicitly returns it
 *     (allow-listed verified domain); any other path keeps the masked
 *     placeholder.
 *   - `initGoogleSignIn({ clientId, onSignIn })` — initialises GIS and
 *     renders the button into the welcome overlay's slot. The sign-in
 *     callback is injected by main.js so this module stays free of
 *     orchestration concerns (chat reset, recommendation refresh, etc.).
 *
 * What does NOT live here:
 *   - `handleGoogleSignIn` and `signOut` orchestrators stay in main.js
 *     because they need to talk to the chat state machine and the
 *     recommendations module — both still living in the legacy IIFE.
 */

import { googleCredential } from './state.js';

export function authedFetch(url, opts) {
  opts = opts || {};
  if (!googleCredential) return Promise.resolve(null);
  var headers = Object.assign({}, opts.headers || {}, {
    'Authorization': 'Bearer ' + googleCredential,
    'Content-Type':  'application/json',
  });
  return fetch(url, Object.assign({}, opts, { headers: headers }))
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

/**
 * Apply the server's contact-reveal decision to the DOM.
 *
 * Privacy note: the phone number itself only enters the page when the
 * server explicitly returned it (i.e. the verified email matches an
 * allow-listed domain). Any other path keeps the masked placeholder.
 *
 * @param {{canSeePhone: boolean, phone: string|null, matchedDomain: string|null}|null|undefined} contact
 */
export function applyContactPolicy(contact) {
  var phoneRow   = document.getElementById('contactPhone');
  var phoneText  = document.getElementById('contactPhoneText');
  var phoneBadge = document.getElementById('contactPhoneBadge');
  if (!phoneRow || !phoneText) return;

  if (contact && contact.canSeePhone && contact.phone) {
    phoneText.textContent = contact.phone;
    phoneRow.setAttribute('href', 'tel:' + contact.phone.replace(/[^+\d]/g, ''));
    phoneRow.classList.add('contact-revealed');
    phoneRow.removeAttribute('aria-disabled');
    if (phoneBadge) {
      phoneBadge.textContent = 'Verified ' + contact.matchedDomain;
      phoneBadge.hidden = false;
    }
  } else {
    // Reset to the masked, non-clickable placeholder.
    phoneText.textContent = '+91-xxxxxxxxxx';
    phoneRow.removeAttribute('href');
    phoneRow.classList.remove('contact-revealed');
    phoneRow.setAttribute('aria-disabled', 'true');
    if (phoneBadge) phoneBadge.hidden = true;
  }
}

/**
 * Initialise Google Identity Services and render the sign-in button into
 * the welcome overlay's GIS slot. No-op if the OAuth client id is empty
 * or the GIS library hasn't loaded yet (caller should poll/retry).
 *
 * @param {Object} opts
 * @param {string} opts.clientId  — OAuth 2.0 Client ID from GCP Console
 * @param {Function} opts.onSignIn — called by GIS with `{ credential }`
 */
export function initGoogleSignIn(opts) {
  var clientId = opts && opts.clientId;
  var onSignIn = opts && opts.onSignIn;
  if (!clientId || !window.google) return;
  google.accounts.id.initialize({
    client_id: clientId,
    callback: onSignIn,
    auto_select: false,
    cancel_on_tap_outside: false,
  });
  // Render button in welcome overlay if shown
  var welcomeBtn = document.getElementById('welcomeGoogleBtn');
  if (welcomeBtn && welcomeBtn.childElementCount === 0) {
    google.accounts.id.renderButton(welcomeBtn, {
      theme: 'filled_black', size: 'large', text: 'continue_with',
      shape: 'rectangular', width: 280,
    });
  }
}
