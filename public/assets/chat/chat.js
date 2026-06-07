/**
 * Guided assistant — the chat panel that captures hire-me leads.
 *
 * This is the largest extracted module because the chat is a state
 * machine (STEPS array) that drives a render pipeline (renderStep →
 * renderInputArea / renderConfirm / renderDone) coupled to a few
 * orthogonal concerns (FAB launcher + teaser, panel resize, persistence
 * to /api/chat/active, AI summarisation). They share enough closure
 * state (`state`, message history, persistence guards) that splitting
 * them into separate files would mean threading state through arguments
 * everywhere — net loss in readability.
 *
 * Module shape:
 *   - public functions: `openAssistant`, `closeAssistant`,
 *     `forceCloseAssistant`, `minimiseAssistant`, `restartAssistant`,
 *     `resumeAssistant`, `toggleChatTeaser`, `resetChatState`,
 *     `applyGoogleProfileToChat`, `initChat`.
 *   - private state: `state` (step + answers + minimised flag),
 *     `STEPS`, `SLOTS`, `TOTAL_STEPS`, `teaserShown`. None of these
 *     leak — main.js can't and doesn't reach in.
 *
 * main.js re-exports the inline-onclick'd functions onto `window` so
 * the HTML still resolves them by global name.
 */

import { t, currentLang } from '../core/i18n.js';
import {
  siteProfile,
  googleCredential,
  pendingChatHistory, setPendingChatHistory,
} from '../core/state.js';
import { authedFetch }     from '../core/auth.js';
import { GOOGLE_CLIENT_ID } from '../core/config.js';

/* ═══════════════════════════════════════════════════════════
   GUIDED ASSISTANT — state machine
═══════════════════════════════════════════════════════════ */

const SLOTS = [
  'Mon 28 Apr · 10:00 AM IST',
  'Mon 28 Apr · 3:00 PM IST',
  'Tue 29 Apr · 11:00 AM IST',
  'Wed 30 Apr · 2:00 PM IST',
  'Thu 1 May · 4:00 PM IST',
];

const TOTAL_STEPS = 7;

const state = {
  step: 0,
  answers: { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' },
  googleProfile: null,
  showGoogleStep: false,
  minimised: false,
};

const STEPS = [
  {
    key: 'name',
    bot: function () { return t().botGreeting; },
    inputType: 'text',
    placeholder: function () { return t().namePlaceholder; },
    validate: function (v) { return v.trim().length > 0 ? null : t().errors.name; },
  },
  {
    key: 'email',
    bot: function (a) { return t().botEmail(a.name.split(' ')[0]); },
    inputType: 'text',
    placeholder: function () { return t().emailPlaceholder; },
    validate: function (v) {
      if (!v.trim()) return t().errors.emailRequired;
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : t().errors.emailInvalid;
    },
  },
  {
    key: 'company',
    bot: function () { return t().botCompany; },
    inputType: 'text',
    placeholder: function () { return t().companyPlaceholder; },
    validate: function (v) { return v.trim().length > 0 ? null : t().errors.company; },
  },
  {
    key: 'role',
    bot: function () { return t().botRole; },
    inputType: 'choice',
    choices: function () { return t().choices.roles; },
  },
  {
    key: 'contractType',
    bot: function () { return t().botContract; },
    inputType: 'choice',
    choices: function () { return t().choices.contracts; },
  },
  {
    key: 'urgency',
    bot: function () { return t().botUrgency; },
    inputType: 'choice',
    choices: function () { return t().choices.urgency; },
  },
  {
    key: 'slot',
    bot: function () { return t().botSlot; },
    inputType: 'slots',
  },
];

/* ── Chat Launcher (FAB) ─────────────────────────────────────────────────── */
function setFabIcon(name) {
  const icon = document.getElementById('chatFabIcon');
  if (icon) icon.textContent = name;
}

// Defensive: the teaser HTML still exists in index.html (kept around in case
// we ever want to revive the "Let's talk" auto-nudge), so we keep a one-way
// hide helper that other flows (openAssistant, resumeAssistant) call.
function hideTeaser() {
  const t = document.getElementById('chatTeaser');
  if (t) t.setAttribute('hidden', '');
  setFabIcon('chat');
}

export function toggleChatTeaser() {
  // Resume an in-flight conversation if one is minimised; otherwise open
  // the chat panel directly. The "Let's talk" teaser detour was removed —
  // clicking the FAB should always land on the actual chat window.
  if (state.minimised) {
    resumeAssistant();
    return;
  }
  openAssistant();
}

/* ── Open / close / minimise / restart ───────────────────────────────────── */

export function openAssistant() {
  state.step = 0;
  state.answers  = { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' };
  state.googleProfile  = null;
  state.showGoogleStep = false;
  // Reset avatar and header
  const avatar = document.querySelector('.ga-avatar');
  if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
  const headerName = document.querySelector('.ga-header-name');
  if (headerName) headerName.textContent = 'Atlas';
  document.getElementById('gaMessages').innerHTML = '';
  document.getElementById('assistantOverlay').removeAttribute('hidden');
  hideTeaser();

  // Show the "Start over" button only for signed-in users (it operates
  // on Firestore-backed history, which guests don't have).
  setStartOverBtnVisible(!!(siteProfile && siteProfile.type !== 'guest'));

  // If already signed in from welcome screen, skip sign-in step
  if (siteProfile && siteProfile.type !== 'guest') {
    applyGoogleProfileToChat(siteProfile);
  } else {
    state.showGoogleStep = !!(GOOGLE_CLIENT_ID && window.google && (!siteProfile));
    renderStep();
  }
}

export function closeAssistant() {
  // Mid-conversation — ask for confirmation
  if (state.step > 0 && state.step < STEPS.length) {
    showCloseConfirm();
    return;
  }
  forceCloseAssistant();
}

export function forceCloseAssistant() {
  state.minimised = false;
  document.getElementById('assistantOverlay').setAttribute('hidden', '');
  // Remove confirm dialog if present
  const existing = document.getElementById('gaCloseConfirm');
  if (existing) existing.remove();
}

function showCloseConfirm() {
  // Don't stack multiple dialogs
  if (document.getElementById('gaCloseConfirm')) return;

  const dialog = document.createElement('div');
  dialog.id = 'gaCloseConfirm';
  dialog.className = 'ga-close-confirm';
  dialog.innerHTML =
    '<p class="ga-confirm-msg">End this conversation? Your progress will be lost.</p>' +
    '<div class="ga-confirm-btns">' +
      '<button class="ga-confirm-stay">Keep chatting</button>' +
      '<button class="ga-confirm-end">End conversation</button>' +
    '</div>';

  dialog.querySelector('.ga-confirm-stay').onclick = function () {
    dialog.remove();
  };
  dialog.querySelector('.ga-confirm-end').onclick = function () {
    dialog.remove();
    forceCloseAssistant();
  };

  document.querySelector('.ga-modal').appendChild(dialog);
}

export function minimiseAssistant() {
  state.minimised = true;
  document.getElementById('assistantOverlay').setAttribute('hidden', '');
  const launcher = document.getElementById('chatLauncher');
  launcher.removeAttribute('hidden');
  setFabIcon('chat');
}

/**
 * "Start over" — clears the in-memory chat, deletes the active chat
 * from Firestore, then re-opens fresh. Only meaningful for signed-in users.
 */
export function restartAssistant() {
  if (googleCredential) {
    authedFetch('/api/chat/active', { method: 'DELETE' });
  }
  setPendingChatHistory(null);
  resetChatState();
  const ov = document.getElementById('assistantOverlay');
  if (ov && !ov.hasAttribute('hidden')) {
    // Re-render: openAssistant() will run the greeting + step 0 again
    forceCloseAssistant();
    setTimeout(function () { openAssistant(); }, 0);
  }
}

function setStartOverBtnVisible(visible) {
  const btn = document.getElementById('gaStartOverBtn');
  if (!btn) return;
  if (visible) btn.removeAttribute('hidden');
  else         btn.setAttribute('hidden', '');
}

export function resumeAssistant() {
  state.minimised = false;
  document.getElementById('assistantOverlay').removeAttribute('hidden');
  hideTeaser();
}

/**
 * Wipes the in-memory chat state and any DOM mirrors so a new user
 * starts from a clean slate. Safe to call even if the chat panel
 * isn't open.
 */
export function resetChatState() {
  state.step = 0;
  state.answers = { name: '', email: '', company: '', role: '', contractType: '', urgency: '', slot: '' };
  state.googleProfile  = null;
  state.showGoogleStep = false;
  state.minimised      = false;
  const msgs = document.getElementById('gaMessages');
  if (msgs) msgs.innerHTML = '';
  const avatar = document.querySelector('.ga-avatar');
  if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
  const headerName = document.querySelector('.ga-header-name');
  if (headerName) headerName.textContent = 'Atlas';
}

/**
 * Apply a freshly signed-in Google profile to the chat: pre-fill name +
 * email, swap the avatar/header, and either resume from saved history
 * or start the guided flow at step 2 (since we already have the first
 * two answers).
 */
export function applyGoogleProfileToChat(profile) {
  state.googleProfile  = profile;
  state.answers.name   = profile.name;
  state.answers.email  = profile.email;
  state.showGoogleStep = false;

  // Always update the avatar and header name
  const avatar = document.querySelector('.ga-avatar');
  if (avatar && profile.picture) {
    avatar.innerHTML = '<img src="' + profile.picture + '" alt="' + profile.name + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
    avatar.style.background = 'none';
    avatar.style.padding = '0';
  }
  const headerName = document.querySelector('.ga-header-name');
  if (headerName) headerName.textContent = profile.name.split(' ')[0] + "'s session";

  // Only restart the chat if we're still at the very beginning (pre-step or name/email)
  if (state.step <= 1) {
    const first = profile.name.split(' ')[0];

    // Resume from saved history if the user has an active chat in Firestore
    if (pendingChatHistory && pendingChatHistory.step > 1) {
      document.getElementById('gaMessages').innerHTML = '';
      const resumeMsg = (profile.isReturning ? t().botWelcomeBack(first) : t().botWelcomeNew(first))
                      + ' ' + (t().botResume || '(picking up where we left off)');
      addBotMessage(resumeMsg, function () {
        renderRestoredMessages(pendingChatHistory.messages || []);
        state.step    = Math.min(pendingChatHistory.step, STEPS.length);
        state.answers = mergeAnswers(state.answers, pendingChatHistory.answers || {});
        // Always trust Google's verified name/email over saved values
        state.answers.name  = profile.name;
        state.answers.email = profile.email;
        setPendingChatHistory(null);
        renderStep();
      });
    } else {
      state.step = 2;
      document.getElementById('gaMessages').innerHTML = '';
      const greeting = profile.isReturning
        ? t().botWelcomeBack(first)
        : t().botWelcomeNew(first);
      addBotMessage(greeting);
      setPendingChatHistory(null);
      renderStep();
    }
  }
  // If already mid-conversation, just silently update name/email in answers — don't disrupt
}

// Append saved messages without animation — used when restoring history.
function renderRestoredMessages(messages) {
  const msgs = document.getElementById('gaMessages');
  if (!msgs || !messages || !messages.length) return;
  messages.forEach(function (m) {
    if (!m || !m.text) return;
    const wrap = document.createElement('div');
    wrap.className = 'ga-msg ' + (m.role === 'user' ? 'ga-msg-user' : 'ga-msg-bot');
    const bubbleCls = m.role === 'user' ? 'ga-bubble-user' : 'ga-bubble-bot';
    wrap.innerHTML = '<div class="ga-bubble ' + bubbleCls + '">' + escHtml(m.text) + '</div>';
    msgs.appendChild(wrap);
  });
  scrollMessages();
}

function mergeAnswers(target, source) {
  target = target || {};
  Object.keys(source || {}).forEach(function (k) {
    if (source[k] !== undefined && source[k] !== null && source[k] !== '') target[k] = source[k];
  });
  return target;
}

/* ── Render pipeline ─────────────────────────────────────────────────────── */

function updateProgress() {
  const pct = Math.round((state.step / TOTAL_STEPS) * 100);
  document.getElementById('gaProgressBar').style.width = pct + '%';
}

function renderGoogleStep() {
  const area = document.getElementById('gaInputArea');
  area.innerHTML = '';

  addBotMessage("Hi! To save time, you can sign in with Google — I'll auto-fill your name and email. Or continue as a guest and I'll ask you a couple of questions.");

  const wrap = document.createElement('div');
  wrap.className = 'ga-google-step';

  const googleBtnDiv = document.createElement('div');
  googleBtnDiv.id = 'googleSignInBtn';
  googleBtnDiv.className = 'ga-google-btn-wrap';

  const sep = document.createElement('div');
  sep.className = 'ga-google-sep';
  sep.textContent = 'or';

  const guestBtn = document.createElement('button');
  guestBtn.className = 'ga-guest-btn';
  guestBtn.textContent = 'Continue as Guest';
  guestBtn.onclick = function () {
    state.showGoogleStep = false;
    document.getElementById('gaMessages').innerHTML = '';
    renderStep();
  };

  wrap.appendChild(googleBtnDiv);
  wrap.appendChild(sep);
  wrap.appendChild(guestBtn);
  area.appendChild(wrap);

  if (window.google && window.google.accounts && GOOGLE_CLIENT_ID) {
    google.accounts.id.renderButton(googleBtnDiv, {
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: 260,
    });
  }
}

function renderStep() {
  if (state.showGoogleStep) { renderGoogleStep(); return; }
  updateProgress();
  if (state.step >= STEPS.length) { renderConfirm(); return; }
  const stepDef = STEPS[state.step];
  const botText = stepDef.bot(state.answers);
  addBotMessage(botText, function () {
    renderInputArea(stepDef);
  });
}

function addBotMessage(text, cb) {
  const msgs = document.getElementById('gaMessages');
  const wrap = document.createElement('div');
  wrap.className = 'ga-msg ga-msg-bot ga-msg-enter';
  wrap.innerHTML = '<div class="ga-bubble ga-bubble-bot">' + escHtml(text) + '</div>';
  msgs.appendChild(wrap);
  scrollMessages();
  persistChatTurn('bot', text);
  setTimeout(function () { wrap.classList.remove('ga-msg-enter'); if (cb) cb(); }, 300);
}

function addUserMessage(text) {
  const msgs = document.getElementById('gaMessages');
  const wrap = document.createElement('div');
  wrap.className = 'ga-msg ga-msg-user ga-msg-enter';
  wrap.innerHTML = '<div class="ga-bubble ga-bubble-user">' + escHtml(text) + '</div>';
  msgs.appendChild(wrap);
  scrollMessages();
  persistChatTurn('user', text);
  setTimeout(function () { wrap.classList.remove('ga-msg-enter'); }, 300);
}

/**
 * Fire-and-forget: persists the latest turn + current chat state to
 * Firestore via /api/chat/active. Only runs for signed-in users with a
 * cached Google credential. Silent on failure (chat UX never blocks).
 */
function persistChatTurn(role, text) {
  if (!googleCredential) return;
  if (!siteProfile || siteProfile.type === 'guest') return;
  try {
    authedFetch('/api/chat/active', {
      method: 'POST',
      body:   JSON.stringify({
        step:    typeof state.step === 'number' ? state.step : 0,
        answers: state.answers || {},
        locale:  (typeof currentLang === 'string' ? currentLang : 'en'),
        message: { role: role === 'user' ? 'user' : 'bot', text: String(text || '') },
      }),
    });
  } catch (_) {}
}

function renderInputArea(stepDef) {
  const area = document.getElementById('gaInputArea');
  area.innerHTML = '';

  if (stepDef.inputType === 'text') {
    const row = document.createElement('div');
    row.className = 'ga-input-row';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ga-text-input';
    inp.placeholder = stepDef.placeholder ? stepDef.placeholder() : '';

    const err = document.createElement('div');
    err.className = 'ga-input-err';

    const btn = document.createElement('button');
    btn.className = 'ga-send-btn ga-send-icon-btn';
    btn.setAttribute('aria-label', t().continueBtn);
    btn.title = t().continueBtn;
    // Inline SVG paper-plane (kite), pointing upper-right.
    btn.innerHTML = '<svg class="ga-send-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
      '<path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/>' +
      '</svg>';
    btn.onclick = function () {
      const val = inp.value;
      const e = stepDef.validate(val);
      if (e) { err.textContent = e; return; }
      err.textContent = '';
      state.answers[stepDef.key] = val.trim();
      addUserMessage(val.trim());
      area.innerHTML = '';
      state.step++;
      setTimeout(renderStep, 400);
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.onclick(); });

    row.appendChild(inp);
    row.appendChild(btn);
    area.appendChild(row);
    area.appendChild(err);
    setTimeout(function () { inp.focus(); }, 50);

  } else if (stepDef.inputType === 'choice') {
    const grid = document.createElement('div');
    grid.className = 'ga-choice-grid';
    stepDef.choices().forEach(function (choice) {
      const btn = document.createElement('button');
      btn.className = 'ga-choice-btn';
      btn.textContent = choice;
      btn.onclick = function () {
        state.answers[stepDef.key] = choice;
        addUserMessage(choice);
        area.innerHTML = '';
        state.step++;
        setTimeout(renderStep, 400);
      };
      grid.appendChild(btn);
    });
    area.appendChild(grid);

  } else if (stepDef.inputType === 'slots') {
    const slotGrid = document.createElement('div');
    slotGrid.className = 'ga-slot-grid';
    SLOTS.forEach(function (slot) {
      const btn = document.createElement('button');
      btn.className = 'ga-slot-btn';
      btn.textContent = slot;
      btn.onclick = function () {
        state.answers.slot = slot;
        addUserMessage(slot);
        area.innerHTML = '';
        state.step++;
        setTimeout(renderStep, 400);
      };
      slotGrid.appendChild(btn);
    });
    area.appendChild(slotGrid);
  }
}

function renderConfirm() {
  updateProgress();
  const a = state.answers;
  addBotMessage(
    t().botConfirm,
    function () {
      const area = document.getElementById('gaInputArea');
      area.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'ga-confirm-summary';
      summary.innerHTML =
        '<div class="ga-summary-row"><span>Name</span><strong>' + escHtml(a.name) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Email</span><strong>' + escHtml(a.email) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Company</span><strong>' + escHtml(a.company) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Role</span><strong>' + escHtml(a.role) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Type</span><strong>' + escHtml(a.contractType) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Urgency</span><strong>' + escHtml(a.urgency) + '</strong></div>' +
        '<div class="ga-summary-row"><span>Slot</span><strong>' + escHtml(a.slot) + '</strong></div>';

      const summaryBtn = document.createElement('button');
      summaryBtn.className = 'ga-summary-btn';
      summaryBtn.textContent = 'Get AI Summary';
      summaryBtn.onclick = function () { requestSummary(summaryBtn); };

      const summaryOut = document.createElement('div');
      summaryOut.className = 'ga-summary-out';
      summaryOut.id = 'gaSummaryOut';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'ga-send-btn';
      confirmBtn.style.marginTop = '4px';
      confirmBtn.textContent = t().confirmBtn;
      confirmBtn.onclick = function () { submitAssistant(confirmBtn); };

      const errDiv = document.createElement('div');
      errDiv.className = 'ga-input-err';
      errDiv.id = 'gaSubmitErr';

      area.appendChild(summary);
      area.appendChild(summaryBtn);
      area.appendChild(summaryOut);
      area.appendChild(confirmBtn);
      area.appendChild(errDiv);
    }
  );
}

async function submitAssistant(btn) {
  btn.disabled = true;
  btn.textContent = t().confirmBtnBusy;
  document.getElementById('gaSubmitErr').textContent = '';

  const a = state.answers;
  try {
    const res = await fetch('/api/hire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: a.name,
        email: a.email,
        company: a.company,
        role: a.role,
        contractType: a.contractType,
        urgency: a.urgency,
        slot: a.slot,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      // Move active chat → completed-inquiries history (signed-in users only)
      if (googleCredential) {
        authedFetch('/api/chat/complete', {
          method: 'POST',
          body:   JSON.stringify({
            salesforceId:     data.recordId || null,
            alreadySubmitted: !!data.alreadySubmitted,
          }),
        });
      }
      renderDone(!!data.alreadySubmitted);
    } else {
      document.getElementById('gaSubmitErr').textContent = (data && data.error) || 'Something went wrong. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Confirm & Schedule';
    }
  } catch (_) {
    document.getElementById('gaSubmitErr').textContent = 'Network error. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Confirm & Schedule';
  }
}

function renderDone(alreadySubmitted) {
  document.getElementById('gaProgressBar').style.width = '100%';
  const area = document.getElementById('gaInputArea');
  area.innerHTML = '';

  const firstName = state.answers.name.split(' ')[0];
  const message = alreadySubmitted
    ? t().botDuplicate(firstName)
    : t().botDone(firstName, state.answers.email);

  addBotMessage(message, function () {
    const done = document.createElement('div');
    done.className = 'ga-done';

    const checkEl = document.createElement('div');
    checkEl.className = 'ga-done-check';
    checkEl.innerHTML = '&#10003;';
    done.appendChild(checkEl);

    // Skip the slot/summary widgets for duplicate submissions — there's
    // no new booking to confirm or summarise.
    if (!alreadySubmitted) {
      const slotEl = document.createElement('div');
      slotEl.className = 'ga-done-slot';
      slotEl.textContent = state.answers.slot;

      const summaryBtn = document.createElement('button');
      summaryBtn.className = 'ga-summary-btn';
      summaryBtn.textContent = 'Get AI Summary';
      summaryBtn.onclick = function () { requestSummary(summaryBtn); };

      const summaryOut = document.createElement('div');
      summaryOut.className = 'ga-summary-out';
      summaryOut.id = 'gaSummaryOut';

      done.appendChild(slotEl);
      done.appendChild(summaryBtn);
      done.appendChild(summaryOut);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ga-done-close';
    closeBtn.textContent = t().closeBtn;
    closeBtn.onclick = closeAssistant;
    done.appendChild(closeBtn);

    area.appendChild(done);
  });
}

async function requestSummary(btn) {
  btn.disabled = true;
  btn.textContent = 'Generating\u2026';
  const out = document.getElementById('gaSummaryOut');
  out.textContent = '';
  out.className = 'ga-summary-out';

  try {
    const res = await fetch('/api/summarise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:         state.answers.name,
        company:      state.answers.company,
        role:         state.answers.role,
        contractType: state.answers.contractType,
        urgency:      state.answers.urgency,
        slot:         state.answers.slot,
      }),
    });
    const data = await res.json();
    if (res.ok && data.summary) {
      out.textContent = data.summary;
      out.className = 'ga-summary-out ga-summary-ready';
      btn.textContent = 'Copy Summary';
      btn.disabled = false;
      btn.onclick = function () {
        navigator.clipboard.writeText(data.summary).then(function () {
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy Summary'; }, 2000);
        });
      };
    } else {
      out.textContent = data.error || 'Could not generate summary.';
      out.className = 'ga-summary-out ga-summary-err';
      btn.textContent = 'Retry';
      btn.disabled = false;
      btn.onclick = function () { requestSummary(btn); };
    }
  } catch (_) {
    out.textContent = 'Network error. Please try again.';
    out.className = 'ga-summary-out ga-summary-err';
    btn.textContent = 'Retry';
    btn.disabled = false;
    btn.onclick = function () { requestSummary(btn); };
  }
}

function scrollMessages() {
  const msgs = document.getElementById('gaMessages');
  msgs.scrollTop = msgs.scrollHeight;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Resizable panel (mouse + touch via Pointer Events) ──────────────────── */

function initChatResize() {
  const handle  = document.getElementById('gaResizeHandle');
  const overlay = document.getElementById('assistantOverlay');
  if (!handle || !overlay) return;

  const MIN_W = 300;
  const MAX_W = 680;
  const STORAGE_KEY = 'portfolio_chat_width';

  // Restore saved width on init
  try {
    const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    if (saved && saved >= MIN_W && saved <= MAX_W) {
      overlay.style.width = saved + 'px';
    }
  } catch (_) {}

  let dragging = false, startX = 0, startW = 0;

  function onDown(e) {
    dragging = true;
    startX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
    startW = overlay.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const clientX = (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX);
    const newW = Math.min(MAX_W, Math.max(MIN_W, startW + (startX - clientX)));
    overlay.style.width = newW + 'px';
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { localStorage.setItem(STORAGE_KEY, String(overlay.offsetWidth)); } catch (_) {}
  }

  handle.addEventListener('mousedown',  onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  handle.addEventListener('touchstart', onDown, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend',  onUp);

  // Double-click to reset to default width
  handle.addEventListener('dblclick', function () {
    overlay.style.width = '';
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  });
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

export function initChat() {
  // Reveal the FAB launcher 5s after page load. The teaser auto-nudge
  // ("Hi! Looking to hire…") was removed so the FAB clicks straight into
  // the chat — no intermediate "Let's talk" pop.
  setTimeout(function () {
    const launcher = document.getElementById('chatLauncher');
    if (!launcher) return;
    launcher.removeAttribute('hidden');
  }, 5000);

  const teaserClose = document.getElementById('chatTeaserClose');
  if (teaserClose) {
    teaserClose.addEventListener('click', function (e) {
      e.stopPropagation();
      hideTeaser();
    });
  }

  // Esc key closes the chat panel (with confirmation if mid-conversation)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAssistant();
  });

  initChatResize();
}
