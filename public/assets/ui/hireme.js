/**
 * "Hire Me" modal — the contact form behind the primary CTA.
 *
 * POSTs to /api/hire which stores the lead in Firestore and pushes it to
 * Salesforce as a Lead. Validation is client-side first (cheap, immediate
 * feedback), but the server re-validates everything — never trust the
 * browser.
 *
 * Module shape:
 *   - `openHireMe()` / `closeHireMe()` — public API, also re-exported on
 *     `window` from main.js for the inline HTML close button.
 *   - `initHireMe()` — call once on boot from main.js to wire the form's
 *     submit and dialog `close` listeners.
 */

import { t, PAGE_LANG, currentLang } from '../core/i18n.js';

// Pull localized strings keyed by data-i18n. Falls back to English if the
// current language doesn't ship the key (defensive — every key we use here
// is defined in both en and fr at build time).
function dict() {
  return PAGE_LANG[currentLang] || PAGE_LANG.en;
}

// First-name extraction. The form's "Full Name" field accepts whatever the
// visitor types, so this is best-effort: take the first whitespace-bounded
// token. If empty (visitor left the field blank, somehow past validation),
// the success copy falls back to the un-personalised variant.
function firstNameOf(fullName) {
  if (!fullName) return '';
  const trimmed = String(fullName).trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

// Open an <md-dialog>, waiting for the custom element to be upgraded
// (the @material/web ESM script loads asynchronously from CDN, so
// .show() may not yet exist on first render).
function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

export function openHireMe() {
  const overlay = document.getElementById('hireMeOverlay');
  if (!overlay) return;
  whenMdDialogReady(function () {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

export function closeHireMe() {
  const overlay = document.getElementById('hireMeOverlay');
  if (typeof overlay.close === 'function') overlay.close();
  else overlay.setAttribute('hidden', '');
  resetHireForm();
}

function resetHireForm() {
  document.getElementById('hireMeForm').reset();
  ['hm-name', 'hm-email', 'hm-company', 'hm-description'].forEach(clearErr);
  document.getElementById('hm-global-error').hidden = true;
  document.getElementById('hm-success').hidden = true;
  document.getElementById('hireMeForm').hidden = false;
  document.getElementById('hm-submit-btn').disabled = false;
  const lbl = document.getElementById('hm-submit-label');
  if (lbl) lbl.textContent = 'Send Message';
  // Restore the dialog title — it gets swapped to "Message sent" /
  // "Already received" while the success state is showing, so reopening
  // the form (after a close) needs to flip it back to "Get In Touch".
  const titleEl = document.getElementById('hm-title-text');
  if (titleEl) titleEl.textContent = dict().getInTouch || 'Get In Touch';
}

/**
 * Render the success state in-place inside the dialog. Hides the form,
 * swaps the dialog title to match the new state, fills in the headline
 * + body copy (personalised with the visitor's first name when we have
 * one), and reveals the success block — the M3 empty-state-style layout
 * (icon → headline → body → primary action) is in the HTML and CSS.
 *
 * `alreadySubmitted` flips the copy to a softer "I have your message
 * already, hang tight" variant so we don't claim success for a no-op.
 */
function renderHireSuccess(opts) {
  const d = dict();
  const alreadySubmitted = !!(opts && opts.alreadySubmitted);
  const firstName = firstNameOf(opts && opts.fullName);

  // Pick the right headline + body keys for the state
  const titleText = alreadySubmitted
    ? (d.hireTitleAlready || 'Already received')
    : (d.hireTitleSent    || 'Message sent');
  const headlineText = alreadySubmitted
    ? (d.hireAlreadyHeadline || 'Already received')
    : (d.hireSuccessHeadline || 'Message sent');
  let bodyTpl;
  if (alreadySubmitted) {
    bodyTpl = firstName
      ? (d.hireAlreadyBodyNamed || d.hireAlreadyBody)
      : d.hireAlreadyBody;
  } else {
    bodyTpl = firstName
      ? (d.hireSuccessBodyNamed || d.hireSuccessBody)
      : d.hireSuccessBody;
  }
  // Token-replace once so we don't have to ship a templating dep.
  const bodyText = (bodyTpl || '').replace('{name}', firstName);

  const titleEl    = document.getElementById('hm-title-text');
  const headlineEl = document.getElementById('hm-success-headline');
  const bodyEl     = document.getElementById('hm-success-body');
  if (titleEl)    titleEl.textContent    = titleText;
  if (headlineEl) headlineEl.textContent = headlineText;
  if (bodyEl)     bodyEl.textContent     = bodyText;

  document.getElementById('hireMeForm').hidden = true;
  document.getElementById('hm-success').hidden = false;

  // Move keyboard focus to the primary action so Enter / Space dismisses
  // the dialog. Defer to the next tick so md-filled-button has had a
  // chance to upgrade.
  const doneBtn = document.getElementById('hm-success-done');
  if (doneBtn) setTimeout(function () { try { doneBtn.focus(); } catch (_) {} }, 0);
}

function setErr(fieldId, msg) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.error = true;
  field.errorText = msg;
}

function clearErr(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.error = false;
  field.errorText = '';
}

function validate() {
  const name        = document.getElementById('hm-name').value.trim();
  const email       = document.getElementById('hm-email').value.trim();
  const company     = document.getElementById('hm-company').value.trim();
  const description = document.getElementById('hm-description').value.trim();
  let ok = true;
  ['hm-name', 'hm-email', 'hm-company', 'hm-description'].forEach(clearErr);

  if (!name)    { setErr('hm-name', 'Full name is required.'); ok = false; }
  if (!email)   { setErr('hm-email', 'Work email is required.'); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setErr('hm-email', 'Enter a valid email address.'); ok = false;
  }
  if (!company) { setErr('hm-company', 'Company name is required.'); ok = false; }
  if (description.length > 255) {
    setErr('hm-description', 'Message must be 255 characters or fewer.');
    ok = false;
  }

  return ok;
}

export function initHireMe() {
  const overlay = document.getElementById('hireMeOverlay');
  if (overlay) {
    // <md-dialog> handles outside-click (scrim) and Escape key natively.
    // Listen for its `close` event to clean up form state.
    overlay.addEventListener('close', resetHireForm);
  }

  const form = document.getElementById('hireMeForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validate()) return;

    const btn       = document.getElementById('hm-submit-btn');
    const btnLabel  = document.getElementById('hm-submit-label');
    const globalErr = document.getElementById('hm-global-error');
    btn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Sending\u2026';
    globalErr.hidden = true;

    const payload = {
      name:        document.getElementById('hm-name').value.trim(),
      email:       document.getElementById('hm-email').value.trim(),
      company:     document.getElementById('hm-company').value.trim(),
      description: document.getElementById('hm-description').value.trim(),
    };

    try {
      const res  = await fetch('/api/hire', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        renderHireSuccess({
          alreadySubmitted: data.alreadySubmitted,
          fullName:         payload.name,
        });
      } else {
        globalErr.textContent = (data && data.error) || t().errors.generic;
        globalErr.hidden = false;
        btn.disabled = false;
        if (btnLabel) btnLabel.textContent = 'Send Message';
      }
    } catch (_) {
      globalErr.textContent = 'Network error. Please check your connection and try again.';
      globalErr.hidden = false;
      btn.disabled = false;
      if (btnLabel) btnLabel.textContent = 'Send Message';
    }
  });
}
