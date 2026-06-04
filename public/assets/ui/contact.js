/**
 * Contact Info modal.
 *
 * The single hub for every channel a recruiter might want to reach me on:
 * email, phone (server-policy gated), LinkedIn, Trailblazer, and the
 * location row with its live IST clock + working-hours status. The
 * verification chips (LinkedIn / Trailblazer) stay inline in the hero
 * for at-a-glance social proof; the modal exists to make the channels
 * one-click copyable and to consolidate everything that the inline row
 * was carrying into a single, scannable stack.
 *
 * Module shape:
 *   - `openContactInfo()` / `closeContactInfo()` — public API, also
 *     re-exported on `window` from main.js for the inline HTML buttons.
 *   - `initContactInfo()` — call once on boot from main.js to wire up
 *     the copy buttons (delegated, so dynamically-revealed phone copy
 *     also works without re-binding).
 *
 * What does NOT live here:
 *   - The phone reveal logic. `applyContactPolicy()` in core/auth.js
 *     owns the "should the phone be visible?" decision; this module
 *     just listens for the resulting DOM mutations to flip the copy
 *     button visibility on/off.
 *   - The location time/day/status tick. `initLocationPopover()` in
 *     ui/location.js owns the per-minute refresh; the same ID hooks
 *     it used to write to inline now live inside this modal, so the
 *     module needs zero changes for that.
 */

// ── Dialog open/close ────────────────────────────────────────────────────────
// Mirrors the pattern used in ui/hireme.js and refer/refer.js: wait for the
// custom element to be upgraded before calling .show() / .close(), so the
// asynchronously-loaded @material/web ESM doesn't race the boot.
function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

export function openContactInfo() {
  var overlay = document.getElementById('contactInfoOverlay');
  if (!overlay) return;
  whenMdDialogReady(function () {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

export function closeContactInfo() {
  var overlay = document.getElementById('contactInfoOverlay');
  if (!overlay) return;
  if (typeof overlay.close === 'function') overlay.close();
  else overlay.setAttribute('hidden', '');
}

// ── Copy-to-clipboard ────────────────────────────────────────────────────────
// One delegated click handler on the modal so dynamically-shown buttons
// (the phone copy, which only appears once applyContactPolicy reveals
// the phone) just work without re-binding.
//
// Two value sources:
//   - data-copy-target="..."  → hard-coded copyable string in HTML
//   - id="contactPhoneCopyBtn" → reads from #contactPhoneText at click
//                                time, so we always copy the *current*
//                                rendered phone value (the masked
//                                placeholder is never copyable because
//                                the button stays hidden in that state).
function getCopyValue(btn) {
  var explicit = btn.getAttribute('data-copy-target');
  if (explicit) return explicit;
  if (btn.id === 'contactPhoneCopyBtn') {
    var phoneText = document.getElementById('contactPhoneText');
    return phoneText ? phoneText.textContent.trim() : '';
  }
  return '';
}

function copyToClipboard(text) {
  if (!text) return Promise.reject(new Error('empty'));
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts and ancient Safari. textarea must
  // be visible-ish to be selectable, so we hide it offscreen rather
  // than display:none which kills selection.
  return new Promise(function (resolve, reject) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand failed'));
    } catch (e) { reject(e); }
  });
}

// Transient toast inside the dialog. Single-instance — re-clicking
// resets the timer rather than stacking toasts.
var _toastTimer = null;
function showCopiedToast() {
  var toast = document.getElementById('contactInfoToast');
  if (!toast) return;
  toast.hidden = false;
  // Force a reflow before adding the visible class so the CSS transition
  // actually plays on rapid successive clicks.
  // eslint-disable-next-line no-unused-expressions
  toast.offsetHeight;
  toast.classList.add('is-visible');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () {
    toast.classList.remove('is-visible');
    // Wait for the fade-out before hiding so screen-readers don't
    // re-announce the visibility change mid-transition.
    setTimeout(function () { toast.hidden = true; }, 200);
  }, 1800);
}

export function initContactInfo() {
  var overlay = document.getElementById('contactInfoOverlay');
  if (!overlay) return;

  overlay.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.ci-action-btn[aria-label^="Copy"], .ci-action-btn[data-copy-target]');
    if (!btn) return;
    // The "open in new tab" buttons are <a> elements — they share the
    // .ci-action-btn class but should follow the link, not copy. The
    // selector above only matches buttons with a Copy aria-label or an
    // explicit data-copy-target, so this is already correct; the early
    // return below is a belt-and-braces guard for future markup.
    if (btn.tagName === 'A') return;
    var value = getCopyValue(btn);
    if (!value) return;
    e.preventDefault();
    copyToClipboard(value).then(showCopiedToast).catch(function () {
      // Silent failure is fine for a copy button — the recruiter can
      // still triple-click the visible value. Logging would be noise.
    });
  });
}
