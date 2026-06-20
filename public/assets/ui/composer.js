/**
 * Composer — a write-first rich editing surface with a contextual toolbar.
 *
 * One surface, one toolbar. The author just writes; the bottom toolbar offers
 * formatting (bold/italic), structure (heading/list), inserting rich pieces
 * (table, decision grid, info cards, flow, comparison, sequence, risk grid),
 * and AI assistance — exactly like Notion / LinkedIn / Gmail. No "pick a block
 * type first" step.
 *
 * The surface is backed by the shared System Design block model so what an
 * author writes is byte-for-byte what readers see. `getBlocks()` serialises the
 * surface back into blocks via `htmlToBlocks`; `setBlocks()` renders blocks into
 * the surface via `blocksToHtml`.
 *
 * Reusable across the app: pass `tools`, `placeholder`, `aiAssist`, `onChange`.
 */

import { blockToHtml, blocksToHtml, htmlToBlocks } from './sdblocks.js';
import { createTableBlock } from './table-block.js';

const RICH_SELECTOR = [
  'table', 'ul', 'ol',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  '.sd-hero-block', '.sd-card-grid', '.sd-comparison',
  '.sd-sequence', '.sd-flow', '.sd-risk-grid', '.sd-decision-grid',
].join(',');

// Seed templates for inserted rich pieces. Each is rendered from the shared
// block model so inserted content round-trips through htmlToBlocks unchanged.
const INSERT_ITEMS = [
  {
    type: 'matrix', label: 'Table', icon: 'table_rows',
    seed: { type: 'matrix', rows: [['', ''], ['', '']] },
  },
  {
    type: 'hero', label: 'Selected design', icon: 'stars',
    seed: { type: 'hero', kicker: 'Selected design', heading: 'Heading', text: 'One-line summary of the chosen approach.', cells: [{ label: 'Pattern', value: 'Value' }, { label: 'Trade-off', value: 'Value' }] },
  },
  {
    type: 'cards', label: 'Info cards', icon: 'grid_view',
    seed: { type: 'cards', items: [{ title: 'Title', text: 'Description' }, { title: 'Title', text: 'Description' }] },
  },
  {
    type: 'flow', label: 'Flow', icon: 'linear_scale',
    seed: { type: 'flow', steps: ['Step one', 'Step two', 'Step three'] },
  },
  {
    type: 'comparison', label: 'Comparison', icon: 'compare_arrows',
    seed: { type: 'comparison', rows: [{ title: 'Option A', status: 'Chosen', text: 'Why this wins.', selected: true }, { title: 'Option B', status: 'Rejected', text: 'Why not.', selected: false }] },
  },
  {
    type: 'sequence', label: 'Sequence', icon: 'format_list_numbered',
    seed: { type: 'sequence', steps: ['First step', 'Second step'] },
  },
  {
    type: 'risks', label: 'Risk grid', icon: 'warning',
    seed: { type: 'risks', items: [{ level: 'medium', title: 'Risk', text: 'Detail and mitigation.' }] },
  },
];

const AI_MODES = [
  { mode: 'improve', label: 'AI Improve', icon: 'auto_awesome', primary: true },
  { mode: 'concise', label: 'Concise', icon: 'short_text' },
  { mode: 'grammar', label: 'Grammar', icon: 'spellcheck' },
];

function icon(name) {
  const span = document.createElement('span');
  span.className = 'material-symbols-outlined';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = name;
  return span;
}

function makeButton(def) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'composer-tool' + (def.primary ? ' composer-tool-primary' : '');
  if (def.command) btn.dataset.command = def.command;
  btn.title = def.title || def.label;
  btn.setAttribute('aria-label', def.title || def.label);
  btn.appendChild(icon(def.icon));
  if (def.label && def.showLabel !== false) {
    const text = document.createElement('span');
    text.className = 'composer-tool-label';
    text.textContent = def.label;
    btn.appendChild(text);
  }
  return btn;
}

function divider() {
  const el = document.createElement('span');
  el.className = 'composer-divider';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function createComposer(options) {
  const opts = options || {};
  const tools = opts.tools || ['format', 'structure', 'insert', 'ai'];
  let onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
  let changeTimer = 0;
  let suppressChange = false;

  // Optional read-only ⇄ edit toggle. When `editToggle` is on, the surface is
  // locked by default and the Edit button unlocks it; Save (or Edit again)
  // re-locks it. Other composers stay always-editable.
  const editToggle = opts.editToggle === true;
  let editable = editToggle ? opts.startEditing === true : true;
  let editBtn = null;
  let saveBtn = null;

  const element = document.createElement('div');
  element.className = 'composer';
  if (opts.toolbarMode === 'inline') element.classList.add('composer-inline');

  const surface = document.createElement('div');
  surface.className = 'composer-surface sd-article-body';
  surface.contentEditable = editable ? 'true' : 'false';
  surface.spellcheck = true;
  surface.setAttribute('role', 'textbox');
  surface.setAttribute('aria-multiline', 'true');
  surface.setAttribute('aria-label', opts.ariaLabel || 'Article body');
  surface.dataset.placeholder = opts.placeholder != null ? opts.placeholder : 'Start writing\u2026';

  const toolbar = document.createElement('div');
  toolbar.className = 'composer-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  // Keep the caret/selection inside the surface when toolbar buttons are pressed.
  toolbar.addEventListener('mousedown', function (event) {
    if (event.target.closest('.composer-menu')) return;
    event.preventDefault();
  });

  const status = document.createElement('div');
  status.className = 'composer-status';
  status.hidden = true;

  // status goes at the top of the card (before surface), toolbar stays at bottom
  element.append(status, surface, toolbar);

  // ── helpers ────────────────────────────────────────────────────────────────

  function isEmpty() {
    if (surface.querySelector(RICH_SELECTOR)) return false;
    return surface.textContent.replace(/\u200b/g, '').trim() === '';
  }

  function reflectEmpty() {
    element.classList.toggle('composer-is-empty', isEmpty());
  }

  function setStatus(message, kind) {
    status.textContent = message || '';
    status.hidden = !message;
    if (message) status.dataset.kind = kind || 'info';
    else delete status.dataset.kind;
  }

  function setEditable(next) {
    if (!editToggle) return;
    editable = !!next;
    surface.contentEditable = editable ? 'true' : 'false';
    element.classList.toggle('composer-locked', !editable);
    // Also lock/unlock the section-type dropdown in the parent ribbon if present
    const ribbon = element.closest('.sd-section-editor');
    if (ribbon) {
      ribbon.querySelectorAll('.sd-section-type-select, .sd-section-type-custom-input')
        .forEach(function (el) { el.disabled = !editable; });
    }
    if (editBtn) {
      editBtn.classList.toggle('composer-tool-active', editable);
      editBtn.setAttribute('aria-pressed', editable ? 'true' : 'false');
      editBtn.title = editable ? 'Lock section (read-only)' : 'Edit section';
    }
    if (saveBtn) saveBtn.disabled = !editable;
    // Lock/unlock any embedded table components.
    surface.querySelectorAll('[data-block="matrix"]').forEach(function (el) {
      // Find the createTableBlock instance via its setEditable method stored on the element.
      if (typeof el._setEditable === 'function') el._setEditable(editable);
    });
  }

  function focus() {
    surface.focus();
    if (!surface.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol')) {
      surface.innerHTML = '<p><br></p>';
    }
    placeCaretAtEnd(surface.lastElementChild || surface);
  }

  function placeCaretAtEnd(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Wrap stray top-level text/inline nodes into <p> so serialisation never
  // drops content the browser left unwrapped in the contenteditable surface.
  function serialize() {
    const clone = surface.cloneNode(true);
    const wrapper = document.createElement('div');
    let buffer = null;
    Array.prototype.slice.call(clone.childNodes).forEach(function (node) {
      const isElement = node.nodeType === 1;
      const tag = isElement ? node.tagName.toLowerCase() : '';
      const isBlock = isElement && /^(p|h[1-6]|ul|ol|table|section|div|blockquote|figure)$/.test(tag);
      if (isBlock) {
        buffer = null;
        if (tag === 'div' && !(node.dataset && node.dataset.block)) {
          // Generic div → flatten into a paragraph.
          const p = document.createElement('p');
          p.innerHTML = node.innerHTML;
          wrapper.appendChild(p);
        } else {
          // Structured blocks (including data-block="matrix" table components) pass through as-is.
          wrapper.appendChild(node);
        }
        return;
      }
      if (!buffer) {
        buffer = document.createElement('p');
        wrapper.appendChild(buffer);
      }
      buffer.appendChild(node);
    });
    return htmlToBlocks(wrapper.innerHTML);
  }

  function emitChange() {
    reflectEmpty();
    if (suppressChange) return;
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(function () {
      changeTimer = 0;
      onChange(serialize());
    }, 250);
  }

  function exec(command, value) {
    surface.focus();
    document.execCommand(command, false, value || null);
    refreshActiveStates();
    emitChange();
  }

  function toggleBlock(tag) {
    surface.focus();
    const active = isBlockActive(tag);
    document.execCommand('formatBlock', false, active ? 'p' : tag);
    refreshActiveStates();
    emitChange();
  }

  function isBlockActive(tag) {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return false;
    let node = sel.anchorNode;
    while (node && node !== surface) {
      if (node.nodeType === 1 && node.tagName.toLowerCase() === tag) return true;
      node = node.parentNode;
    }
    return false;
  }

  function insertHtml(html) {
    surface.focus();
    document.execCommand('insertHTML', false, html + '<p><br></p>');
    refreshActiveStates();
    emitChange();
  }

  function insertTableBlock(initialRows) {
    const block = createTableBlock(initialRows || [], function () { emitChange(); });
    // Insert as a block-level element — place after current selection or at end.
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    let refNode = anchor ? (surface.contains(anchor) ? anchor : null) : null;
    while (refNode && refNode.parentNode !== surface) refNode = refNode.parentNode;
    if (refNode && refNode !== surface) {
      refNode.insertAdjacentElement('afterend', block.element);
    } else {
      surface.appendChild(block.element);
    }
    // Ensure a paragraph follows for continued typing.
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    block.element.insertAdjacentElement('afterend', p);
    // Focus first cell.
    const firstInput = block.element.querySelector('.sd-tbl-input');
    if (firstInput) firstInput.focus();
    emitChange();
  }

  // Replace any legacy sd-matrix-wrap HTML (from setBlocks/load) with live
  // table components. Called after innerHTML is set on the surface.
  function mountTableBlocks() {
    // Mount live table-block components over any static sd-matrix-wrap HTML
    // left by blocksToHtml (legacy load path). The dedicated component elements
    // (data-block="matrix") are already live — skip them.
    surface.querySelectorAll('.sd-matrix-wrap').forEach(function (wrap) {
      const rows = Array.from(wrap.querySelectorAll('tr')).map(function (tr) {
        // Collect th (first cell) + all td → array of strings.
        const cells = [];
        const th = tr.querySelector('th');
        if (th) cells.push(th.textContent.trim());
        tr.querySelectorAll('td').forEach(function (td) { cells.push(td.textContent.trim()); });
        return cells;
      }).filter(function (r) { return r.length > 0; });
      const block = createTableBlock(rows, function () { emitChange(); });
      block.element._setEditable = block.setEditable;
      block.setEditable(editable);
      wrap.replaceWith(block.element);
    });
  }

  function currentTopBlock() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !surface.contains(sel.anchorNode)) return null;
    let node = sel.anchorNode;
    if (node === surface) return null;
    while (node && node.parentNode !== surface) node = node.parentNode;
    return node && surface.contains(node) ? node : null;
  }

  async function runAi(mode) {
    if (typeof opts.aiAssist !== 'function') return;
    const target = currentTopBlock();
    const scopeText = target ? target.textContent : surface.textContent;
    const text = String(scopeText || '').trim();
    if (!text) {
      setStatus('Write a line first, then AI can improve it.', 'error');
      surface.focus();
      return;
    }
    setStatus('AI is working\u2026', 'info');
    try {
      const suggestion = await opts.aiAssist(text, mode, { scope: target ? 'block' : 'all' });
      const clean = String(suggestion || '').trim();
      if (!clean) {
        setStatus('AI returned nothing. Try again.', 'error');
        return;
      }
      if (target) target.textContent = clean;
      else surface.textContent = clean;
      setStatus('AI suggestion applied. Edit freely.', 'success');
      emitChange();
    } catch (err) {
      setStatus(err && err.message ? err.message : 'AI request failed.', 'error');
    }
  }

  // ── active-state reflection (bold/italic/heading/list) ──────────────────────

  const stateButtons = [];
  function refreshActiveStates() {
    stateButtons.forEach(function (entry) {
      let active = false;
      try {
        if (entry.kind === 'command') active = document.queryCommandState(entry.command);
        else if (entry.kind === 'block') active = isBlockActive(entry.tag);
      } catch (_) { active = false; }
      entry.button.classList.toggle('composer-tool-active', active);
      entry.button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // ── toolbar build ───────────────────────────────────────────────────────────

  function addGroup(buttons) {
    if (toolbar.childElementCount) toolbar.appendChild(divider());
    buttons.forEach(function (btn) { toolbar.appendChild(btn); });
  }

  if (tools.includes('format')) {
    const bold = makeButton({ icon: 'format_bold', label: 'Bold', showLabel: false, title: 'Bold' });
    const italic = makeButton({ icon: 'format_italic', label: 'Italic', showLabel: false, title: 'Italic' });
    const code = makeButton({ icon: 'code', label: 'Code', showLabel: false, title: 'Inline code' });
    bold.addEventListener('click', function () { exec('bold'); });
    italic.addEventListener('click', function () { exec('italic'); });
    code.addEventListener('click', function () { wrapInlineCode(); });
    stateButtons.push({ button: bold, kind: 'command', command: 'bold' });
    stateButtons.push({ button: italic, kind: 'command', command: 'italic' });
    addGroup([bold, italic, code]);
  }

  if (tools.includes('structure')) {
    const heading = makeButton({ icon: 'title', label: 'Heading', showLabel: false, title: 'Heading' });
    const bullets = makeButton({ icon: 'format_list_bulleted', label: 'Bullets', showLabel: false, title: 'Bullet list' });
    heading.addEventListener('click', function () { toggleBlock('h3'); });
    bullets.addEventListener('click', function () { exec('insertUnorderedList'); });
    stateButtons.push({ button: heading, kind: 'block', tag: 'h3' });
    stateButtons.push({ button: bullets, kind: 'command', command: 'insertUnorderedList' });
    addGroup([heading, bullets]);
  }

  if (tools.includes('insert')) {
    const insertWrap = document.createElement('div');
    insertWrap.className = 'composer-insert';
    const insertBtn = makeButton({ icon: 'add', label: 'Insert', title: 'Insert table or block' });
    insertBtn.classList.add('composer-tool-insert');
    insertBtn.setAttribute('aria-haspopup', 'menu');
    insertBtn.setAttribute('aria-expanded', 'false');

    const menu = document.createElement('div');
    menu.className = 'composer-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    INSERT_ITEMS.forEach(function (item) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'composer-menu-item';
      row.setAttribute('role', 'menuitem');
      row.append(icon(item.icon));
      const label = document.createElement('span');
      label.textContent = item.label;
      row.appendChild(label);
      row.addEventListener('click', function () {
        closeMenu();
        if (item.seed && item.seed.type === 'matrix') {
          insertTableBlock(item.seed.rows);
        } else {
          insertHtml(blockToHtml(item.seed));
        }
      });
      menu.appendChild(row);
    });

    function closeMenu() {
      menu.hidden = true;
      insertBtn.setAttribute('aria-expanded', 'false');
      element.classList.remove('composer-menu-open');
    }
    function openMenu() {
      menu.hidden = false;
      insertBtn.setAttribute('aria-expanded', 'true');
      element.classList.add('composer-menu-open');
    }
    insertBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });
    document.addEventListener('click', function (event) {
      if (!insertWrap.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });

    insertWrap.append(insertBtn, menu);
    if (toolbar.childElementCount) toolbar.appendChild(divider());
    toolbar.appendChild(insertWrap);
  }

  const hasAi = tools.includes('ai') && typeof opts.aiAssist === 'function';
  const hasSave = typeof opts.onSave === 'function';

  if (hasAi || hasSave) {
    const spacer = document.createElement('span');
    spacer.className = 'composer-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    toolbar.appendChild(spacer);
  }

  if (hasAi) {
    const aiButtons = AI_MODES.map(function (def) {
      const btn = makeButton({ icon: def.icon, label: def.label, primary: def.primary, title: def.label });
      btn.addEventListener('click', function () {
        const previous = btn.disabled;
        btn.disabled = true;
        Promise.resolve(runAi(def.mode)).finally(function () { btn.disabled = previous; });
      });
      return btn;
    });
    aiButtons.forEach(function (btn) { toolbar.appendChild(btn); });
  }

  if (editToggle || hasSave) {
    if (hasAi) toolbar.appendChild(divider());
  }

  if (editToggle) {
    editBtn = makeButton({ icon: 'edit', label: 'Edit', title: 'Edit section' });
    editBtn.classList.add('composer-tool-edit');
    editBtn.setAttribute('aria-pressed', 'false');
    editBtn.addEventListener('click', function () {
      const next = !editable;
      setEditable(next);
      if (next) focus();
    });
    toolbar.appendChild(editBtn);
  }

  if (hasSave) {
    saveBtn = makeButton({ icon: 'save', label: opts.saveLabel || 'Save', title: 'Save' });
    saveBtn.classList.add('composer-tool-save');
    saveBtn.addEventListener('click', function () {
      const previous = saveBtn.disabled;
      saveBtn.disabled = true;
      setStatus('Saving\u2026', 'info');
      Promise.resolve()
        .then(function () { return opts.onSave(); })
        .then(function (message) {
          setStatus(message || 'Saved.', 'success');
          if (editToggle) setEditable(false);
          if (editToggle) setTimeout(function () { setStatus(''); }, 3000);
        })
        .catch(function (err) {
          setStatus(err && err.message ? err.message : 'Save failed.', 'error');
        })
        .finally(function () { saveBtn.disabled = editToggle ? !editable : previous; });
    });
    toolbar.appendChild(saveBtn);
  }

  function wrapInlineCode() {
    surface.focus();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      document.execCommand('insertHTML', false, '<code>code</code>');
    } else {
      const text = sel.toString();
      document.execCommand('insertHTML', false, '<code>' + escapeText(text) + '</code>');
    }
    emitChange();
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── surface events ───────────────────────────────────────────────────────────

  surface.addEventListener('input', emitChange);
  surface.addEventListener('keyup', refreshActiveStates);
  surface.addEventListener('mouseup', refreshActiveStates);
  surface.addEventListener('focus', function () {
    element.classList.add('composer-focused');
    if (isEmpty() && !surface.querySelector('p')) surface.innerHTML = '<p><br></p>';
    refreshActiveStates();
  });
  surface.addEventListener('blur', function () {
    element.classList.remove('composer-focused');
  });

  try {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand('styleWithCSS', false, false);
  } catch (_) { /* not supported everywhere; safe to ignore */ }

  // Table row controls and column resize are now handled by table-block.js.

  // ── public API ────────────────────────────────────────────────────────────

  function setBlocks(blocks) {
    suppressChange = true;
    const html = blocksToHtml(Array.isArray(blocks) ? blocks : []);
    surface.innerHTML = html || '';
    // Replace legacy sd-matrix-wrap HTML with live table components.
    mountTableBlocks();
    suppressChange = false;
    reflectEmpty();
    refreshActiveStates();
  }

  function getBlocks() {
    return serialize();
  }

  // Insert a block at the caret (if the surface is focused) or append it.
  function insertBlock(block) {
    const html = blockToHtml(block);
    if (!html) return;
    const sel = window.getSelection();
    const inSurface = sel && sel.rangeCount && surface.contains(sel.anchorNode);
    if (inSurface) {
      insertHtml(html);
    } else {
      if (isEmpty()) surface.innerHTML = '';
      surface.insertAdjacentHTML('beforeend', html + '<p><br></p>');
      placeCaretAtEnd(surface.lastElementChild || surface);
      surface.focus();
      emitChange();
    }
    scrollCaretIntoView();
  }

  function scrollCaretIntoView() {
    const sel = window.getSelection();
    let node = sel && sel.anchorNode;
    if (node && node.nodeType === 3) node = node.parentNode;
    while (node && node !== surface && node.parentNode !== surface) node = node.parentNode;
    if (node && node !== surface && node.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  if (opts.value) setBlocks(opts.value);
  else reflectEmpty();

  if (editToggle) setEditable(editable);

  return {
    element,
    surface,
    setBlocks,
    getBlocks,
    insertBlock,
    focus,
    setStatus,
    setEditable,
    isEditable: function () { return editable; },
    setOnChange: function (fn) { onChange = typeof fn === 'function' ? fn : function () {}; },
  };
}
