/**
 * Recommendations section — public list + "Leave a Recommendation" modal.
 *
 * Three concerns colocated:
 *   1. RENDER   — fetch /api/recommendations on load, hydrate cards. Cards
 *                 show the original timestamp normally, but flip to
 *                 "Updated <time>" if the edit landed > 60s after the
 *                 original write. Replies (set by Salesforce → GCP
 *                 callback) render as a styled child block.
 *   2. GATE     — "Leave a Recommendation" CTA only opens the modal for
 *                 Google-signed-in users; otherwise it routes them
 *                 through the welcome overlay so we collect a credential.
 *                 The CTA itself flips between "Leave" / "Edit" based on
 *                 whether the visitor already has a doc keyed by their
 *                 Google sub.
 *   3. SUBMIT   — POST to /api/recommendation with the cached Google
 *                 credential as Bearer. The endpoint UPSERTs by sub, so
 *                 the same handler covers both new and edit. On success
 *                 we cache-bust the list (the public read model has a
 *                 30s s-maxage for everyone else) and scroll the user to
 *                 their freshly-rendered card — that card is the
 *                 confirmation, no banner needed.
 *
 * Module shape:
 *   - `initRecommendations()` — boot: initial fetch, visibilitychange
 *     re-fetch, form submit + dialog close listeners.
 *   - `refreshRecommendations(opts)` — exported because main.js needs
 *     to re-fetch from `handleGoogleSignIn` once the visitor's sub is
 *     known (so the CTA can flip to "Edit" if they've posted before).
 *   - `updateRecommendationCta()` — exported because `signOut` flips
 *     `myRecommendation` to null and needs the CTA label to follow.
 *   - `openLeaveRecommendation` / `closeLeaveRecommendation` — public
 *     so main.js can re-export onto `window` for the inline HTML
 *     onclick="…" handlers.
 */

import {
  siteProfile,
  googleCredential, setGoogleCredential,
  myRecommendation, setMyRecommendation,
} from '../core/state.js';
import { PAGE_LANG, currentLang } from '../core/i18n.js';

// ── Local DOM helpers ─────────────────────────────────────────────
// Duplicated from ui/hireme.js because moving them to a shared
// `ui/dom.js` would introduce a cross-module dependency for ~10 lines
// of utility code. If a third module ever needs them, refactor then.

function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
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

// ── Render ────────────────────────────────────────────────────────

function renderRecommendation(item) {
  var card = document.createElement('article');
  card.className = 'reco-card';
  card.setAttribute('data-uid', item.id);

  var header = document.createElement('header');
  header.className = 'reco-card-header';

  if (item.avatarUrl) {
    var img = document.createElement('img');
    img.className = 'reco-avatar';
    img.src   = item.avatarUrl;
    img.alt   = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    header.appendChild(img);
  } else {
    var initials = document.createElement('div');
    initials.className = 'reco-avatar reco-avatar-initials';
    initials.textContent = (item.name || '?').slice(0, 1).toUpperCase();
    header.appendChild(initials);
  }

  var who = document.createElement('div');
  who.className = 'reco-who';
  var nameEl = document.createElement('div');
  nameEl.className = 'reco-name';
  nameEl.textContent = item.name || 'Anonymous';
  var compEl = document.createElement('div');
  compEl.className = 'reco-company';
  compEl.textContent = item.company || '';
  who.appendChild(nameEl);
  if (item.company) who.appendChild(compEl);
  header.appendChild(who);

  // Pick the timestamp to render. If the recommendation has been edited
  // since first submission, show the edit time prefixed with "Updated"
  // so it doesn't look stale. The 60s tolerance avoids flagging the
  // trivial submittedAt/updatedAt skew that exists on the very first
  // write (Firestore server-timestamps land a few ms apart).
  var when = document.createElement('time');
  when.className = 'reco-when';
  var displayMs    = item.submittedAt;
  var displayLabel = '';
  if (item.updatedAt && item.submittedAt &&
      (item.updatedAt - item.submittedAt) > 60 * 1000) {
    displayMs    = item.updatedAt;
    displayLabel = 'Updated ';
  }
  when.textContent = displayLabel + formatRecoTimestamp(displayMs);
  if (displayMs) when.dateTime = new Date(displayMs).toISOString();
  header.appendChild(when);

  card.appendChild(header);

  var text = document.createElement('p');
  text.className = 'reco-text';
  text.textContent = item.text || '';
  card.appendChild(text);

  // Reply (only if Abhinav has replied — flowed in via SF → GCP callback)
  if (item.reply) {
    var reply = document.createElement('div');
    reply.className = 'reco-reply';

    var replyHead = document.createElement('div');
    replyHead.className = 'reco-reply-head';
    var icon = document.createElement('span');
    icon.className = 'material-symbols-outlined reco-reply-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'reply';
    replyHead.appendChild(icon);
    var replyAuthor = document.createElement('span');
    replyAuthor.className = 'reco-reply-author';
    replyAuthor.textContent = 'Abhinav';
    replyHead.appendChild(replyAuthor);
    if (item.repliedAt) {
      var replyWhen = document.createElement('time');
      replyWhen.className = 'reco-reply-when';
      replyWhen.textContent = formatRecoTimestamp(item.repliedAt);
      replyWhen.dateTime = new Date(item.repliedAt).toISOString();
      replyHead.appendChild(replyWhen);
    }
    reply.appendChild(replyHead);

    var replyText = document.createElement('p');
    replyText.className = 'reco-reply-text';
    replyText.textContent = item.reply;
    reply.appendChild(replyText);

    card.appendChild(reply);
  }

  return card;
}

// Friendly relative-time. "just now" / "5m" / "3h" / "2d" / "Jan 12".
function formatRecoTimestamp(ms) {
  if (!ms) return '';
  var diff = Date.now() - ms;
  if (diff < 60 * 1000)             return 'just now';
  if (diff < 60 * 60 * 1000)        return Math.floor(diff / 60000) + 'm';
  if (diff < 24 * 60 * 60 * 1000)   return Math.floor(diff / 3600000) + 'h';
  if (diff < 7  * 24 * 60 * 60 * 1000) return Math.floor(diff / 86400000) + 'd';
  var d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Re-fetch the recommendation list and re-render the grid.
 *
 * The endpoint sets a 30-second public + CDN cache so a recruiter
 * refreshing the page doesn't hammer Firestore. That cache is the
 * right default for passive page loads — but it's wrong for the
 * RIGHT-AFTER-SUBMIT call, where the user expects to see their
 * own card immediately.
 *
 * Pass `{ bustCache: true }` from the post-submit path to skip both
 * browser and CDN caches via a unique query string. Other callers
 * (initial page load, visibilitychange) get the cached path so the
 * cache still does its job for everyone else.
 */
export function refreshRecommendations(opts) {
  opts = opts || {};
  var grid  = document.getElementById('recosGrid');
  var empty = document.getElementById('recosEmpty');
  if (!grid) return;
  var url = '/api/recommendations';
  if (opts.bustCache) url += '?_=' + Date.now();
  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !Array.isArray(data.recommendations)) return;

      // Find the visitor's own recommendation (if any) by matching their
      // Google sub against the public list's id field. Doing this here —
      // inside the success handler — keeps the CTA in sync with whatever
      // the server believes is currently active, including replies that
      // landed while we were on another tab.
      var mySub = (siteProfile && siteProfile.sub) || null;
      setMyRecommendation(mySub
        ? (data.recommendations.find(function (it) { return it.id === mySub; }) || null)
        : null);
      updateRecommendationCta();

      grid.innerHTML = '';
      if (data.recommendations.length === 0) {
        if (empty) empty.hidden = false;
        return;
      }
      if (empty) empty.hidden = true;
      data.recommendations.forEach(function (item) {
        grid.appendChild(renderRecommendation(item));
      });
    })
    .catch(function () { /* silent — section just stays empty */ });
}

/**
 * Re-renders the section CTA based on whether the visitor already has
 * an active recommendation. We swap the data-i18n key so a later
 * language toggle still picks up the right localized copy, AND we set
 * textContent immediately for the current language. Icon ligature is
 * also flipped for visual reinforcement.
 */
export function updateRecommendationCta() {
  var btn = document.getElementById('recosCtaBtn');
  if (!btn) return;
  var labelEl = btn.querySelector('[data-i18n]');
  var iconEl  = btn.querySelector('[slot="icon"]');
  var key     = myRecommendation ? 'recoCtaEdit' : 'recoCta';
  if (labelEl) {
    labelEl.setAttribute('data-i18n', key);
    var d = PAGE_LANG[currentLang] || PAGE_LANG.en;
    if (d[key]) labelEl.textContent = d[key];
  }
  if (iconEl) iconEl.textContent = myRecommendation ? 'edit' : 'rate_review';
}

// ── Gate the CTA on Google sign-in state ──────────────────────────
function isSignedIn() { return !!googleCredential; }

export function openLeaveRecommendation() {
  if (!isSignedIn()) {
    // Not signed in — redirect them through the existing welcome flow.
    // It already handles Google Sign-In + remembers them, so by the time
    // they come back to click the CTA we'll have a credential cached.
    var welcome = document.getElementById('welcomeOverlay');
    if (welcome && typeof welcome.show === 'function') {
      welcome.show();
      return;
    }
    alert('Please sign in with Google first to leave a recommendation.');
    return;
  }

  // Hydrate the identity preview from cached profile so the user sees
  // exactly what their card will look like before they hit submit.
  var profile = siteProfile || {};
  var avatar = document.getElementById('lr-avatar');
  var name   = document.getElementById('lr-name');
  var comp   = document.getElementById('lr-company');
  if (avatar && profile.picture) avatar.src = profile.picture;
  if (avatar) avatar.alt = profile.name || '';
  if (name)   name.textContent = profile.name || '';
  if (comp)   comp.textContent = (profile.email || '').split('@')[1] || '';

  // Edit-vs-new mode. The data layer is already idempotent on Google UID
  // (POST /api/recommendation upserts the same Firestore doc and the same
  // SF Testimonial__c via External Id), so all we have to flip on the
  // client is the modal chrome + textarea contents. The submit handler
  // doesn't need to know whether it's an edit — it sends the same
  // payload either way and the server figures out isNew.
  var titleEl = document.getElementById('lr-title-text');
  var lblEl   = document.getElementById('lr-submit-label');
  var textEl  = document.getElementById('lr-text');
  var d       = PAGE_LANG[currentLang] || PAGE_LANG.en;
  var isEdit  = !!myRecommendation;

  if (titleEl) titleEl.textContent = isEdit
    ? (d.recoModalTitleEdit || 'Edit your Recommendation')
    : (d.recoCta            || 'Leave a Recommendation');
  if (lblEl)   lblEl.textContent   = isEdit
    ? (d.recoSubmitEdit || 'Update Recommendation')
    : (d.recoSubmitNew  || 'Post Recommendation');

  // Pre-fill (or clear) the textarea. md-outlined-text-field only honours
  // .value once the custom element has upgraded, so wait for definition
  // before writing — otherwise the assignment can be silently dropped on
  // a cold load.
  customElements.whenDefined('md-outlined-text-field').then(function () {
    if (textEl) textEl.value = isEdit ? (myRecommendation.text || '') : '';
  });

  var overlay = document.getElementById('leaveRecoOverlay');
  if (!overlay) return;
  whenMdDialogReady(function () {
    if (typeof overlay.show === 'function') overlay.show();
    else overlay.removeAttribute('hidden');
  });
}

export function closeLeaveRecommendation() {
  var overlay = document.getElementById('leaveRecoOverlay');
  if (!overlay) return;
  if (typeof overlay.close === 'function') overlay.close();
  else overlay.setAttribute('hidden', '');
  resetLeaveRecoForm();
}

function resetLeaveRecoForm() {
  var form = document.getElementById('leaveRecoForm');
  if (form) form.reset();
  // form.reset() doesn't reliably clear md-outlined-text-field once we've
  // programmatically assigned .value (edit mode pre-fills via the property,
  // not the attribute, so the "default" is still empty in form-internals
  // terms — but some Material versions hold on to the last property value).
  // Clear it explicitly so the next "new" open starts clean.
  var textEl = document.getElementById('lr-text');
  if (textEl) textEl.value = '';
  clearErr('lr-text');
  var globalErr = document.getElementById('lr-global-error');
  if (globalErr) globalErr.hidden = true;
  var btn = document.getElementById('lr-submit-btn');
  if (btn) btn.disabled = false;
  // Reset the chrome back to "new" defaults — openLeaveRecommendation()
  // will re-flip to edit mode if needed on the next open.
  var lbl = document.getElementById('lr-submit-label');
  if (lbl) lbl.textContent = 'Post Recommendation';
  var titleEl = document.getElementById('lr-title-text');
  if (titleEl) titleEl.textContent = 'Leave a Recommendation';
}

function validateLeaveReco() {
  var text = document.getElementById('lr-text').value.trim();
  clearErr('lr-text');
  if (!text) { setErr('lr-text', 'Please share a recommendation.'); return false; }
  if (text.length > 2000) {
    setErr('lr-text', 'Recommendation must be 2000 characters or fewer.');
    return false;
  }
  return true;
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!isSignedIn()) {
    // Edge case: token expired between modal-open and submit. Bail to
    // sign-in so the next attempt has a fresh credential.
    closeLeaveRecommendation();
    openLeaveRecommendation();
    return;
  }
  if (!validateLeaveReco()) return;

  var btn       = document.getElementById('lr-submit-btn');
  var btnLabel  = document.getElementById('lr-submit-label');
  var globalErr = document.getElementById('lr-global-error');

  // Mode is fixed at submit time — myRecommendation reflects what was
  // shown to the user when they opened the modal. We capture it locally
  // so the loading / error labels stay coherent even if a background
  // refresh changes myRecommendation while the request is in flight.
  var isEdit      = !!myRecommendation;
  var idleLabel   = isEdit ? 'Update Recommendation' : 'Post Recommendation';
  var loadingLbl  = isEdit ? 'Updating\u2026'         : 'Posting\u2026';

  btn.disabled = true;
  if (btnLabel) btnLabel.textContent = loadingLbl;
  globalErr.hidden = true;

  var payload = { text: document.getElementById('lr-text').value.trim() };

  function fail(msg) {
    globalErr.textContent = msg;
    globalErr.hidden = false;
    btn.disabled = false;
    if (btnLabel) btnLabel.textContent = idleLabel;
  }

  try {
    var res = await fetch('/api/recommendation', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + googleCredential,
      },
      body: JSON.stringify(payload),
    });
    var data = await res.json();

    if (res.status === 401) {
      // Token expired or invalid — clear and reprompt.
      setGoogleCredential(null);
      return fail('Your session expired. Please sign in again.');
    }

    if (res.status === 429) {
      return fail((data && (data.error || data.message))
        || "You've reached the recommendation limit for now. Try again in an hour.");
    }

    if (res.ok && data.success) {
      // Streamlined success path: close the modal immediately, refresh
      // the public list (cache-busted), and scroll the user to their
      // card. The card itself — with its "Updated just now" pill — is
      // the confirmation. No success banner, no timeout, no flicker.
      closeLeaveRecommendation();
      refreshRecommendations({ bustCache: true });
      var section = document.getElementById('recosSection');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    fail((data && (data.error || data.message)) || 'Submission failed. Please try again.');
  } catch (_) {
    fail('Network error. Please check your connection and try again.');
  }
}

export function initRecommendations() {
  refreshRecommendations();

  // Re-fetch when the user comes back to the tab (covers replies arriving
  // while they were in another tab — cheap, debounced by the 30s s-maxage).
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshRecommendations();
  });

  var lrOverlay = document.getElementById('leaveRecoOverlay');
  if (lrOverlay) lrOverlay.addEventListener('close', resetLeaveRecoForm);

  var lrForm = document.getElementById('leaveRecoForm');
  if (lrForm) lrForm.addEventListener('submit', handleSubmit);
}
