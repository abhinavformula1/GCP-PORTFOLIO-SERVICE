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
import { renderFreeFormMode, resetAtlasState } from './atlas.js';
import { createInputRow } from './widgets.js';

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
  // mode = null  → show the mode-chooser screen (Schedule vs Ask Atlas)
  // mode = 'guided'   → existing 7-step hire flow
  // mode = 'freeform' → free-form Q&A delegated to ./atlas.js
  mode: null,
};

const STEPS = [
  {
    key: 'name',
    bot: function () { return t().botGreeting; },
    inputType: 'text',
    placeholder: function () { return t().namePlaceholder; },
    validate: function (v) {
      const raw = (v || '').trim();
      if (!raw) return t().errors.name;

      // Catch the most common case: "hi" / "hello" / "hey" — these are
      // not names. We only match when the entire input is the greeting
      // (so "Hi, I'm John" or "Hello Ravi" still pass).
      const GREETINGS = /^(hi|hii+|hey+|hello|hola|yo|sup|hiya|howdy|namaste|bonjour|salut)[!. ]*$/i;
      if (GREETINGS.test(raw)) return t().errors.nameLooksLikeGreeting;

      // Must contain at least one letter and be at least 2 characters
      // total — rejects "x", "1", "...". Allows non-Latin scripts via
      // \p{L} (Devanagari, CJK, etc.).
      if (raw.length < 2 || !/\p{L}/u.test(raw)) return t().errors.nameTooShort;

      return null;
    },
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
  state.mode = null;
  resetAtlasState();
  // Reset avatar and header
  const avatar = document.querySelector('.ga-avatar');
  if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
  const headerName = document.querySelector('.ga-header-name');
  if (headerName) headerName.textContent = 'Atlas';
  const overlay = document.getElementById('assistantOverlay');
  overlay.removeAttribute('data-mode');
  document.getElementById('gaMessages').innerHTML = '';
  // Restore the step-progress track (atlas.js hides it for free-form mode).
  const progressTrack = document.querySelector('.ga-progress-track');
  if (progressTrack) progressTrack.style.display = '';
  overlay.removeAttribute('hidden');
  hideTeaser();

  // Show the "Start over" button only for signed-in users (it operates
  // on Firestore-backed history, which guests don't have).
  setStartOverBtnVisible(!!(siteProfile && siteProfile.type !== 'guest'));

  // If a saved guided-flow conversation exists for this user, jump straight
  // back into it (skip the mode chooser — they're clearly resuming the
  // hire flow, not starting over).
  if (pendingChatHistory && pendingChatHistory.step > 1 && siteProfile && siteProfile.type !== 'guest') {
    state.mode = 'guided';
    applyGoogleProfileToChat(siteProfile);
    return;
  }

  // Otherwise: show the two-card mode chooser. Sign-in gating happens
  // inside the chooser when the user picks the path that requires it.
  renderModeChooser();
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
  // Reset to the guided-flow handler whenever we toggle visibility from
  // chat.js. Atlas mode rebinds this to its own startOver in renderFreeFormMode().
  btn.onclick = restartAssistant;
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
  state.mode           = null;
  resetAtlasState();
  const msgs = document.getElementById('gaMessages');
  if (msgs) msgs.innerHTML = '';
  const avatar = document.querySelector('.ga-avatar');
  if (avatar) { avatar.innerHTML = 'AK'; avatar.style.background = ''; avatar.style.padding = ''; }
  const headerName = document.querySelector('.ga-header-name');
  if (headerName) headerName.textContent = 'Atlas';
  const overlay = document.getElementById('assistantOverlay');
  if (overlay) overlay.removeAttribute('data-mode');
  const progressTrack = document.querySelector('.ga-progress-track');
  if (progressTrack) progressTrack.style.display = '';
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

  // Free-form mode was requested before sign-in (user clicked Ask Atlas
  // while signed-out). Now they're signed in — drop straight into Atlas.
  if (state.mode === 'freeform') {
    renderFreeFormMode();
    return;
  }

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

/* ── Mode chooser ────────────────────────────────────────────────────────
   Two-card landing screen that runs once per chat-open (unless the user
   is resuming a saved guided-flow conversation). Picks between:
     - "Schedule a chat with Abhinav" → existing 7-step hire flow
     - "Ask Atlas anything"           → free-form Q&A (./atlas.js)
   Atlas mode requires Google Sign-In; guests see an inline sign-in
   prompt when they pick that card.
   ───────────────────────────────────────────────────────────────────── */

function renderModeChooser() {
  // Reset progress bar — chooser is "step 0".
  const bar = document.getElementById('gaProgressBar');
  if (bar) bar.style.width = '0%';

  const msgs = document.getElementById('gaMessages');
  const area = document.getElementById('gaInputArea');
  if (!msgs || !area) return;

  msgs.innerHTML = '';
  area.innerHTML = '';

  addBotMessage("Hi — I'm Atlas, Abhinav's virtual assistant. What would you like to do?");

  const wrap = document.createElement('div');
  wrap.className = 'ga-mode-chooser';

  const scheduleCard = buildModeCard({
    icon:     'event_available',
    title:    'Schedule a chat',
    body:     'Share a few details and pick a slot. Goes straight to Abhinav.',
    cta:      'Start',
    onClick:  function () {
      state.mode = 'guided';
      area.innerHTML = '';
      msgs.innerHTML = '';
      // Hand off to the existing guided flow.
      if (siteProfile && siteProfile.type !== 'guest') {
        applyGoogleProfileToChat(siteProfile);
      } else {
        state.showGoogleStep = !!(GOOGLE_CLIENT_ID && window.google && (!siteProfile));
        renderStep();
      }
    },
  });

  const askCard = buildModeCard({
    icon:     'forum',
    title:    'Ask Atlas anything',
    body:     'Free-form Q&A about his experience, projects, and skills.',
    cta:      'Ask',
    onClick:  function () {
      // Pin the intended mode now so the sign-in callback in main.js
      // (→ applyGoogleProfileToChat) can route to free-form instead of
      // the guided hire flow.
      state.mode = 'freeform';
      if (!googleCredential || !siteProfile || siteProfile.type === 'guest') {
        renderAtlasSignInPrompt();
        return;
      }
      renderFreeFormMode();
    },
  });

  wrap.appendChild(scheduleCard);
  wrap.appendChild(askCard);
  area.appendChild(wrap);
}

function buildModeCard(opts) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ga-mode-card';
  card.innerHTML =
    '<div class="ga-mode-icon"><span class="material-symbols-outlined" aria-hidden="true">' +
      escHtml(opts.icon) +
    '</span></div>' +
    '<div class="ga-mode-text">' +
      '<div class="ga-mode-title">' + escHtml(opts.title) + '</div>' +
      '<div class="ga-mode-body">'  + escHtml(opts.body)  + '</div>' +
    '</div>' +
    '<div class="ga-mode-cta">' + escHtml(opts.cta) + ' &rsaquo;</div>';
  card.onclick = opts.onClick;
  return card;
}

function renderAtlasSignInPrompt() {
  const area = document.getElementById('gaInputArea');
  if (!area) return;
  area.innerHTML = '';

  addBotMessage("Atlas needs a quick sign-in so I know who I'm talking to. It's a one-click Google sign-in — your details aren't shared.");

  const wrap = document.createElement('div');
  wrap.className = 'ga-google-step';

  const googleBtnDiv = document.createElement('div');
  googleBtnDiv.id = 'googleSignInBtn';
  googleBtnDiv.className = 'ga-google-btn-wrap';

  const sep = document.createElement('div');
  sep.className = 'ga-google-sep';
  sep.textContent = 'or';

  const backBtn = document.createElement('button');
  backBtn.className = 'ga-guest-btn';
  backBtn.textContent = 'Back';
  backBtn.onclick = function () { renderModeChooser(); };

  wrap.appendChild(googleBtnDiv);
  wrap.appendChild(sep);
  wrap.appendChild(backBtn);
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
    const err = document.createElement('div');
    err.className = 'ga-input-err';

    const { row, input } = createInputRow({
      placeholder:     stepDef.placeholder ? stepDef.placeholder() : '',
      buttonAriaLabel: t().continueBtn,
      buttonTitle:     t().continueBtn,
      onSubmit: function (val) {
        const v = val == null ? '' : val;
        const e = stepDef.validate(v);
        if (e) { err.textContent = e; return; }
        err.textContent = '';
        state.answers[stepDef.key] = v.trim();
        addUserMessage(v.trim());
        area.innerHTML = '';
        state.step++;
        setTimeout(renderStep, 400);
      },
    });

    area.appendChild(row);
    area.appendChild(err);
    setTimeout(function () { input.focus(); }, 50);

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
