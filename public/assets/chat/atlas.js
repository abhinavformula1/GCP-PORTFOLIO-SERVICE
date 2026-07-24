/**
 * Atlas — free-form Q&A mode for the chat assistant.
 *
 * Sibling to chat.js (the 7-step guided hire flow). Where chat.js owns
 * the form state machine, this module owns:
 *   - Multi-turn conversation history (in-memory mirror of Firestore)
 *   - POST /api/atlas/stream  (preferred) and POST /api/atlas/ask (fallback)
 *   - GET /api/atlas/conversations/active  (resume on re-open)
 *   - DELETE /api/atlas/conversations/active  ("Start over")
 *   - Suggested-question chip variants (rotated per session)
 *   - Typing indicator + progressive bubble updates while streaming
 *   - A tiny safe-Markdown renderer (no external dep)
 *
 * Public surface:
 *   - renderFreeFormMode()   — paint the free-form panel into the existing
 *                              assistant overlay (#gaMessages + #gaInputArea)
 *   - resetAtlasState()      — clear in-memory history + UI
 *
 * The chat overlay's chrome (header, progress bar, resize handle) is
 * reused as-is — we just hide the progress bar in this mode because
 * there is no fixed step count.
 */

import { googleCredential, setGoogleCredential } from '../core/state.js';
import { createInputRow } from './widgets.js';

/* ── Suggested-question variants ──────────────────────────────────────── */
//
// Three chip sets aimed at different visitor intents. Variant is sticky
// per browser session via sessionStorage so a user doesn't see a
// different set on every chat re-open mid-conversation. Variant id is
// also stamped on each `sendAtlasMessage` call so we (the server log
// scanner) can see which variant a message originated from when scanning
// the [atlas] correlation logs.
//
// To add a fourth variant, just append to QUESTION_VARIANTS — the
// rotation logic picks uniformly from the array length.

const QUESTION_VARIANTS = [
  {
    id: 'hiring',
    label: 'Hiring lens',
    chips: [
      'Is Abhinav available for a Senior / Staff Salesforce role?',
      'Tell me about his most recent project at Salesforce.',
      'Which industries has he delivered to?',
      'How many years of CPQ experience does he have?',
      'How can I get in touch?',
    ],
  },
  {
    id: 'technical',
    label: 'Technical lens',
    chips: [
      'How does this portfolio integrate Salesforce with GCP?',
      'What design patterns does Abhinav use for Apex callouts?',
      "What's his experience with OmniStudio?",
      'Has he worked on event-driven architectures?',
      'Which GCP services does he use day-to-day?',
    ],
  },
  {
    id: 'general',
    label: 'General lens',
    chips: [
      'Give me a 30-second pitch on Abhinav.',
      "What's his strongest area?",
      'What certifications does he hold?',
      'What kind of role is he looking for next?',
      'How can I reach him?',
    ],
  },
];

const VARIANT_STORAGE_KEY = 'atlas_chip_variant_v1';
const MODEL_STORAGE_KEY = 'atlas_model_choice_v1';
const ATLAS_STREAM_TIMEOUT_MS = 20000;
const GOOGLE_TOKEN_EXPIRY_SKEW_SECONDS = 60;
const MAX_CLIENT_HISTORY_TURNS = 20;
const LOCAL_ATLAS_DEV_TOKEN = 'local-admin-preview';

// All possible model options (superset). The admin may enable a subset.
const MODEL_OPTIONS = {
  'flash-lite': {
    label: 'Fast & economical',
    detail: 'Default',
  },
  flash: {
    label: 'More detailed',
    detail: 'Higher cost',
  },
};

// Resolved at runtime from /api/atlas/config — falls back to defaults.
let _atlasRemoteConfig = null;

function applyRemoteModelOptions(remoteOptions) {
  if (!remoteOptions || typeof remoteOptions !== 'object') return;
  Object.keys(MODEL_OPTIONS).forEach(function (key) {
    const incoming = remoteOptions[key];
    if (!incoming || typeof incoming !== 'object') return;
    MODEL_OPTIONS[key] = {
      label: typeof incoming.label === 'string' && incoming.label.trim()
        ? incoming.label.trim()
        : MODEL_OPTIONS[key].label,
      detail: typeof incoming.detail === 'string' && incoming.detail.trim()
        ? incoming.detail.trim()
        : MODEL_OPTIONS[key].detail,
    };
  });
}

async function fetchAtlasConfig() {
  if (_atlasRemoteConfig) return _atlasRemoteConfig;
  try {
    const res = await fetch('/api/atlas/config');
    if (res.ok) {
      _atlasRemoteConfig = await res.json();
    }
  } catch (_) {}
  if (!_atlasRemoteConfig) {
    _atlasRemoteConfig = {
      enabledModels:        Object.keys(MODEL_OPTIONS),
      defaultModel:         'flash-lite',
      // If the backend config can't be fetched, default to hiding the picker.
      // The backend is the source of truth for model selection.
      modelSelectorVisible: false,
    };
  }
  applyRemoteModelOptions(_atlasRemoteConfig.modelOptions);
  return _atlasRemoteConfig;
}

/**
 * Cryptographically-strong uniform integer in [0, max).
 * We don't need crypto-grade randomness for A/B bucketing — output is
 * just a chip-set index, observable to the user, with zero security
 * impact. We use the Web Crypto API anyway because it (a) keeps SAST
 * tooling (Sonar's javascript:S2245) silent and (b) is supported in
 * every browser made since 2015 (IE 11+, Safari 6.1+, Chrome 11+,
 * Firefox 21+). On the off-chance crypto is unavailable, the caller
 * catches and defaults to variant 0 — that's fine, the worst case is
 * "this visitor always sees the first chip set", not a bug.
 */
function pickIndex(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/** Pick a sticky variant per browser session. */
function chooseVariant() {
  let stored;
  try { stored = sessionStorage.getItem(VARIANT_STORAGE_KEY); } catch (_) {}
  if (stored !== null && stored !== undefined) {
    const idx = parseInt(stored, 10);
    if (idx >= 0 && idx < QUESTION_VARIANTS.length) return QUESTION_VARIANTS[idx];
  }
  let idx;
  try { idx = pickIndex(QUESTION_VARIANTS.length); } catch (_) { idx = 0; }
  try { sessionStorage.setItem(VARIANT_STORAGE_KEY, String(idx)); } catch (_) {}
  return QUESTION_VARIANTS[idx];
}

function readStoredModel(enabledModels) {
  const allowed = enabledModels || Object.keys(MODEL_OPTIONS);
  let stored;
  try { stored = sessionStorage.getItem(MODEL_STORAGE_KEY); } catch (_) {}
  return (stored && allowed.includes(stored)) ? stored : '';
}

function resolveInitialModel(remoteCfg, enabledModels) {
  const allowed = enabledModels || Object.keys(MODEL_OPTIONS);
  const backendDefault = remoteCfg && remoteCfg.defaultModel && allowed.includes(remoteCfg.defaultModel)
    ? remoteCfg.defaultModel
    : (allowed[0] || 'flash-lite');
  if (remoteCfg && remoteCfg.modelSelectorVisible === false) {
    try { sessionStorage.removeItem(MODEL_STORAGE_KEY); } catch (_) {}
    return backendDefault;
  }
  return readStoredModel(allowed) || backendDefault;
}

/* ── State ────────────────────────────────────────────────────────────── */

const atlasState = {
  history:   /** @type {Array<{role:'user'|'model', text:string}>} */ ([]),
  inFlight:  false,
  variant:   null,  // { id, label, chips }  resolved on first render
  model:     readStoredModel(), // may be overridden after remote config loads
  usage:     null,
};

export function resetAtlasState() {
  atlasState.history = [];
  atlasState.inFlight = false;
  // Variant is intentionally NOT reset — it's session-sticky on purpose.
}

/* ── Render ───────────────────────────────────────────────────────────── */

export async function renderFreeFormMode() {
  const overlay = document.getElementById('assistantOverlay');
  if (overlay) overlay.setAttribute('data-mode', 'freeform');

  // Hide the step-progress bar — there are no fixed steps in free-form.
  const track = document.querySelector('.ga-progress-track');
  if (track) track.style.display = 'none';

  // Show the "Start over" header button (atlas mode reuses the same
  // button — chat.js shows it for signed-in users in guided mode too).
  const startBtn = document.getElementById('gaStartOverBtn');
  if (startBtn) {
    startBtn.removeAttribute('hidden');
    startBtn.title = 'Start over';
    startBtn.onclick = startOver;
  }

  const msgs = document.getElementById('gaMessages');
  const area = document.getElementById('gaInputArea');
  if (!msgs || !area) return;

  msgs.innerHTML = '';
  area.innerHTML = '';

  // Fetch remote config (which models are enabled, whether picker is shown).
  // This is fast (cached) and runs in parallel with the conversation restore.
  const remoteCfg = await fetchAtlasConfig();
  const enabledModels = (remoteCfg.enabledModels || []).filter(function (k) { return !!MODEL_OPTIONS[k]; });
  if (enabledModels.length === 0) enabledModels.push('flash-lite');
  // Backend default is authoritative; stored choice only applies when the picker is enabled.
  atlasState.model = resolveInitialModel(remoteCfg, enabledModels);

  // Render the input bar early so it's there even while we wait for the
  // server to load any saved conversation.
  renderFreeFormInput(area, remoteCfg, enabledModels);
  refreshUsageSummary();

  // Try to restore a saved conversation. If found, replay it; otherwise
  // show the greeting + suggested chips.
  const restored = await fetchSavedConversation();
  if (restored && restored.length) {
    replayHistory(restored);
    atlasState.history = restored.slice();
    return;
  }
  renderSuggestedChips(msgs);
}

function replayHistory(turns) {
  for (const t of turns) {
    if (!t || !t.text) continue;
    if (t.role === 'user')        appendUserBubble(t.text);
    else if (t.role === 'model')  appendBotBubble(t.text);
  }
}

function renderSuggestedChips(msgs) {
  const variant = atlasState.variant || (atlasState.variant = chooseVariant());

  const wrap = document.createElement('div');
  wrap.className = 'ga-atlas-chips';
  wrap.setAttribute('aria-label', 'Suggested questions');
  wrap.setAttribute('data-variant', variant.id);

  variant.chips.forEach(function (q) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ga-atlas-chip';
    chip.textContent = q;
    chip.onclick = function () { sendAtlasMessage(q); };
    wrap.appendChild(chip);
  });

  msgs.appendChild(wrap);
  scrollToBottom();
}

function renderFreeFormInput(area, remoteCfg, enabledModels) {
  renderBudgetStatus(area);
  // Default to hiding the model picker when config is missing (e.g. refresh/reset path).
  // The backend config fetch on renderFreeFormMode() is the source of truth.
  const showPicker = !!(remoteCfg && remoteCfg.modelSelectorVisible === true);
  if (showPicker) renderModelSelector(area, enabledModels);
  const { row, input, button } = createInputRow({
    rowClass:    'ga-input-row ga-atlas-input-row',
    inputClass:  'ga-text-input ga-atlas-input',
    placeholder: 'Ask Atlas anything…',
    maxLength:   1000,
    onSubmit:    function (raw) {
      const v = (raw || '').trim();
      if (!v) return;
      input.value = '';
      sendAtlasMessage(v);
    },
  });
  input.id  = 'gaAtlasInput';
  button.id = 'gaAtlasSendBtn';

  area.appendChild(row);
  setTimeout(function () { input.focus(); }, 50);
}

function renderBudgetStatus(area) {
  const wrap = document.createElement('div');
  wrap.id = 'gaAtlasBudget';
  wrap.className = 'ga-atlas-budget';
  wrap.textContent = 'Monthly Atlas budget: checking usage…';
  area.appendChild(wrap);
}

function renderModelSelector(area, enabledModels) {
  const allowed = enabledModels || Object.keys(MODEL_OPTIONS);
  // Only render when there are 2+ models — no point showing a picker for one.
  if (allowed.length < 2) return;

  const wrap = document.createElement('div');
  wrap.className = 'ga-atlas-model-picker';
  wrap.setAttribute('aria-label', 'Atlas response mode');

  allowed.forEach(function (key) {
    const opt = MODEL_OPTIONS[key];
    if (!opt) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ga-atlas-model-btn';
    btn.setAttribute('data-model', key);
    btn.setAttribute('aria-pressed', String(atlasState.model === key));
    btn.innerHTML = '<span>' + escapeHtml(opt.label) + '</span><small>' + escapeHtml(opt.detail) + '</small>';
    btn.onclick = function () {
      if (atlasState.inFlight) return;
      atlasState.model = key;
      try { sessionStorage.setItem(MODEL_STORAGE_KEY, key); } catch (_) {}
      updateModelPicker(wrap);
    };
    wrap.appendChild(btn);
  });

  area.appendChild(wrap);
}

function updateModelPicker(wrap) {
  wrap.querySelectorAll('.ga-atlas-model-btn').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute('data-model') === atlasState.model));
  });
}

/* ── Send / receive ───────────────────────────────────────────────────── */

async function sendAtlasMessage(text) {
  if (atlasState.inFlight) return;

  // Remove suggested chips on first turn so they don't keep eating space
  const chips = document.querySelector('.ga-atlas-chips');
  if (chips) chips.remove();

  appendUserBubble(text);

  setSendDisabled(true);
  atlasState.inFlight = true;

  // Try the streaming endpoint first; fall back to the JSON one if SSE
  // isn't reachable for any reason (proxy, browser, transient error).
  try {
    const ok = await streamAsk(text, atlasState.history);
    if (!ok) {
      await fallbackJsonAsk(text, atlasState.history);
    }
  } finally {
    atlasState.inFlight = false;
    setSendDisabled(false);
    const inp = document.getElementById('gaAtlasInput');
    if (inp) inp.focus();
  }
}

function buildRequestHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history
    .filter(function (turn) {
      return turn
        && (turn.role === 'user' || turn.role === 'model')
        && typeof turn.text === 'string'
        && turn.text.trim();
    })
    .slice(-MAX_CLIENT_HISTORY_TURNS)
    .map(function (turn) {
      return {
        role: turn.role,
        text: turn.text,
      };
    });
}

function isLocalAtlasDevRuntime() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

function getAtlasAuthToken() {
  if (hasFreshGoogleCredential()) return googleCredential;
  if (isLocalAtlasDevRuntime()) return LOCAL_ATLAS_DEV_TOKEN;
  return '';
}

/**
 * Stream the reply from /api/atlas/stream. Returns true on success
 * (streamed and got a `done` event), false on a soft failure that
 * should fall back to JSON. Throws are caught here too — they also
 * count as a soft failure.
 */
async function streamAsk(message, history) {
  const authToken = getAtlasAuthToken();
  if (!authToken) {
    handleInvalidGoogleCredential();
    return true;  // No fallback — same outcome with JSON.
  }

  let resp;
  const startedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATLAS_STREAM_TIMEOUT_MS);
  const requestHistory = buildRequestHistory(history);
  try {
    resp = await fetch('/api/atlas/stream', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type':  'application/json',
        'Accept':        'text/event-stream',
      },
      body: JSON.stringify({ message, history: requestHistory, model: atlasState.model }),
      signal: controller.signal,
    });
  } catch (_e) {
    // Network failure — try JSON next.
    clearTimeout(timeout);
    return false;
  }

  if (!resp.ok || !resp.body) {
    // Surface the structured error from the JSON envelope, then bail
    // out (don't fall back — the JSON path will hit the same error).
    let body = null;
    try { body = await resp.json(); } catch (_) {}
    if (resp.status === 401) {
      handleInvalidGoogleCredential();
      clearTimeout(timeout);
      return true;
    }
    const retryAfterSecFromBody = Number(body && (body.retryAfterSec || body.retryAfterSeconds));
    const retryAfterSec = (resp.status === 429 && Number.isFinite(retryAfterSecFromBody) && retryAfterSecFromBody > 0)
      ? Math.ceil(retryAfterSecFromBody)
      : ((resp.status === 429) ? parseRateLimitResetSeconds(resp.headers) : 0);
    const errText = formatAtlasHttpError(resp, body);
    appendErrorBubble(errText, retryAfterSec ? { countdownSeconds: retryAfterSec } : undefined);
    clearTimeout(timeout);
    return true;
  }

  // Open a streaming bubble that we'll fill chunk-by-chunk.
  const bubbleWrap = appendTypingIndicator();
  const bubble = bubbleWrap.querySelector('.ga-bubble');
  let acc = '';
  let typingRemoved = false;
  let final = '';
  let usage = null;
  let cached = false;
  let plan = null;
  let webSearch = null;
  let routing = null;

  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

        if (parsed.error) {
          if (bubbleWrap && bubbleWrap.parentNode) bubbleWrap.remove();
          const retryAfterSecFromParsed = Number(parsed && (parsed.retryAfterSec || parsed.retryAfterSeconds));
          const retryAfterSec = (Number.isFinite(retryAfterSecFromParsed) && retryAfterSecFromParsed > 0)
            ? Math.ceil(retryAfterSecFromParsed)
            : 0;
          appendErrorBubble(parsed.error, retryAfterSec ? { countdownSeconds: retryAfterSec } : undefined);
          return true;
        }

        if (typeof parsed.chunk === 'string') {
          // Reuse the same placeholder bubble for streamed content so Atlas
          // doesn't show a second empty bot shell before the first chunk lands.
          if (!typingRemoved && bubble) {
            bubble.classList.remove('ga-typing');
            bubble.classList.add('ga-md');
            typingRemoved = true;
          }
          acc += parsed.chunk;
          if (bubble) bubble.innerHTML = renderMarkdown(acc);
          scrollToBottom();
        }

        if (typeof parsed.done === 'string') {
          final = parsed.done;
          usage = parsed.usage || null;
          cached = !!parsed.cached;
          plan = parsed.plan || null;
          webSearch = parsed.webSearch || null;
          routing = parsed.routing || null;
          if (bubble) {
            bubble.classList.remove('ga-typing');
            bubble.classList.add('ga-md');
            const cleaned = stripAnswerSourcesBlock(final, webSearch);
            bubble.dataset.copyText = cleaned;
            bubble.innerHTML = renderMarkdown(cleaned);
            transformInlineSources(bubble, webSearch && webSearch.sources);
            ensureCopyButton(bubbleWrap);
          }
        }
      }
    }
  } catch (_e) {
    if (bubbleWrap && bubbleWrap.parentNode) bubbleWrap.remove();
    return false;  // Try JSON fallback.
  } finally {
    clearTimeout(timeout);
  }

  // Update local history with the AUTHORITATIVE final text (the server
  // sanitises after streaming completes — we mirror that, not the raw
  // accumulated chunks).
  const answer = final || acc;
  if (answer) {
    atlasState.history.push({ role: 'user',  text: message });
    atlasState.history.push({ role: 'model', text: answer });
    if (usage && cached) usage.cached = true;
    appendToolsMeta(bubbleWrap, { plan, webSearch });
    transformInlineSources(bubbleWrap && bubbleWrap.querySelector ? bubbleWrap.querySelector('.ga-bubble') : null, webSearch && webSearch.sources);
    appendUsageMeta(bubbleWrap, usage, {
      latencyMs: ((typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()) - startedAt,
      routing,
    });
    setTimeout(refreshUsageSummary, 800);
  } else if (bubbleWrap && bubbleWrap.parentNode) {
    bubbleWrap.remove();
  }
  return true;
}

/**
 * JSON-only fallback for browsers / networks that can't do SSE.
 */
async function fallbackJsonAsk(message, history) {
  const typing = appendTypingIndicator();
  const startedAt = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  try {
    const res = await postAskJson(message, history);
    if (!res.ok) {
      if (res.status === 401) {
        handleInvalidGoogleCredential();
        return;
      }
      const retryAfterSecFromBody = Number(res.body && (res.body.retryAfterSec || res.body.retryAfterSeconds));
      const retryAfterSec = (res.status === 429 && Number.isFinite(retryAfterSecFromBody) && retryAfterSecFromBody > 0)
        ? Math.ceil(retryAfterSecFromBody)
        : ((res.status === 429) ? parseRateLimitResetSeconds(res.headers) : 0);
      const errText = (res.status === 429)
        ? formatAtlasRateLimitMessage(res.headers, res.body)
        : ((res.body && (res.body.error || res.body.message)) || friendlyHttpError(res.status));
      appendErrorBubble(errText, retryAfterSec ? { countdownSeconds: retryAfterSec } : undefined);
      return;
    }
    const answer = (res.body && res.body.answer)
      || "I couldn't generate a response. Please try again.";
    const webSearch = res.body && res.body.webSearch;
    const cleaned = stripAnswerSourcesBlock(answer, webSearch);
    const bubbleWrap = appendBotBubble(cleaned);
    const usage = res.body && res.body.usage;
    const routing = res.body && res.body.routing;
    const plan = res.body && res.body.plan;
    if (usage && res.body && res.body.cached) usage.cached = true;
    appendToolsMeta(bubbleWrap, { plan, webSearch });
    transformInlineSources(bubbleWrap && bubbleWrap.querySelector ? bubbleWrap.querySelector('.ga-bubble') : null, webSearch && webSearch.sources);
    appendUsageMeta(bubbleWrap, usage, {
      latencyMs: ((typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()) - startedAt,
      routing,
    });
    setTimeout(refreshUsageSummary, 800);
    atlasState.history.push({ role: 'user',  text: message });
    atlasState.history.push({ role: 'model', text: answer });
  } catch (_e) {
    appendErrorBubble("Network error — please try again.");
  } finally {
    if (typing && typing.parentNode) typing.remove();
  }
}

async function postAskJson(message, history) {
  const authToken = getAtlasAuthToken();
  if (!authToken) {
    return { ok: false, status: 401, body: { error: friendlyHttpError(401) } };
  }
  let resp;
  const requestHistory = buildRequestHistory(history);
  try {
    resp = await fetch('/api/atlas/ask', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + authToken,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ message, history: requestHistory, model: atlasState.model }),
    });
  } catch (e) {
    throw new Error('Network error reaching Atlas.', { cause: e });
  }
  let body = null;
  try { body = await resp.json(); } catch (_) {}
  return { ok: resp.ok, status: resp.status, body, headers: resp.headers };
}

function friendlyHttpError(status) {
  if (status === 401) return "You'll need to sign in with Google to chat with Atlas.";
  if (status === 429) return "You've reached the hourly limit for Atlas — please try again later or use the Get In Touch form.";
  if (status === 503) return "Atlas isn't available right now. Please try again in a few minutes.";
  if (status === 422) return "Atlas couldn't generate a safe response to that. Try rephrasing.";
  return "Something went wrong on our end. Please try again.";
}

function parseRateLimitResetSeconds(headers) {
  if (!headers || typeof headers.get !== 'function') return 0;
  const raw = String(
    headers.get('RateLimit-Reset')
    || headers.get('Retry-After')
    || ''
  ).trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Heuristics:
  // - RateLimit-Reset (draft-7) is delta-seconds.
  // - Retry-After can be delta-seconds.
  // - If a server ever sends epoch seconds/ms, handle it gracefully.
  if (n > 1e12) return Math.max(0, Math.ceil((n - Date.now()) / 1000));
  if (n > 1e9)  return Math.max(0, Math.ceil(n - (Date.now() / 1000)));
  return Math.ceil(n);
}

function formatDurationSeconds(sec) {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  if (!s) return '';
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + 'm ' + String(r).padStart(2, '0') + 's';
}

function formatAtlasRateLimitMessage(headers, body) {
  const limit = headers && typeof headers.get === 'function'
    ? String(headers.get('RateLimit-Limit') || '').trim()
    : '';
  const resetSec = parseRateLimitResetSeconds(headers);
  const base = (body && (body.error || body.message))
    ? String(body.error || body.message)
    : "You've reached the hourly limit for Atlas.";
  const cap = limit || '30';
  const wait = resetSec ? formatDurationSeconds(resetSec) : '';
  if (wait) {
    return `You've hit the Atlas rate limit (${cap} requests/hour). Try again in ${wait}.`;
  }
  return base;
}

function formatAtlasHttpError(resp, body) {
  if (resp && resp.status === 429) {
    return formatAtlasRateLimitMessage(resp.headers, body);
  }
  return (body && (body.error || body.message)) || friendlyHttpError(resp ? resp.status : 0);
}

function hasFreshGoogleCredential() {
  if (!googleCredential) return false;
  try {
    const payload = decodeJwtPayload(googleCredential);
    const exp = Number(payload && payload.exp);
    return Number.isFinite(exp) && exp > (Date.now() / 1000) + GOOGLE_TOKEN_EXPIRY_SKEW_SECONDS;
  } catch (_) {
    return false;
  }
}

function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) throw new Error('Missing JWT payload.');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

function handleInvalidGoogleCredential() {
  setGoogleCredential(null);
  if (isLocalAtlasDevRuntime()) {
    appendErrorBubble('Atlas local auth reset. Retrying with localhost dev access.');
    return;
  }
  appendErrorBubble("Your Google sign-in expired. Please sign in again to chat with Atlas.");
  if (typeof window.showWelcomeOverlay === 'function') window.showWelcomeOverlay();
}

/* ── Persistence ──────────────────────────────────────────────────────── */

async function fetchSavedConversation() {
  const authToken = getAtlasAuthToken();
  if (!authToken) return null;
  try {
    const resp = await fetch('/api/atlas/conversations/active', {
      method:  'GET',
      headers: { 'Authorization': 'Bearer ' + authToken },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.success && data.conversation && Array.isArray(data.conversation.turns)) {
      return data.conversation.turns;
    }
  } catch (_) {}
  return null;
}

async function fetchUsageSummary() {
  const authToken = getAtlasAuthToken();
  if (!authToken) return null;
  try {
    const resp = await fetch('/api/atlas/usage', {
      method:  'GET',
      headers: { 'Authorization': 'Bearer ' + authToken },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.success ? data.usage : null;
  } catch (_) {
    return null;
  }
}

async function refreshUsageSummary() {
  const usage = await fetchUsageSummary();
  if (!usage) return;
  atlasState.usage = usage;
  renderBudgetUsage(usage);
}

function renderBudgetUsage(usage) {
  const el = document.getElementById('gaAtlasBudget');
  if (!el) return;
  const month = usage.month || {};
  const budget = Number(usage.monthlyBudgetInr || 100);
  const used = Number(month.estimatedInr || 0);
  const pct = budget ? Math.min(100, (used / budget) * 100) : 0;
  el.innerHTML = ''
    + '<div class="ga-atlas-budget-row">'
    + '<span>Monthly Atlas budget</span>'
    + '<strong>' + formatInr(used) + ' used of ₹' + budget.toFixed(0) + '</strong>'
    + '</div>'
    + '<div class="ga-atlas-budget-bar" aria-hidden="true"><span style="width: '
    + pct.toFixed(1) + '%"></span></div>'
    + '<div class="ga-atlas-budget-note">Across all visitors this month · '
    + formatNumber(month.totalTokens || 0) + ' tokens</div>';
}

async function startOver() {
  if (atlasState.inFlight) return;

  await fetchUsageSummary();

  // Wipe server-side history first (best effort) so a refresh doesn't
  // resurrect the old conversation.
  const authToken = getAtlasAuthToken();
  if (authToken) {
    try {
      await fetch('/api/atlas/conversations/active', {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + authToken },
      });
    } catch (_) { /* fall through — local reset still happens */ }
  }

  // Reset local state and re-render the greeting + chips.
  atlasState.history = [];
  const msgs = document.getElementById('gaMessages');
  const area = document.getElementById('gaInputArea');
  if (msgs) msgs.innerHTML = '';
  if (area) {
    area.innerHTML = '';
    renderFreeFormInput(area);
  }
  appendBotBubble(
    "Fresh start. Ask me anything about Abhinav."
  );
  if (msgs) renderSuggestedChips(msgs);
  setTimeout(refreshUsageSummary, 800);
}

/* ── Bubbles ──────────────────────────────────────────────────────────── */
//
// All four append* helpers funnel through `appendBubble`. Each variant only
// differs by the wrap classes, the bubble classes, and how the inner HTML
// is rendered (markdown / textContent / static dots). Centralising kills the
// near-identical boilerplate that SAST tools flag as duplication, and makes
// future bubble types a 1-liner.

function appendBubble(opts) {
  const msgs = document.getElementById('gaMessages');
  if (!msgs) return null;

  const wrap   = document.createElement('div');
  wrap.className = opts.wrapClass;

  const bubble = document.createElement('div');
  bubble.className = opts.bubbleClass;
  if (typeof opts.copyText === 'string' && opts.copyText.trim()) {
    bubble.dataset.copyText = opts.copyText;
  }

  if (opts.markdown != null) {
    bubble.innerHTML = renderMarkdown(opts.markdown || '');
  } else if (opts.text != null) {
    bubble.textContent = opts.text;
  } else if (opts.html != null) {
    bubble.innerHTML = opts.html;
  }

  wrap.appendChild(bubble);
  msgs.appendChild(wrap);
  scrollToBottom();

  if (opts.animate) {
    setTimeout(function () { wrap.classList.remove('ga-msg-enter'); }, 300);
  }
  return wrap;
}

function ensureCopyButton(wrap) {
  if (!wrap || wrap.querySelector('.ga-bubble-copy-btn')) return;
  const bubble = wrap.querySelector('.ga-bubble');
  if (!bubble) return;
  if (!bubble.classList.contains('ga-bubble-bot')) return;
  if (bubble.classList.contains('ga-bubble-error')) return;
  if (bubble.classList.contains('ga-typing')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ga-bubble-copy-btn';
  btn.setAttribute('aria-label', 'Copy response');
  btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span>';
  btn.onclick = async function () {
    const text = String(bubble.dataset.copyText || '').trim() || String(bubble.textContent || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('ga-bubble-copy-btn--copied');
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'check';
      setTimeout(function () {
        btn.classList.remove('ga-bubble-copy-btn--copied');
        if (icon) icon.textContent = 'content_copy';
      }, 900);
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_2) {}
    }
  };

  bubble.appendChild(btn);
}

function appendBotBubble(markdown) {
  const wrap = appendBubble({
    wrapClass:   'ga-msg ga-msg-bot ga-msg-enter',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-md',
    markdown:    markdown,
    copyText:    String(markdown || ''),
    animate:     true,
  });
  ensureCopyButton(wrap);
  // Best-effort: even without webSearch metadata, convert obvious
  // "(Publisher)" tokens (e.g. "(TODAY Show)") into pills.
  try {
    transformInlineSources(wrap && wrap.querySelector ? wrap.querySelector('.ga-bubble') : null, null);
  } catch (_) {}
  return wrap;
}

function stripAnswerSourcesBlock(text, _webSearch) {
  // Remove any "Sources:" / "Sources" section in the model answer, because
  // we render sources in the compact UI below the bubble.
  let t = String(text || '');

  // Pattern A: "Sources: A, B, C" (single line)
  t = t.replace(/(?:^|\n)\s*Sources:\s*[^\n]*\s*(?=\n|$)/gi, '\n');

  // Pattern B: "Sources:" followed by bullet lines
  t = t.replace(
    /(?:^|\n)\s*Sources:\s*(?:\n\s*[-*•]\s+[^\n]+)*/gi,
    '\n'
  );

  // Pattern C: "Sources" heading followed by bullets
  t = t.replace(
    /(?:^|\n)\s*Sources\s*(?:\n\s*[-*•]\s+[^\n]+)*/gi,
    '\n'
  );

  // Also remove common variants with markdown bolding.
  t = t.replace(
    /(?:^|\n)\s*\*{0,2}Sources\*{0,2}\s*:\s*(?:\n\s*[-*•]\s+[^\n]+)*/gi,
    '\n'
  );

  // Normalize extra blank lines introduced by removals.
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function appendUserBubble(text) {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-user ga-msg-enter',
    bubbleClass: 'ga-bubble ga-bubble-user',
    text:        text,
    animate:     true,
  });
}

function formatCountdown(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

function parseRetrySecondsFromText(text) {
  const t = String(text || '');
  const m = t.match(/retry\s+in\s+~?(\d+(?:\.\d+)?)s/i);
  if (!m) return 0;
  const sec = Number(m[1]);
  // Gemini sometimes emits extremely small retry hints (e.g. 0.2s) that
  // are not practical/accurate for a human-facing countdown. Add a small
  // floor to avoid flashing "00:00" immediately.
  return Number.isFinite(sec) && sec > 0 ? Math.min(3600, Math.max(5, Math.ceil(sec))) : 0;
}

function startCountdown(span, seconds) {
  if (!span) return;
  let left = Math.max(0, Math.floor(Number(seconds || 0)));
  span.textContent = formatCountdown(left);
  if (!left) return;

  // Prevent multiple timers on the same node.
  try {
    if (span._gaCountdownTimer) clearInterval(span._gaCountdownTimer);
  } catch (_) {}

  span._gaCountdownTimer = setInterval(function () {
    left = Math.max(0, left - 1);
    span.textContent = formatCountdown(left);
    if (left <= 0) {
      try { clearInterval(span._gaCountdownTimer); } catch (_) {}
      span._gaCountdownTimer = null;
      try { span.classList.add('ga-atlas-countdown--done'); } catch (_) {}
      // Re-enable sending after the cooldown window is reached.
      try { setSendDisabled(false); } catch (_) {}
    }
  }, 1000);
}

function renderErrorWithCountdownHtml(text, seconds) {
  const raw = String(text || '').trim();
  const safe = escapeHtml(raw);
  const sec = Math.max(0, Math.floor(Number(seconds || 0)));
  if (!sec) return safe;

  const replacement = '<span class="ga-atlas-countdown-wrap">retry in <span class="ga-atlas-countdown" data-seconds="' + String(sec) + '">' + formatCountdown(sec) + '</span></span>';
  if (/retry\s+in\s+~?\d+(?:\.\d+)?s/i.test(raw)) {
    return safe.replace(/retry\s+in\s+~?\d+(?:\.\d+)?s/i, replacement);
  }

  // Also handle Atlas limiter message: "Try again in 1m 05s."
  if (/try again in\s+\d+m\s+\d{2}s\.?/i.test(raw) || /try again in\s+\d+s\.?/i.test(raw)) {
    return safe.replace(/try again in\s+(?:\d+m\s+\d{2}s|\d+s)\.?/i, function () {
      return 'Try again in <span class="ga-atlas-countdown" data-seconds="' + String(sec) + '">' + formatCountdown(sec) + '</span>.';
    });
  }

  return safe + ' <span class="ga-atlas-countdown-wrap">Try again in <span class="ga-atlas-countdown" data-seconds="' + String(sec) + '">' + formatCountdown(sec) + '</span>.</span>';
}

function appendErrorBubble(text, opts) {
  const explicit = opts && Number.isFinite(Number(opts.countdownSeconds)) ? Number(opts.countdownSeconds) : 0;
  const inferred = explicit > 0 ? 0 : parseRetrySecondsFromText(text);
  const countdownSecondsRaw = explicit > 0 ? explicit : inferred;
  const countdownSeconds = countdownSecondsRaw > 0 ? Math.max(5, Math.ceil(countdownSecondsRaw)) : 0;

  const wrap = appendBubble({
    wrapClass:   'ga-msg ga-msg-bot',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-bubble-error',
    html:        renderErrorWithCountdownHtml(text, countdownSeconds),
  });
  // Start ticking if we rendered a countdown span.
  try {
    const span = wrap ? wrap.querySelector('.ga-atlas-countdown') : null;
    if (span && countdownSeconds > 0) {
      // While the countdown is active, prevent users from spamming sends
      // that are very likely to get 429 again.
      try { setSendDisabled(true); } catch (_) {}
      startCountdown(span, countdownSeconds);
    }
  } catch (_) {}
  // UX: when an error happens after a long answer, keep the error bubble
  // aligned with the previous usage strip width so the thread looks stable.
  try {
    const msgs = document.getElementById('gaMessages');
    const usageEls = msgs ? msgs.querySelectorAll('.ga-atlas-usage') : null;
    const lastUsage = usageEls && usageEls.length ? usageEls[usageEls.length - 1] : null;
    const w = lastUsage ? Math.ceil(lastUsage.getBoundingClientRect().width || 0) : 0;
    if (wrap && w > 0) {
      const bubble = wrap.querySelector('.ga-bubble');
      if (bubble) {
        bubble.style.width = w + 'px';
        bubble.style.maxWidth = w + 'px';
      }
    }
  } catch (_) {}
  return wrap;
}

function appendTypingIndicator() {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-bot',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-typing',
    html:        '<span class="ga-typing-dot"></span><span class="ga-typing-dot"></span><span class="ga-typing-dot"></span>',
  });
}

function appendUsageMeta(wrap, usage, extras) {
  if (!wrap || !usage) return;
  const meta = document.createElement('div');
  meta.className = 'ga-atlas-usage';
  const latencyMs = Number(extras && extras.latencyMs);
  const latencyLabel = Number.isFinite(latencyMs) && latencyMs > 0
    ? formatDurationMs(latencyMs)
    : '';
  const routing = extras && extras.routing;
  const routingNote = (routing && routing.usedFallback && routing.fromModel && routing.toModel)
    ? (function () {
      const from = String(routing.fromModel || '');
      const to = String(routing.toModel || '');
      const reason = String(routing.reason || '');
      const fromLabel = (from === 'flash-lite') ? 'Flash‑Lite' : titleCaseWords(from.replace(/-/g, ' '));
      const toLabel = (to === 'flash') ? 'Flash' : titleCaseWords(to.replace(/-/g, ' '));
      const tail = (reason === 'FREE_TIER_LIMIT') ? ' (free-tier limit)' : '';
      return `Switched: ${fromLabel} → ${toLabel}${tail}`;
    })()
    : '';
  if (usage.cached) {
    meta.classList.add('ga-atlas-usage-cache');
    meta.innerHTML = ''
      + '<span class="ga-atlas-usage-item ga-atlas-usage-item-strong">Cached response</span>'
      + '<span class="ga-atlas-usage-dot" aria-hidden="true"></span>'
      + '<span class="ga-atlas-usage-item">0 tokens</span>'
      + '<span class="ga-atlas-usage-dot" aria-hidden="true"></span>'
      + '<span class="ga-atlas-usage-item">₹0.00</span>'
      + (latencyLabel
        ? '<span class="ga-atlas-usage-dot" aria-hidden="true"></span><span class="ga-atlas-usage-item">' + escapeHtml(latencyLabel) + '</span>'
        : '');
    wrap.appendChild(meta);
    syncUsageWidth(wrap, meta);
    scrollToBottom();
    return;
  }

  const totalTokens = Number(usage.totalTokens || 0);
  const estimatedInr = Number(usage.estimatedInr || 0);
  if (!totalTokens && !estimatedInr) return;

  const modelLabel = escapeHtml(usage.modelLabel || usage.model || 'LLM');
  meta.innerHTML = ''
    + '<span class="ga-atlas-usage-item ga-atlas-usage-item-strong">' + modelLabel + '</span>'
    + '<span class="ga-atlas-usage-dot" aria-hidden="true"></span>'
    + '<span class="ga-atlas-usage-item">' + escapeHtml(formatNumber(totalTokens)) + ' tokens</span>'
    + '<span class="ga-atlas-usage-dot" aria-hidden="true"></span>'
    + '<span class="ga-atlas-usage-item">' + escapeHtml(formatInr(estimatedInr)) + '</span>'
    + (routingNote
      ? '<span class="ga-atlas-usage-dot" aria-hidden="true"></span><span class="ga-atlas-usage-item">' + escapeHtml(routingNote) + '</span>'
      : '')
    + (latencyLabel
      ? '<span class="ga-atlas-usage-dot" aria-hidden="true"></span><span class="ga-atlas-usage-item">' + escapeHtml(latencyLabel) + '</span>'
      : '');
  wrap.appendChild(meta);
  syncUsageWidth(wrap, meta);
  scrollToBottom();
}

function appendToolsMeta(_wrap, _meta) {
  // UX: the chat window is small. Inline source pills per bullet are enough.
  // Remove the extra "Web search" and "Sources" UI block entirely.
  return;
}

/* ── Inline source pills inside bot answers ────────────────────────────── */

let _inlineSourceHoverInit = false;
let _openInlineSourceTooltip = null;

function initInlineSourceHover() {
  if (_inlineSourceHoverInit) return;
  _inlineSourceHoverInit = true;

  document.addEventListener('pointerover', function (evt) {
    const el = evt && evt.target ? evt.target.closest('.ga-atlas-inline-source-pill') : null;
    if (!el) return;
    const title = el.getAttribute('data-source-title') || '';
    const url = el.getAttribute('data-source-url') || '';
    if (!title && !url) return;
    showInlineSourceTooltip(el, { title, url });
  }, { passive: true });

  document.addEventListener('pointerout', function (evt) {
    const el = evt && evt.target ? evt.target.closest('.ga-atlas-inline-source-pill') : null;
    if (!el) return;
    const to = evt && evt.relatedTarget ? evt.relatedTarget : null;
    if (to && _openInlineSourceTooltip && _openInlineSourceTooltip.contains(to)) return;
    hideInlineSourceTooltip();
  }, { passive: true });

  document.addEventListener('scroll', function () {
    hideInlineSourceTooltip();
  }, { passive: true, capture: true });

  window.addEventListener('resize', function () {
    hideInlineSourceTooltip();
  }, { passive: true });
}

function hideInlineSourceTooltip() {
  if (_openInlineSourceTooltip && _openInlineSourceTooltip.parentNode) {
    _openInlineSourceTooltip.parentNode.removeChild(_openInlineSourceTooltip);
  }
  _openInlineSourceTooltip = null;
}

function showInlineSourceTooltip(anchorEl, { title, url } = {}) {
  hideInlineSourceTooltip();
  const tip = document.createElement('div');
  tip.className = 'ga-atlas-inline-source-tooltip';
  tip.setAttribute('role', 'tooltip');

  const host = hostnameFromUrl(url);
  const safeTitle = escapeHtml(String(title || '').trim() || (host ? host : 'Source'));
  const safeHost = escapeHtml(host || '');
  const safeUrl = escapeHtml(url || '');

  tip.innerHTML = ''
    + '<div class="ga-atlas-inline-source-tooltip-top">'
    + '  <div class="ga-atlas-inline-source-tooltip-title">' + safeTitle + '</div>'
    + (safeHost ? '<div class="ga-atlas-inline-source-tooltip-host">' + safeHost + '</div>' : '')
    + '</div>'
    + (safeUrl ? '<a class="ga-atlas-inline-source-tooltip-link" href="' + safeUrl + '" target="_blank" rel="noopener">Open</a>' : '');

  document.body.appendChild(tip);
  _openInlineSourceTooltip = tip;

  const rect = anchorEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const pad = 10;

  let left = rect.left;
  left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));
  let top = rect.bottom + 10;
  if (top + tipRect.height + pad > window.innerHeight) {
    top = rect.top - tipRect.height - 10;
  }
  top = Math.max(pad, Math.min(top, window.innerHeight - tipRect.height - pad));

  tip.style.left = left + 'px';
  tip.style.top = top + 'px';

  tip.addEventListener('pointerleave', function () {
    hideInlineSourceTooltip();
  }, { passive: true });
}

function normalizeKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildSourceIndex(sources) {
  const idx = new Map();
  (Array.isArray(sources) ? sources : []).forEach(function (s) {
    if (!s || typeof s !== 'object') return;
    const url = String(s.url || '').trim();
    const title = String(s.title || '').trim();
    const badge = sourceBadgeFromUrl(url) || hostnameFromUrl(url) || '';
    const keys = [];
    if (badge) keys.push(badge);
    if (title) keys.push(title);
    const host = hostnameFromUrl(url);
    if (host) keys.push(host);
    if (host) {
      const parts = host.split('.').filter(Boolean);
      if (parts.length >= 2) keys.push(parts[parts.length - 2]);
    }
    // Add a couple of common title normalizations so "(The X)" can map.
    if (badge && /^the\s+/i.test(badge)) keys.push(String(badge).replace(/^the\s+/i, ''));
    if (badge && !/^the\s+/i.test(badge)) keys.push('the ' + badge);
    if (title && /^the\s+/i.test(title)) keys.push(String(title).replace(/^the\s+/i, ''));
    if (title && !/^the\s+/i.test(title)) keys.push('the ' + title);
    keys.forEach(function (k) {
      const nk = normalizeKey(k);
      if (!nk) return;
      if (idx.has(nk)) return;
      idx.set(nk, { title, url, badge });
    });
  });
  return idx;
}

function shouldSkipInlinePillTransform(node) {
  if (!node) return true;
  const p = node.parentElement;
  if (!p) return false;
  return !!p.closest('a, code, pre, kbd, samp');
}

function replaceTextNode(node, replacements) {
  if (!node || !node.parentNode) return;
  const text = node.nodeValue || '';
  if (!text) return;
  const frag = document.createDocumentFragment();
  let cursor = 0;
  replacements.forEach(function (r) {
    if (r.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, r.start)));
    if (r.before) frag.appendChild(document.createTextNode(r.before));
    frag.appendChild(r.el);
    if (r.after) frag.appendChild(document.createTextNode(r.after));
    cursor = r.end;
  });
  if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
  node.parentNode.replaceChild(frag, node);
}

function makeInlineSourcePill(label, info, displayText) {
  const raw = String(label || '').trim();
  let text = String(displayText != null ? displayText : raw).trim();
  if (!text) text = raw;
  const title = info && (info.title || info.badge || raw) ? String(info.title || info.badge || raw).trim() : raw;
  const url = info && info.url ? String(info.url) : '';
  const el = document.createElement(url ? 'a' : 'span');
  el.className = 'ga-atlas-inline-source-pill';
  el.textContent = text;
  if (url) {
    el.setAttribute('href', url);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener');
  }
  if (title) el.setAttribute('data-source-title', title);
  if (url) el.setAttribute('data-source-url', url);
  return el;
}

function transformInlineSources(rootEl, sources) {
  if (!rootEl) return;
  initInlineSourceHover();

  const idx = buildSourceIndex(sources);

  // 1) Transform "Sources: A, B, C" lines into pills.
  const paras = rootEl.querySelectorAll('p');
  paras.forEach(function (p) {
    const raw = (p.textContent || '').trim();
    if (!raw) return;
    // Case A: "Sources: X, Y, Z"
    const m = raw.match(/^Sources:\s*(.+)$/i);
    if (m) {
      const list = m[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!list.length) return;
      p.innerHTML = '<strong>Sources:</strong> ';
      list.forEach(function (label, i) {
        const info = idx.get(normalizeKey(label));
        p.appendChild(makeInlineSourcePill(label, info));
        if (i !== list.length - 1) p.appendChild(document.createTextNode(' '));
      });
      return;
    }

    // Case B: minimal-markdown renderer format:
    // "Sources:<br>* NBC News<br>* Euronews"
    const html = String(p.innerHTML || '');
    if (!/^Sources:\s*<br\s*\/?>/i.test(html)) return;
    const lines = html
      .replace(/<\/?[^>]+>/g, function (tag) { return /<br\s*\/?>/i.test(tag) ? '\n' : ''; })
      .split('\n')
      .map(function (s) { return String(s || '').trim(); })
      .filter(Boolean);
    const bulletLabels = lines
      .slice(1)
      .map(function (ln) { return ln.replace(/^[*-]\s*/, '').trim(); })
      .filter(Boolean);
    if (!bulletLabels.length) return;

    p.innerHTML = '<strong>Sources:</strong> ';
    bulletLabels.forEach(function (label, i) {
      const info = idx.get(normalizeKey(label));
      p.appendChild(makeInlineSourcePill(label, info));
      if (i !== bulletLabels.length - 1) p.appendChild(document.createTextNode(' '));
    });
  });

  // 2) Transform trailing "(Publisher)" tokens into pills where safe.
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function (n) {
    if (shouldSkipInlinePillTransform(n)) return;
    const text = String(n.nodeValue || '');
    if (!text || text.indexOf('(') === -1) return;

    const re = /\(([^)]+)\)/g;
    let m;
    const reps = [];
    while ((m = re.exec(text))) {
      const inside = String(m[1] || '').trim();
      if (!inside) continue;
      if (inside.length > 28) continue;
      if (/\d/.test(inside)) continue;
      if (/[^\w\s.\-&]/.test(inside)) continue;

      const info = idx.get(normalizeKey(inside));
      const looksLikePublisher = /^[A-Z][A-Za-z\s.&-]{2,}$/.test(inside);
      if (!info && !looksLikePublisher) continue;

      const isHostname = /^[a-z0-9.-]+$/i.test(inside) && inside.indexOf('.') !== -1 && inside.indexOf(' ') === -1;
      const display = (isHostname && info && info.badge) ? info.badge : inside;
      const pill = makeInlineSourcePill(inside, info || { title: inside, url: '' }, display);
      reps.push({ start: m.index, end: m.index + m[0].length, el: pill, before: ' ' });
    }
    if (reps.length) replaceTextNode(n, reps);
  });
}

let _openSourcesPopover = null;

function closeOpenSourcesPopover() {
  if (_openSourcesPopover && _openSourcesPopover.parentNode) {
    _openSourcesPopover.parentNode.removeChild(_openSourcesPopover);
  }
  _openSourcesPopover = null;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach(function (v) {
    const s = String(v || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out;
}

function _appendCompactSources(wrap, sources) {
  const rows = Array.isArray(sources) ? sources.slice(0, 12) : [];
  const total = Array.isArray(sources) ? sources.length : 0;
  const badges = uniqueStrings(rows.map(function (s) {
    const url = s && typeof s === 'object' ? String(s.url || '') : '';
    return sourceBadgeFromUrl(url) || hostnameFromUrl(url);
  }));

  const compact = document.createElement('div');
  compact.className = 'ga-atlas-sources-compact';

  const countHtml = total ? ('<span class="ga-atlas-source-badge ga-atlas-source-badge--compact ga-atlas-source-badge--muted">' + escapeHtml(String(total)) + '</span>') : '';
  const badgeHtml = badges.slice(0, 4).map(function (b) {
    return '<span class="ga-atlas-source-badge ga-atlas-source-badge--compact">' + escapeHtml(b) + '</span>';
  }).join('');
  const extra = badges.length > 4 ? ('<span class="ga-atlas-source-badge ga-atlas-source-badge--compact ga-atlas-source-badge--muted">+' + escapeHtml(String(badges.length - 4)) + '</span>') : '';

  compact.innerHTML = ''
    + '<button type="button" class="ga-atlas-sources-toggle" aria-label="Show sources">'
    + '  <span class="ga-atlas-sources-toggle-label">Sources</span>'
    + '  <span class="ga-atlas-sources-toggle-badges">' + countHtml + badgeHtml + extra + '</span>'
    + '  <span class="ga-atlas-sources-toggle-icon" aria-hidden="true">expand_more</span>'
    + '</button>';

  const btn = compact.querySelector('.ga-atlas-sources-toggle');
  btn.onclick = function () {
    if (_openSourcesPopover && _openSourcesPopover.dataset.ownerId === wrap.dataset.msgId) {
      closeOpenSourcesPopover();
      return;
    }
    closeOpenSourcesPopover();
    openSourcesPopover(wrap, rows);
  };

  // Stable id per message bubble (for toggling).
  if (!wrap.dataset.msgId) {
    wrap.dataset.msgId = String(Date.now()) + '-' + Math.floor(Math.random() * 1e9);
  }

  wrap.appendChild(compact);
  syncUsageWidth(wrap, compact);
}

function openSourcesPopover(wrap, sources) {
  const pop = document.createElement('div');
  pop.className = 'ga-atlas-sources-popover';
  pop.dataset.ownerId = wrap.dataset.msgId || '';

  const listHtml = (Array.isArray(sources) ? sources : []).slice(0, 8).map(function (s) {
    if (!s || typeof s !== 'object') return '';
    const title = String(s.title || '').trim();
    const url = String(s.url || '').trim();
    const label = title || url || 'Source';
    const badge = escapeHtml(sourceBadgeFromUrl(url) || hostnameFromUrl(url) || 'Source');
    const inner = ''
      + '<span class="ga-atlas-source-title">' + escapeHtml(label) + '</span>'
      + '<span class="ga-atlas-source-badge">' + badge + '</span>';
    if (!url) return '<div class="ga-atlas-source-row">' + inner + '</div>';
    return '<a class="ga-atlas-source-row" href="' + escapeHtml(url) + '" target="_blank" rel="noopener">' + inner + '</a>';
  }).filter(Boolean).join('');

  pop.innerHTML = ''
    + '<div class="ga-atlas-sources-popover-head">'
    + '  <strong>Sources</strong>'
    + '  <button type="button" class="ga-atlas-sources-popover-close" aria-label="Close sources">close</button>'
    + '</div>'
    + '<div class="ga-atlas-sources-popover-list">' + listHtml + '</div>';

  const closeBtn = pop.querySelector('.ga-atlas-sources-popover-close');
  closeBtn.onclick = closeOpenSourcesPopover;

  wrap.appendChild(pop);
  syncUsageWidth(wrap, pop);
  _openSourcesPopover = pop;
}

function hostnameFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '');
  } catch (_) {
    return '';
  }
}

function titleCaseWords(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function sourceBadgeFromUrl(url) {
  const host = hostnameFromUrl(url);
  if (!host) return '';
  const h = host.toLowerCase();

  // Small set of common news sources seen in Tavily results.
  if (h === 'abcnews.go.com' || h.endsWith('.abcnews.go.com')) return 'ABC News';
  if (h === 'cbsnews.com' || h.endsWith('.cbsnews.com')) return 'CBS News';
  if (h === 'apnews.com' || h.endsWith('.apnews.com')) return 'AP News';
  if (h === 'pbs.org' || h.endsWith('.pbs.org')) return 'PBS';
  if (h === 'today.com' || h.endsWith('.today.com')) return 'TODAY';
  if (h === 'thehindu.com' || h.endsWith('.thehindu.com')) return 'The Hindu';
  if (h === 'usnews.com' || h.endsWith('.usnews.com')) return 'U.S. News';

  // Prefer the registered-ish domain when possible.
  const parts = host.split('.').filter(Boolean);
  if (parts.length >= 2) {
    const base = parts[parts.length - 2];
    // If base is too short/unhelpful, fall back to the hostname.
    if (base && base.length >= 3) return titleCaseWords(base);
  }
  return host;
}

function formatNumber(n) {
  try { return Number(n || 0).toLocaleString('en-IN'); }
  catch (_) { return String(n || 0); }
}

function formatInr(value) {
  const amount = Number(value || 0);
  if (amount > 0 && amount < 0.01) return 'under ₹0.01';
  return '₹' + amount.toFixed(2);
}

function formatDurationMs(value) {
  const ms = Math.max(0, Number(value || 0));
  if (!ms) return '';
  if (ms < 1000) return Math.round(ms) + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function setSendDisabled(disabled) {
  const btn = document.getElementById('gaAtlasSendBtn');
  if (btn) btn.disabled = !!disabled;
  const inp = document.getElementById('gaAtlasInput');
  if (inp) inp.disabled = !!disabled;
}

function syncUsageWidth(wrap, meta) {
  if (!wrap || !meta) return;
  const bubble = wrap.querySelector('.ga-bubble-bot');
  if (!bubble) return;

  if (meta._bubbleWidthObserver && typeof meta._bubbleWidthObserver.disconnect === 'function') {
    meta._bubbleWidthObserver.disconnect();
  }

  const applyWidth = function () {
    const width = Math.ceil(bubble.getBoundingClientRect().width || 0);
    if (width > 0) meta.style.width = width + 'px';
  };

  applyWidth();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyWidth);
  if (typeof setTimeout === 'function') setTimeout(applyWidth, 80);

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(applyWidth);
    observer.observe(bubble);
    meta._bubbleWidthObserver = observer;
  }
}

function scrollToBottom() {
  const msgs = document.getElementById('gaMessages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

/* ── Tiny safe Markdown renderer ──────────────────────────────────────── */

const GAMD_FENCE_OPEN  = 'XGAMDFENCEOPEN';
const GAMD_FENCE_CLOSE = 'XGAMDFENCECLOSE';

function renderMarkdown(input) {
  const src = String(input == null ? '' : input);

  const fences = [];
  let escaped = src.replace(/```([\s\S]*?)```/g, function (_m, code) {
    const idx = fences.length;
    fences.push(code);
    return GAMD_FENCE_OPEN + idx + GAMD_FENCE_CLOSE;
  });

  escaped = escapeHtml(escaped);

  const blocks = escaped.split(/\n{2,}/);
  const rendered = blocks.map(renderBlock).join('\n');

  const reinject = new RegExp(GAMD_FENCE_OPEN + '(\\d+)' + GAMD_FENCE_CLOSE, 'g');
  return rendered.replace(reinject, function (_m, i) {
    const code = escapeHtml(fences[Number(i)] || '').replace(/^\n/, '');
    return '<pre class="ga-md-pre"><code>' + code + '</code></pre>';
  });
}

function renderBlock(block) {
  const lines = block.split('\n');
  if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
    const items = lines.map(function (l) {
      return '<li>' + renderInline(l.replace(/^\s*[-*]\s+/, '')) + '</li>';
    });
    return '<ul class="ga-md-ul">' + items.join('') + '</ul>';
  }
  if (lines.every(function (l) { return /^\s*\d+\.\s+/.test(l); })) {
    const items = lines.map(function (l) {
      return '<li>' + renderInline(l.replace(/^\s*\d+\.\s+/, '')) + '</li>';
    });
    return '<ol class="ga-md-ol">' + items.join('') + '</ol>';
  }
  const inline = lines.map(renderInline).join('<br>');
  return '<p class="ga-md-p">' + inline + '</p>';
}

// All inline regexes are explicitly length-bounded. The model is capped at
// MAX_REPLY_CHARS (4000) so any individual span can't realistically exceed
// these limits, and bounded quantifiers eliminate the super-linear backtracking
// surface that SAST tools (rightly) flag on `+` over negated character classes.
function renderInline(text) {
  let out = text;
  out = out.replace(/`([^`]{1,500})`/g, function (_m, c) {
    return '<code class="ga-md-code">' + c + '</code>';
  });
  out = out.replace(/\*\*([^*]{1,500})\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]{1,500})\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]{1,500})_(?!_)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]{1,500})\)/g, function (_m, label, url) {
    return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
  });
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]{1,500})/g, function (_m, prefix, url) {
    return prefix + '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
  });
  return out;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
