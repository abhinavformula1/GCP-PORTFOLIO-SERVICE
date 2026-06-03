/**
 * "Refer Me" modal — pure client-side referral email builder.
 *
 * Renders an editable email template, supports copy-to-clipboard and a
 * `mailto:` launch for the visitor's default email client. No POST to
 * the backend, no rate limit, no Salesforce write — the visitor sends
 * from their own account, so we don't carry the abuse risk or
 * sender-verification overhead a server-side mailer would.
 *
 * Why no backend tracking? The Recommendations feature already carries
 * the SF-integration narrative (custom object + Apex REST + trigger +
 * callout). Forcing every UI feature through Salesforce dilutes that
 * story; this stays deliberately lean.
 *
 * Module shape:
 *   - `openReferMe()` / `closeReferMe()` — public API, re-exported on
 *     `window` from main.js for HTML inline handlers.
 *   - `initRefer()` — wires the copy + mailto buttons on boot.
 */

import { siteProfile } from '../core/state.js';

function getReferEmailSubject() {
  return 'Referral — Abhinav Kumar for Senior Salesforce Engineer';
}

/**
 * Canonical public URL of the deployed portfolio. Used in the Refer Me
 * email body so the link the recruiter sees is always one they can
 * actually open — even when the visitor is previewing the page on
 * localhost or a private IP.
 *
 * Update this if you ever point a custom domain at the Cloud Run service.
 */
var PORTFOLIO_PUBLIC_URL = 'https://portfolio-service-647206478056.asia-southeast1.run.app';

/**
 * Resolve the URL to embed in the email body.
 *
 * On a real public origin (e.g. the Cloud Run hostname or a custom
 * domain) we just use what the visitor is looking at — keeps things in
 * sync if you rename the service or move to a custom domain. On
 * localhost / private network ranges / file:// we fall back to the
 * canonical public URL, otherwise the recipient's inbox renders an
 * unreachable link.
 */
function getPortfolioPublicUrl() {
  var origin = (window.location && window.location.origin) || '';
  var isUnreachable = !origin
    || /^https?:\/\/(localhost|127\.|192\.168\.|10\.|0\.0\.0\.0)/.test(origin)
    || origin.indexOf('file://') === 0;
  return isUnreachable ? PORTFOLIO_PUBLIC_URL : origin;
}

/**
 * Build the default email body. Two pieces of personalisation:
 *
 *   1. The portfolio URL is resolved via getPortfolioPublicUrl() — never
 *      a localhost / private-net link in the rendered template. The
 *      portfolio page itself has the "Download Resume" button right in
 *      the hero, so we don't include a separate resume link in the email.
 *   2. The signer name (the closing "Best, …") auto-fills from the
 *      cached Google profile when the visitor is signed in. Falls back
 *      to the {{your name}} placeholder for guests / signed-out users
 *      so they can swap in their own name inline before sending.
 *
 * The {{their first name}} placeholder stays unfilled — that's the
 * recruiter on the receiving end, which the referrer needs to type in
 * themselves.
 */
function getReferEmailBody() {
  var origin = getPortfolioPublicUrl();
  var signerName = (siteProfile && siteProfile.type !== 'guest' && siteProfile.name)
    ? siteProfile.name
    : '{{your name}}';
  return [
    'Hi {{their first name}},',
    '',
    "I came across Abhinav Kumar's portfolio and thought he'd be a strong",
    'fit for a Senior Salesforce Engineer role on your team. He has 12+',
    'years of depth across Apex, LWC, OmniStudio, and CPQ, with production',
    'work at Salesforce, TCS, Cognizant, and Mindtree.',
    '',
    'Portfolio with project breakdowns, recommendations, and a one-click',
    'resume download:',
    '  ' + origin,
    '',
    "If there's a fit, you can reach him directly at:",
    '  abhinavformula1@gmail.com',
    '',
    'Best,',
    signerName,
  ].join('\n');
}

export function openReferMe() {
  var overlay = document.getElementById('referMeOverlay');
  if (!overlay) return;
  // Wait for both the dialog AND the inner text fields to upgrade before
  // setting .value — M3 components can drop early property writes if the
  // ESM bundle hasn't registered the custom element yet.
  Promise.all([
    customElements.whenDefined('md-dialog'),
    customElements.whenDefined('md-outlined-text-field'),
  ]).then(function () {
    var subjectEl = document.getElementById('refer-subject');
    var bodyEl    = document.getElementById('refer-body');
    if (subjectEl) subjectEl.value = getReferEmailSubject();
    if (bodyEl)    bodyEl.value    = getReferEmailBody();
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

export function closeReferMe() {
  var overlay = document.getElementById('referMeOverlay');
  if (!overlay) return;
  if (typeof overlay.close === 'function') overlay.close();
  else overlay.setAttribute('hidden', '');
}

// Compose the canonical "Subject: ...\n\nBody" string used by both the
// clipboard path and as the source-of-truth render of the user's edits.
function buildReferComposed() {
  var subjectEl = document.getElementById('refer-subject');
  var bodyEl    = document.getElementById('refer-body');
  var subject = (subjectEl && subjectEl.value) || getReferEmailSubject();
  var body    = (bodyEl && bodyEl.value)       || getReferEmailBody();
  return { subject: subject, body: body, combined: 'Subject: ' + subject + '\n\n' + body };
}

// Flash a transient label change on the copy button. Cheap, no toast
// infrastructure needed.
function flashCopyLabel(msg) {
  var labelEl = document.getElementById('refer-copy-label');
  if (!labelEl) return;
  if (labelEl._restoreTimer) clearTimeout(labelEl._restoreTimer);
  var prev = labelEl._originalText || labelEl.textContent;
  labelEl._originalText = prev;
  labelEl.textContent = msg;
  labelEl._restoreTimer = setTimeout(function () {
    labelEl.textContent = labelEl._originalText;
  }, 1800);
}

function handleReferCopy() {
  var msg = buildReferComposed().combined;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(msg)
      .then(function () { flashCopyLabel('Copied \u2713'); })
      .catch(function () { fallbackCopy(msg); });
  } else {
    fallbackCopy(msg);
  }
}

// Legacy fallback for browsers where the async clipboard API is blocked
// (older Safari/WebViews, restricted iframes). Synchronous execCommand
// still works there.
function fallbackCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity  = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    flashCopyLabel(ok ? 'Copied \u2713' : 'Copy failed');
  } catch (_) {
    flashCopyLabel('Copy failed');
  }
}

function handleReferMailto() {
  var c = buildReferComposed();
  // mailto:?subject=...&body=... — recipient is intentionally left empty
  // so the visitor types the recruiter's address into their own email
  // client. Body is URL-encoded so newlines survive into Gmail / Outlook
  // / Apple Mail.
  var href = 'mailto:?subject=' + encodeURIComponent(c.subject)
           + '&body='          + encodeURIComponent(c.body);
  // Most browsers cap mailto: URLs ~2 KB. Our default body is ~600 chars,
  // so we're comfortably under. If the visitor edits heavily and overflows,
  // the Copy button is the always-works fallback.
  window.location.href = href;
}

export function initRefer() {
  // Wire the action buttons once their custom elements have upgraded.
  // We guard with `_wired` so re-opening the dialog doesn't stack listeners.
  customElements.whenDefined('md-filled-button').then(function () {
    var btn = document.getElementById('refer-copy-btn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleReferCopy);
    }
  });
  customElements.whenDefined('md-outlined-button').then(function () {
    var btn = document.getElementById('refer-mailto-btn');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleReferMailto);
    }
  });
}
