/**
 * CodeBlock — dedicated code editor component.
 *
 * Layout (edit mode):
 *   ┌────────────────────────────────────────────────────┐
 *   │  [JavaScript ▾]                       [🗑 Delete]  │  ← header bar
 *   ├────────────────────────────────────────────────────┤
 *   │  <textarea>  (auto-resizes, Tab = 2 spaces)        │
 *   └────────────────────────────────────────────────────┘
 *
 * Data model: { lang: 'javascript', code: '...' }
 * DOM attrs:  data-block="code"  data-lang="..."  data-code="..."
 *
 * Public API
 *   createCodeBlock(lang, code, onChange) → { element, getLang(), getCode(), setEditable(bool) }
 */

const LANGUAGES = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python',     label: 'Python' },
  { value: 'java',       label: 'Java' },
  { value: 'apex',       label: 'Apex' },
  { value: 'sql',        label: 'SQL' },
  { value: 'bash',       label: 'Bash / Shell' },
  { value: 'json',       label: 'JSON' },
  { value: 'html',       label: 'HTML' },
  { value: 'css',        label: 'CSS' },
  { value: 'go',         label: 'Go' },
  { value: 'rust',       label: 'Rust' },
  { value: 'yaml',       label: 'YAML' },
  { value: 'plaintext',  label: 'Plain text' },
];

export function createCodeBlock(initialLang, initialCode, onChange) {
  let lang = initialLang || 'javascript';
  let code = typeof initialCode === 'string' ? initialCode : '';
  let editable = true;

  // Root element — contentEditable=false so the composer treats it as an
  // atomic block and won't let the cursor wander inside it.
  const element = document.createElement('div');
  element.className = 'sd-code-component';
  element.contentEditable = 'false';
  element.setAttribute('data-block', 'code');
  element.setAttribute('tabindex', '-1');

  // ── state helpers ─────────────────────────────────────────────────────────

  function syncAttr() {
    element.dataset.lang = lang;
    element.dataset.code = code;
  }

  function emit() {
    syncAttr();
    if (typeof onChange === 'function') onChange({ lang, code });
  }

  // ── button factory ────────────────────────────────────────────────────────

  function makeBtn(iconName, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-code-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.innerHTML = '<span class="material-symbols-outlined">' + iconName + '</span>';
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── render ────────────────────────────────────────────────────────────────

  function render() {
    element.innerHTML = '';

    // Header bar ─────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'sd-code-header';

    // Language badge / select
    const langSelect = document.createElement('select');
    langSelect.className = 'sd-code-lang-select';
    LANGUAGES.forEach(function (l) {
      const opt = document.createElement('option');
      opt.value = l.value;
      opt.textContent = l.label;
      if (l.value === lang) opt.selected = true;
      langSelect.appendChild(opt);
    });
    langSelect.addEventListener('change', function () {
      lang = langSelect.value;
      emit();
    });
    langSelect.disabled = !editable;
    header.appendChild(langSelect);

    const spacer = document.createElement('span');
    spacer.className = 'sd-code-header-spacer';
    header.appendChild(spacer);

    // Delete block button
    const delBtn = makeBtn('delete', 'Delete code block', function () {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (element.parentNode) element.parentNode.replaceChild(p, element);
      if (typeof onChange === 'function') onChange(null);
    }, 'sd-code-del-btn');
    delBtn.disabled = !editable;
    header.appendChild(delBtn);

    element.appendChild(header);

    // Textarea body ──────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'sd-code-body';

    const textarea = document.createElement('textarea');
    textarea.className = 'sd-code-textarea';
    textarea.value = code;
    textarea.disabled = !editable;
    textarea.spellcheck = false;
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.placeholder = '// Enter code here…';

    // Auto-resize on content change
    function autoResize() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(120, textarea.scrollHeight) + 'px';
    }

    textarea.addEventListener('input', function () {
      code = textarea.value;
      autoResize();
      emit();
    });

    // Tab key inserts 2 spaces instead of losing focus
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end   = textarea.selectionEnd;
        const indent = '  ';
        textarea.value = textarea.value.slice(0, start) + indent + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + indent.length;
        code = textarea.value;
        emit();
      }
    });

    body.appendChild(textarea);
    element.appendChild(body);

    syncAttr();
    // Defer resize until the element is in the DOM
    requestAnimationFrame(autoResize);
  }

  // ── public API ────────────────────────────────────────────────────────────

  function setEditableFn(val) {
    editable = !!val;
    const ta = element.querySelector('.sd-code-textarea');
    if (ta) ta.disabled = !val;
    const ls = element.querySelector('.sd-code-lang-select');
    if (ls) ls.disabled = !val;
    element.querySelectorAll('.sd-code-btn').forEach(function (btn) { btn.disabled = !val; });
    element.classList.toggle('sd-code-editing', !!val);
    element.classList.toggle('sd-code-locked', !val);
  }

  render();
  setEditableFn(true);
  element._setEditable = setEditableFn;

  return {
    element,
    getLang:     function () { return lang; },
    getCode:     function () { return code; },
    setEditable: setEditableFn,
  };
}
