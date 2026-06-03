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

import { t } from '../core/i18n.js';

// Open an <md-dialog>, waiting for the custom element to be upgraded
// (the @material/web ESM script loads asynchronously from CDN, so
// .show() may not yet exist on first render).
function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

export function openHireMe() {
  var overlay = document.getElementById('hireMeOverlay');
  if (!overlay) return;
  whenMdDialogReady(function () {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

export function closeHireMe() {
  var overlay = document.getElementById('hireMeOverlay');
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
  var lbl = document.getElementById('hm-submit-label');
  if (lbl) lbl.textContent = 'Send Message';
}

function setErr(fieldId, msg) {
  var field = document.getElementById(fieldId);
  if (!field) return;
  field.error = true;
  field.errorText = msg;
}

function clearErr(fieldId) {
  var field = document.getElementById(fieldId);
  if (!field) return;
  field.error = false;
  field.errorText = '';
}

function validate() {
  var name        = document.getElementById('hm-name').value.trim();
  var email       = document.getElementById('hm-email').value.trim();
  var company     = document.getElementById('hm-company').value.trim();
  var description = document.getElementById('hm-description').value.trim();
  var ok = true;
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
  var overlay = document.getElementById('hireMeOverlay');
  if (overlay) {
    // <md-dialog> handles outside-click (scrim) and Escape key natively.
    // Listen for its `close` event to clean up form state.
    overlay.addEventListener('close', resetHireForm);
  }

  var form = document.getElementById('hireMeForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validate()) return;

    var btn       = document.getElementById('hm-submit-btn');
    var btnLabel  = document.getElementById('hm-submit-label');
    var globalErr = document.getElementById('hm-global-error');
    btn.disabled = true;
    if (btnLabel) btnLabel.textContent = 'Sending\u2026';
    globalErr.hidden = true;

    var payload = {
      name:        document.getElementById('hm-name').value.trim(),
      email:       document.getElementById('hm-email').value.trim(),
      company:     document.getElementById('hm-company').value.trim(),
      description: document.getElementById('hm-description').value.trim(),
    };

    try {
      var res  = await fetch('/api/hire', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      var data = await res.json();
      if (res.ok && data.success) {
        document.getElementById('hireMeForm').hidden = true;
        var successTextEl = document.getElementById('hm-success-text');
        if (successTextEl) {
          successTextEl.textContent = data.alreadySubmitted
            ? "✓ You've already reached out — thanks! I'll get back to you within 1–2 business days."
            : "✓ Message sent! I'll be in touch soon.";
        }
        document.getElementById('hm-success').hidden = false;
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
