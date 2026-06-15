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

import { googleCredential } from '../core/state.js';
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
const ATLAS_STREAM_TIMEOUT_MS = 20000;

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

/* ── State ────────────────────────────────────────────────────────────── */

const atlasState = {
  history:   /** @type {Array<{role:'user'|'model', text:string}>} */ ([]),
  inFlight:  false,
  variant:   null, // { id, label, chips }  resolved on first render
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

  // Render the input bar early so it's there even while we wait for the
  // server to load any saved conversation.
  renderFreeFormInput(area);

  // Try to restore a saved conversation. If found, replay it; otherwise
  // show the greeting + suggested chips.
  const restored = await fetchSavedConversation();
  if (restored && restored.length) {
    appendBotBubble(
      "Welcome back — picking up where we left off."
    );
    replayHistory(restored);
    atlasState.history = restored.slice();
  } else {
    appendBotBubble(
      "Hi — I'm **Atlas**, Abhinav's virtual assistant. Ask me anything about his experience, projects, or how to get in touch.\n\n_(I won't make things up — if I don't know, I'll say so.)_"
    );
    renderSuggestedChips(msgs);
  }
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

function renderFreeFormInput(area) {
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

/**
 * Stream the reply from /api/atlas/stream. Returns true on success
 * (streamed and got a `done` event), false on a soft failure that
 * should fall back to JSON. Throws are caught here too — they also
 * count as a soft failure.
 */
async function streamAsk(message, history) {
  if (!googleCredential) {
    appendErrorBubble(friendlyHttpError(401));
    return true;  // No fallback — same outcome with JSON.
  }

  let resp;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATLAS_STREAM_TIMEOUT_MS);
  try {
    resp = await fetch('/api/atlas/stream', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + googleCredential,
        'Content-Type':  'application/json',
        'Accept':        'text/event-stream',
      },
      body: JSON.stringify({ message, history }),
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
    const errText = (body && (body.error || body.message)) || friendlyHttpError(resp.status);
    appendErrorBubble(errText);
    clearTimeout(timeout);
    return true;
  }

  // Open a streaming bubble that we'll fill chunk-by-chunk.
  const typing = appendTypingIndicator();
  const bubbleWrap = appendBotBubble('');
  const bubble = bubbleWrap.querySelector('.ga-bubble.ga-md');
  let acc = '';
  let typingRemoved = false;
  let final = '';

  try {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        let parsed;
        try { parsed = JSON.parse(jsonStr); } catch (_) { continue; }

        if (parsed.error) {
          if (!typingRemoved && typing) { typing.remove(); typingRemoved = true; }
          // Replace the empty bubble with an error bubble for clarity.
          bubbleWrap.remove();
          appendErrorBubble(parsed.error);
          return true;
        }

        if (typeof parsed.chunk === 'string') {
          // Lazy-remove the typing indicator on the first real chunk so
          // there's no visual flicker between dots and text.
          if (!typingRemoved && typing) { typing.remove(); typingRemoved = true; }
          acc += parsed.chunk;
          if (bubble) bubble.innerHTML = renderMarkdown(acc);
          scrollToBottom();
        }

        if (typeof parsed.done === 'string') {
          final = parsed.done;
          if (bubble) bubble.innerHTML = renderMarkdown(final);
        }
      }
    }
  } catch (_e) {
    if (!typingRemoved && typing) typing.remove();
    bubbleWrap.remove();
    return false;  // Try JSON fallback.
  } finally {
    clearTimeout(timeout);
    if (typing && typing.parentNode) typing.remove();
  }

  // Update local history with the AUTHORITATIVE final text (the server
  // sanitises after streaming completes — we mirror that, not the raw
  // accumulated chunks).
  const answer = final || acc;
  if (answer) {
    atlasState.history.push({ role: 'user',  text: message });
    atlasState.history.push({ role: 'model', text: answer });
  }
  return true;
}

/**
 * JSON-only fallback for browsers / networks that can't do SSE.
 */
async function fallbackJsonAsk(message, history) {
  const typing = appendTypingIndicator();
  try {
    const res = await postAskJson(message, history);
    if (!res.ok) {
      const errText = (res.body && (res.body.error || res.body.message))
        || friendlyHttpError(res.status);
      appendErrorBubble(errText);
      return;
    }
    const answer = (res.body && res.body.answer)
      || "I couldn't generate a response. Please try again.";
    appendBotBubble(answer);
    atlasState.history.push({ role: 'user',  text: message });
    atlasState.history.push({ role: 'model', text: answer });
  } catch (_e) {
    appendErrorBubble("Network error — please try again.");
  } finally {
    if (typing && typing.parentNode) typing.remove();
  }
}

async function postAskJson(message, history) {
  if (!googleCredential) {
    return { ok: false, status: 401, body: { error: friendlyHttpError(401) } };
  }
  let resp;
  try {
    resp = await fetch('/api/atlas/ask', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + googleCredential,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ message, history }),
    });
  } catch (e) {
    throw new Error('Network error reaching Atlas.', { cause: e });
  }
  let body = null;
  try { body = await resp.json(); } catch (_) {}
  return { ok: resp.ok, status: resp.status, body };
}

function friendlyHttpError(status) {
  if (status === 401) return "You'll need to sign in with Google to chat with Atlas.";
  if (status === 429) return "You've reached the hourly limit for Atlas — please try again later or use the Get In Touch form.";
  if (status === 503) return "Atlas isn't available right now. Please try again in a few minutes.";
  if (status === 422) return "Atlas couldn't generate a safe response to that. Try rephrasing.";
  return "Something went wrong on our end. Please try again.";
}

/* ── Persistence ──────────────────────────────────────────────────────── */

async function fetchSavedConversation() {
  if (!googleCredential) return null;
  try {
    const resp = await fetch('/api/atlas/conversations/active', {
      method:  'GET',
      headers: { 'Authorization': 'Bearer ' + googleCredential },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data && data.success && data.conversation && Array.isArray(data.conversation.turns)) {
      return data.conversation.turns;
    }
  } catch (_) {}
  return null;
}

async function startOver() {
  if (atlasState.inFlight) return;

  // Wipe server-side history first (best effort) so a refresh doesn't
  // resurrect the old conversation.
  if (googleCredential) {
    try {
      await fetch('/api/atlas/conversations/active', {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + googleCredential },
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

function appendBotBubble(markdown) {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-bot ga-msg-enter',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-md',
    markdown:    markdown,
    animate:     true,
  });
}

function appendUserBubble(text) {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-user ga-msg-enter',
    bubbleClass: 'ga-bubble ga-bubble-user',
    text:        text,
    animate:     true,
  });
}

function appendErrorBubble(text) {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-bot',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-bubble-error',
    text:        text,
  });
}

function appendTypingIndicator() {
  return appendBubble({
    wrapClass:   'ga-msg ga-msg-bot',
    bubbleClass: 'ga-bubble ga-bubble-bot ga-typing',
    html:        '<span class="ga-typing-dot"></span><span class="ga-typing-dot"></span><span class="ga-typing-dot"></span>',
  });
}

function setSendDisabled(disabled) {
  const btn = document.getElementById('gaAtlasSendBtn');
  if (btn) btn.disabled = !!disabled;
  const inp = document.getElementById('gaAtlasInput');
  if (inp) inp.disabled = !!disabled;
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
