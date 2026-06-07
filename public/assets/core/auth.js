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
  const headers = Object.assign({}, opts.headers || {}, {
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
 * allow-listed domain). Any other path keeps the masked placeholder
 * and keeps the copy-to-clipboard button hidden — there's no point
 * letting visitors copy `+91-xxxxxxxxxx`.
 *
 * The phone elements now live inside the Contact Info <md-dialog>
 * (used to be inline in the hero header), but the IDs are unchanged so
 * this function continues to be a pure DOM mutation with no knowledge
 * of where its targets render.
 *
 * @param {{canSeePhone: boolean, phone: string|null, matchedDomain: string|null}|null|undefined} contact
 */
export function applyContactPolicy(contact) {
  const phoneRow   = document.getElementById('contactPhone');
  const phoneText  = document.getElementById('contactPhoneText');
  const phoneBadge = document.getElementById('contactPhoneBadge');
  const phoneHint  = document.getElementById('contactPhoneHint');
  const phoneCopy  = document.getElementById('contactPhoneCopyBtn');
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
    // The "visible after sign-in…" hint becomes redundant noise once the
    // number is actually showing — collapse it.
    if (phoneHint) phoneHint.hidden = true;
    if (phoneCopy) phoneCopy.hidden = false;
  } else {
    phoneText.textContent = '+91-xxxxxxxxxx';
    phoneRow.removeAttribute('href');
    phoneRow.classList.remove('contact-revealed');
    phoneRow.setAttribute('aria-disabled', 'true');
    if (phoneBadge) phoneBadge.hidden = true;
    if (phoneHint) phoneHint.hidden = false;
    if (phoneCopy) phoneCopy.hidden = true;
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
  const clientId = opts && opts.clientId;
  const onSignIn = opts && opts.onSignIn;
  if (!clientId || !window.google) return;
  google.accounts.id.initialize({
    client_id: clientId,
    callback: onSignIn,
    auto_select: false,
    cancel_on_tap_outside: false,
    // Use Chrome's FedCM (Federated Credential Management) API for both
    // One Tap and the rendered "Sign in with Google" button. With FedCM
    // the account chooser becomes a native browser overlay — no popup,
    // no new tab, no dependency on third-party cookies. This matters
    // especially on `*.run.app` (the Cloud Run default domain), which
    // is on the Public Suffix List and so triggers Chrome's strict
    // third-party storage partitioning.
    //
    // Without these flags, visitors with multiple Google sessions get
    // redirected to accounts.google.com in a new tab to resolve the
    // ambiguity — visually breaking the "click button, instantly
    // signed in" promise of the welcome card.
    use_fedcm_for_prompt: true,
    use_fedcm_for_button: true,
    // Popup mode (default) keeps the current tab; explicit so we don't
    // accidentally inherit a redirect mode if the GSI default ever
    // changes upstream.
    ux_mode: 'popup',
    // Safari ITP storage-access workaround. No effect on Chrome but
    // saves a separate browser-specific debugging session if the
    // resume ever ships to a Safari recruiter.
    itp_support: true,
  });
  // Render button in welcome overlay if shown
  const welcomeBtn = document.getElementById('welcomeGoogleBtn');
  if (welcomeBtn && welcomeBtn.childElementCount === 0) {
    google.accounts.id.renderButton(welcomeBtn, {
      theme: 'filled_black', size: 'large', text: 'continue_with',
      shape: 'rectangular', width: 280,
    });
  }
}
