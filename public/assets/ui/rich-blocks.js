/**
 * rich-blocks.js — independent editing components for all non-table rich block types.
 *
 * Each creator returns { element, getData(), setEditable(bool) } with the same
 * pattern as table-block.js and code-block.js:
 *
 *  • element.contentEditable = 'false'  — atomic; the composer surface cannot
 *    corrupt its internal DOM structure.
 *  • element.dataset.block = '<type>'   — serialize() passes it through untouched.
 *  • element.dataset.*  = JSON          — htmlToBlocks reads the typed data back.
 *  • element._setEditable = fn          — composer setEditable() calls this.
 *
 * Exported creators
 *   createCardsBlock(items, onChange)       Info cards
 *   createFlowBlock(steps, onChange)        Flow / pipeline steps
 *   createComparisonBlock(rows, onChange)   Option comparison table
 *   createSequenceBlock(steps, onChange)    Numbered sequence
 *   createRisksBlock(items, onChange)       Risk grid
 *   createHeroBlock(data, onChange)         Selected-design hero
 */

// ── shared utilities ──────────────────────────────────────────────────────────

function icon(name) {
  const s = document.createElement('span');
  s.className = 'material-symbols-outlined';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = name;
  return s;
}

function makeWrapper(type, extraClass) {
  const el = document.createElement('div');
  el.className = 'sd-rich-block' + (extraClass ? ' ' + extraClass : '');
  el.contentEditable = 'false';
  el.setAttribute('data-block', type);
  el.setAttribute('tabindex', '-1');
  return el;
}

function makeBtn(iconName, label, onClick, extraClass) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sd-rich-btn' + (extraClass ? ' ' + extraClass : '');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.appendChild(icon(iconName));
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btn.addEventListener('click', onClick);
  return btn;
}

function makeAddBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sd-rich-add-btn';
  btn.title = label;
  btn.appendChild(icon('add'));
  const span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btn.addEventListener('click', onClick);
  return btn;
}

function makeHeader(iconName, label, element, rightNodes) {
  const hdr = document.createElement('div');
  hdr.className = 'sd-rich-hdr';
  const left = document.createElement('span');
  left.className = 'sd-rich-hdr-label';
  left.appendChild(icon(iconName));
  const txt = document.createElement('span');
  txt.textContent = label;
  left.appendChild(txt);
  hdr.appendChild(left);
  const right = document.createElement('span');
  right.className = 'sd-rich-hdr-actions';
  (rightNodes || []).forEach(function (n) { right.appendChild(n); });
  hdr.appendChild(right);
  return hdr;
}

function makeDeleteBlockBtn(element, onChange) {
  return makeBtn('delete', 'Delete block', function () {
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    if (element.parentNode) element.parentNode.replaceChild(p, element);
    if (typeof onChange === 'function') onChange(null);
  }, 'sd-rich-del-block-btn');
}

function makeInput(value, placeholder, onChange) {
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'sd-rich-input';
  inp.value = value || '';
  inp.placeholder = placeholder || '';
  inp.addEventListener('input', function () { onChange(inp.value); });
  return inp;
}

function makeTextarea(value, placeholder, onChange) {
  const ta = document.createElement('textarea');
  ta.className = 'sd-rich-textarea';
  ta.value = value || '';
  ta.placeholder = placeholder || '';
  ta.rows = 2;
  function resize() {
    ta.style.height = 'auto';
    ta.style.height = Math.max(40, ta.scrollHeight) + 'px';
  }
  ta.addEventListener('input', function () { resize(); onChange(ta.value); });
  requestAnimationFrame(resize);
  return ta;
}

function makeSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'sd-rich-select';
  options.forEach(function (opt) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', function () { onChange(sel.value); });
  return sel;
}

// ═════════════════════════════════════════════════════════════════════════════
//  createCardsBlock   — Info cards grid
// ═════════════════════════════════════════════════════════════════════════════

export function createCardsBlock(initialItems, onChange) {
  const items = (initialItems || []).map(function (i) {
    return { title: String(i.title || ''), text: String(i.text || '') };
  });
  if (!items.length) items.push({ title: '', text: '' }, { title: '', text: '' });

  const element = makeWrapper('cards', 'sd-rich-block--cards');
  let editable = true;

  function emit() {
    element.dataset.items = JSON.stringify(items);
    if (typeof onChange === 'function') onChange(items.map(function (i) { return Object.assign({}, i); }));
  }

  function render() {
    element.innerHTML = '';

    // Header bar
    const addBtn = makeAddBtn('Add card', function () {
      items.push({ title: '', text: '' });
      render(); emit();
      const titles = element.querySelectorAll('.sd-cards-tile-title');
      if (titles[titles.length - 1]) titles[titles.length - 1].focus();
    });
    addBtn.disabled = !editable;
    element.appendChild(makeHeader('grid_view', 'Info cards', element, [
      addBtn,
      makeDeleteBlockBtn(element, onChange),
    ]));

    // Card grid — mirrors the public sd-card-grid layout
    const grid = document.createElement('div');
    grid.className = 'sd-cards-edit-grid';

    items.forEach(function (item, i) {
      const tile = document.createElement('div');
      tile.className = 'sd-cards-edit-tile';

      // Delete button — top-right corner of tile
      const delBtn = makeBtn('close', 'Remove card', (function (idx) {
        return function () {
          if (items.length <= 1) return;
          items.splice(idx, 1);
          render(); emit();
        };
      }(i)), 'sd-cards-tile-del');
      delBtn.disabled = !editable || items.length <= 1;
      tile.appendChild(delBtn);

      // Title input — styled as the card title (bold)
      const titleInp = document.createElement('input');
      titleInp.type = 'text';
      titleInp.className = 'sd-cards-tile-title';
      titleInp.value = item.title;
      titleInp.placeholder = 'Card title';
      titleInp.disabled = !editable;
      titleInp.addEventListener('input', function () { item.title = titleInp.value; emit(); });
      tile.appendChild(titleInp);

      // Description input — styled as the card description (small, muted)
      const textInp = document.createElement('input');
      textInp.type = 'text';
      textInp.className = 'sd-cards-tile-text';
      textInp.value = item.text;
      textInp.placeholder = 'Short description';
      textInp.disabled = !editable;
      textInp.addEventListener('input', function () { item.text = textInp.value; emit(); });
      tile.appendChild(textInp);

      grid.appendChild(tile);
    });

    element.appendChild(grid);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return { element, getData: function () { return items.slice(); }, setEditable: setEditableFn };
}

// ═════════════════════════════════════════════════════════════════════════════
//  createFlowBlock   — horizontal pipeline steps
// ═════════════════════════════════════════════════════════════════════════════

export function createFlowBlock(initialSteps, onChange) {
  const steps = (initialSteps || []).filter(Boolean).map(String);
  if (!steps.length) steps.push('Step one', 'Step two', 'Step three');

  const element = makeWrapper('flow', 'sd-rich-block--flow');
  let editable = true;

  function emit() {
    element.dataset.steps = JSON.stringify(steps);
    if (typeof onChange === 'function') onChange(steps.slice());
  }

  function render() {
    element.innerHTML = '';
    const addBtn = makeAddBtn('Add step', function () {
      steps.push('');
      render(); emit();
      const inputs = element.querySelectorAll('.sd-rich-flow-input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });
    addBtn.disabled = !editable;
    element.appendChild(makeHeader('linear_scale', 'Flow', element, [
      addBtn,
      makeDeleteBlockBtn(element, onChange),
    ]));

    const body = document.createElement('div');
    body.className = 'sd-rich-body sd-rich-flow-body';

    steps.forEach(function (step, i) {
      const pill = document.createElement('div');
      pill.className = 'sd-rich-flow-pill';

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'sd-rich-flow-input';
      inp.value = step;
      inp.placeholder = 'Step ' + (i + 1);
      inp.disabled = !editable;
      inp.addEventListener('input', function () { steps[i] = inp.value; emit(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          steps.splice(i + 1, 0, '');
          render(); emit();
          const all = element.querySelectorAll('.sd-rich-flow-input');
          if (all[i + 1]) { all[i + 1].focus(); }
        }
        if (e.key === 'Backspace' && inp.value === '' && steps.length > 1) {
          e.preventDefault();
          steps.splice(i, 1);
          render(); emit();
          const all = element.querySelectorAll('.sd-rich-flow-input');
          if (all[Math.max(0, i - 1)]) all[Math.max(0, i - 1)].focus();
        }
      });

      pill.appendChild(inp);

      if (editable && steps.length > 1) {
        const delBtn = makeBtn('close', 'Remove step', (function (idx) {
          return function () {
            if (steps.length <= 1) return;
            steps.splice(idx, 1);
            render(); emit();
          };
        }(i)), 'sd-rich-flow-del');
        pill.appendChild(delBtn);
      }

      body.appendChild(pill);

      if (i < steps.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'sd-rich-flow-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.appendChild(icon('arrow_forward'));
        body.appendChild(arrow);
      }
    });

    element.appendChild(body);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return { element, getData: function () { return steps.slice(); }, setEditable: setEditableFn };
}

// ═════════════════════════════════════════════════════════════════════════════
//  createComparisonBlock   — options comparison with status
// ═════════════════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: 'Chosen',      label: 'Chosen' },
  { value: 'Rejected',    label: 'Rejected' },
  { value: 'Considered',  label: 'Considered' },
];

export function createComparisonBlock(initialRows, onChange) {
  const rows = (initialRows || []).map(function (r) {
    return {
      title:    String(r.title || ''),
      status:   String(r.status || 'Considered'),
      text:     String(r.text || ''),
      selected: !!r.selected,
    };
  });
  if (!rows.length) {
    rows.push({ title: 'Option A', status: 'Chosen',   text: '', selected: true  });
    rows.push({ title: 'Option B', status: 'Rejected', text: '', selected: false });
  }

  const element = makeWrapper('comparison', 'sd-rich-block--comparison');
  let editable = true;

  function emit() {
    element.dataset.rows = JSON.stringify(rows);
    if (typeof onChange === 'function') onChange(rows.map(function (r) { return Object.assign({}, r); }));
  }

  function render() {
    element.innerHTML = '';
    const addBtn = makeAddBtn('Add option', function () {
      rows.push({ title: 'Option ' + String.fromCharCode(65 + rows.length), status: 'Considered', text: '', selected: false });
      render(); emit();
    });
    addBtn.disabled = !editable;
    element.appendChild(makeHeader('compare_arrows', 'Comparison', element, [
      addBtn,
      makeDeleteBlockBtn(element, onChange),
    ]));

    const body = document.createElement('div');
    body.className = 'sd-rich-body';

    rows.forEach(function (row, i) {
      const item = document.createElement('div');
      item.className = 'sd-rich-item sd-rich-comparison-item' + (row.selected ? ' sd-rich-comparison-selected' : '');

      // Top row: selected toggle, title, status, delete
      const topRow = document.createElement('div');
      topRow.className = 'sd-rich-comparison-top';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'sd-rich-comparison-chk';
      chk.checked = row.selected;
      chk.title = 'Mark as selected option';
      chk.disabled = !editable;
      chk.addEventListener('change', function () {
        row.selected = chk.checked;
        item.classList.toggle('sd-rich-comparison-selected', row.selected);
        emit();
      });

      const titleInp = makeInput(row.title, 'Option title', function (v) { row.title = v; emit(); });
      titleInp.className += ' sd-rich-input--strong';
      titleInp.disabled = !editable;

      const statusSel = makeSelect(STATUS_OPTIONS, row.status, function (v) { row.status = v; emit(); });
      statusSel.disabled = !editable;

      const delBtn = makeBtn('close', 'Remove option', (function (idx) {
        return function () {
          if (rows.length <= 1) return;
          rows.splice(idx, 1);
          render(); emit();
        };
      }(i)), 'sd-rich-item-del');
      delBtn.disabled = !editable || rows.length <= 1;

      topRow.appendChild(chk);
      topRow.appendChild(titleInp);
      topRow.appendChild(statusSel);
      topRow.appendChild(delBtn);

      // Bottom: detail text
      const ta = makeTextarea(row.text, 'Why this option was chosen or rejected…', function (v) { row.text = v; emit(); });
      ta.disabled = !editable;

      item.appendChild(topRow);
      item.appendChild(ta);
      body.appendChild(item);
    });

    element.appendChild(body);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return { element, getData: function () { return rows.map(function (r) { return Object.assign({}, r); }); }, setEditable: setEditableFn };
}

// ═════════════════════════════════════════════════════════════════════════════
//  createSequenceBlock   — numbered steps
// ═════════════════════════════════════════════════════════════════════════════

export function createSequenceBlock(initialSteps, onChange) {
  const steps = (initialSteps || []).filter(Boolean).map(String);
  if (!steps.length) steps.push('First step', 'Second step');

  const element = makeWrapper('sequence', 'sd-rich-block--sequence');
  let editable = true;

  function emit() {
    element.dataset.steps = JSON.stringify(steps);
    if (typeof onChange === 'function') onChange(steps.slice());
  }

  function render() {
    element.innerHTML = '';
    const addBtn = makeAddBtn('Add step', function () {
      steps.push('');
      render(); emit();
      const inputs = element.querySelectorAll('.sd-rich-seq-input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); }
    });
    addBtn.disabled = !editable;
    element.appendChild(makeHeader('format_list_numbered', 'Sequence', element, [
      addBtn,
      makeDeleteBlockBtn(element, onChange),
    ]));

    const body = document.createElement('div');
    body.className = 'sd-rich-body';

    steps.forEach(function (step, i) {
      const row = document.createElement('div');
      row.className = 'sd-rich-item sd-rich-seq-item';

      const num = document.createElement('span');
      num.className = 'sd-rich-seq-num';
      num.textContent = String(i + 1);

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'sd-rich-input sd-rich-seq-input';
      inp.value = step;
      inp.placeholder = 'Step ' + (i + 1) + ' description';
      inp.disabled = !editable;
      inp.addEventListener('input', function () { steps[i] = inp.value; emit(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          steps.splice(i + 1, 0, '');
          render(); emit();
          const all = element.querySelectorAll('.sd-rich-seq-input');
          if (all[i + 1]) all[i + 1].focus();
        }
        if (e.key === 'Backspace' && inp.value === '' && steps.length > 1) {
          e.preventDefault();
          steps.splice(i, 1);
          render(); emit();
          const all = element.querySelectorAll('.sd-rich-seq-input');
          if (all[Math.max(0, i - 1)]) all[Math.max(0, i - 1)].focus();
        }
      });

      const delBtn = makeBtn('close', 'Remove step', (function (idx) {
        return function () {
          if (steps.length <= 1) return;
          steps.splice(idx, 1);
          render(); emit();
        };
      }(i)), 'sd-rich-item-del');
      delBtn.disabled = !editable || steps.length <= 1;

      row.appendChild(num);
      row.appendChild(inp);
      row.appendChild(delBtn);
      body.appendChild(row);
    });

    element.appendChild(body);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return { element, getData: function () { return steps.slice(); }, setEditable: setEditableFn };
}

// ═════════════════════════════════════════════════════════════════════════════
//  createRisksBlock   — risk grid with severity levels
// ═════════════════════════════════════════════════════════════════════════════

const LEVEL_OPTIONS = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
];

export function createRisksBlock(initialItems, onChange) {
  const items = (initialItems || []).map(function (r) {
    return { level: String(r.level || 'medium'), title: String(r.title || ''), text: String(r.text || '') };
  });
  if (!items.length) items.push({ level: 'medium', title: '', text: '' });

  const element = makeWrapper('risks', 'sd-rich-block--risks');
  let editable = true;

  function emit() {
    element.dataset.items = JSON.stringify(items);
    if (typeof onChange === 'function') onChange(items.map(function (i) { return Object.assign({}, i); }));
  }

  function render() {
    element.innerHTML = '';
    const addBtn = makeAddBtn('Add risk', function () {
      items.push({ level: 'medium', title: '', text: '' });
      render(); emit();
      const inputs = element.querySelectorAll('.sd-rich-input');
      if (inputs[inputs.length - 2]) inputs[inputs.length - 2].focus();
    });
    addBtn.disabled = !editable;
    element.appendChild(makeHeader('warning', 'Risk grid', element, [
      addBtn,
      makeDeleteBlockBtn(element, onChange),
    ]));

    const body = document.createElement('div');
    body.className = 'sd-rich-body';

    items.forEach(function (item, i) {
      const row = document.createElement('div');
      row.className = 'sd-rich-item sd-rich-risk-item sd-rich-risk--' + (item.level || 'medium');

      const topRow = document.createElement('div');
      topRow.className = 'sd-rich-risk-top';

      const lvlSel = makeSelect(LEVEL_OPTIONS, item.level, function (v) {
        item.level = v;
        row.className = 'sd-rich-item sd-rich-risk-item sd-rich-risk--' + v;
        emit();
      });
      lvlSel.className += ' sd-rich-level-select sd-rich-level--' + item.level;
      lvlSel.disabled = !editable;
      lvlSel.addEventListener('change', function () {
        lvlSel.className = 'sd-rich-select sd-rich-level-select sd-rich-level--' + lvlSel.value;
      });

      const titleInp = makeInput(item.title, 'Risk title', function (v) { item.title = v; emit(); });
      titleInp.className += ' sd-rich-input--strong';
      titleInp.disabled = !editable;

      const delBtn = makeBtn('close', 'Remove risk', (function (idx) {
        return function () {
          if (items.length <= 1) return;
          items.splice(idx, 1);
          render(); emit();
        };
      }(i)), 'sd-rich-item-del');
      delBtn.disabled = !editable || items.length <= 1;

      topRow.appendChild(lvlSel);
      topRow.appendChild(titleInp);
      topRow.appendChild(delBtn);

      const ta = makeTextarea(item.text, 'Describe the risk and how it is mitigated…', function (v) { item.text = v; emit(); });
      ta.disabled = !editable;

      row.appendChild(topRow);
      row.appendChild(ta);
      body.appendChild(row);
    });

    element.appendChild(body);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return { element, getData: function () { return items.map(function (i) { return Object.assign({}, i); }); }, setEditable: setEditableFn };
}

// ═════════════════════════════════════════════════════════════════════════════
//  createHeroBlock   — selected-design summary with decision grid
// ═════════════════════════════════════════════════════════════════════════════

export function createHeroBlock(initialData, onChange) {
  const data = Object.assign(
    { kicker: 'Selected design', heading: '', text: '', cells: [] },
    initialData || {}
  );
  data.cells = (data.cells || []).map(function (c) {
    return { label: String(c.label || ''), value: String(c.value || '') };
  });
  if (!data.cells.length) {
    data.cells.push({ label: 'Pattern', value: '' });
    data.cells.push({ label: 'Trade-off', value: '' });
  }

  const element = makeWrapper('hero', 'sd-rich-block--hero');
  let editable = true;

  function emit() {
    element.dataset.kicker = data.kicker;
    element.dataset.heading = data.heading;
    element.dataset.body = data.text;
    element.dataset.cells = JSON.stringify(data.cells);
    if (typeof onChange === 'function') onChange(Object.assign({}, data, { cells: data.cells.map(function (c) { return Object.assign({}, c); }) }));
  }

  function render() {
    element.innerHTML = '';
    element.appendChild(makeHeader('stars', 'Selected design', element, [
      makeDeleteBlockBtn(element, onChange),
    ]));

    const body = document.createElement('div');
    body.className = 'sd-rich-body sd-rich-hero-body';

    // Kicker
    const kickerRow = document.createElement('div');
    kickerRow.className = 'sd-rich-hero-row';
    const kickerLabel = document.createElement('label');
    kickerLabel.className = 'sd-rich-hero-label';
    kickerLabel.textContent = 'Kicker';
    const kickerInp = makeInput(data.kicker, 'e.g. Selected design', function (v) { data.kicker = v; emit(); });
    kickerInp.disabled = !editable;
    kickerRow.appendChild(kickerLabel);
    kickerRow.appendChild(kickerInp);
    body.appendChild(kickerRow);

    // Heading
    const headingRow = document.createElement('div');
    headingRow.className = 'sd-rich-hero-row';
    const headingLabel = document.createElement('label');
    headingLabel.className = 'sd-rich-hero-label';
    headingLabel.textContent = 'Heading';
    const headingInp = makeInput(data.heading, 'Chosen architecture or approach', function (v) { data.heading = v; emit(); });
    headingInp.className += ' sd-rich-input--strong';
    headingInp.disabled = !editable;
    headingRow.appendChild(headingLabel);
    headingRow.appendChild(headingInp);
    body.appendChild(headingRow);

    // Summary text
    const textRow = document.createElement('div');
    textRow.className = 'sd-rich-hero-row';
    const textLabel = document.createElement('label');
    textLabel.className = 'sd-rich-hero-label';
    textLabel.textContent = 'Summary';
    const textTa = makeTextarea(data.text, 'One or two sentences explaining the decision…', function (v) { data.text = v; emit(); });
    textTa.disabled = !editable;
    textRow.appendChild(textLabel);
    textRow.appendChild(textTa);
    body.appendChild(textRow);

    // Decision cells
    const cellsSection = document.createElement('div');
    cellsSection.className = 'sd-rich-hero-cells-section';

    const cellsHdr = document.createElement('div');
    cellsHdr.className = 'sd-rich-hero-cells-hdr';
    const cellsTitle = document.createElement('span');
    cellsTitle.className = 'sd-rich-hero-cells-title';
    cellsTitle.textContent = 'Decision properties';
    cellsHdr.appendChild(cellsTitle);
    const addCellBtn = makeAddBtn('Add property', function () {
      data.cells.push({ label: '', value: '' });
      render(); emit();
      const inputs = element.querySelectorAll('.sd-rich-cell-input');
      if (inputs[inputs.length - 2]) inputs[inputs.length - 2].focus();
    });
    addCellBtn.disabled = !editable;
    cellsHdr.appendChild(addCellBtn);
    cellsSection.appendChild(cellsHdr);

    data.cells.forEach(function (cell, i) {
      const cellRow = document.createElement('div');
      cellRow.className = 'sd-rich-item sd-rich-hero-cell-row';

      const labelInp = document.createElement('input');
      labelInp.type = 'text';
      labelInp.className = 'sd-rich-input sd-rich-cell-input sd-rich-cell-label';
      labelInp.value = cell.label;
      labelInp.placeholder = 'Property';
      labelInp.disabled = !editable;
      labelInp.addEventListener('input', function () { cell.label = labelInp.value; emit(); });

      const sep = document.createElement('span');
      sep.className = 'sd-rich-cell-sep';
      sep.textContent = ':';

      const valueInp = document.createElement('input');
      valueInp.type = 'text';
      valueInp.className = 'sd-rich-input sd-rich-cell-input sd-rich-cell-value';
      valueInp.value = cell.value;
      valueInp.placeholder = 'Value';
      valueInp.disabled = !editable;
      valueInp.addEventListener('input', function () { cell.value = valueInp.value; emit(); });

      const delBtn = makeBtn('close', 'Remove property', (function (idx) {
        return function () {
          if (data.cells.length <= 1) return;
          data.cells.splice(idx, 1);
          render(); emit();
        };
      }(i)), 'sd-rich-item-del');
      delBtn.disabled = !editable || data.cells.length <= 1;

      cellRow.appendChild(labelInp);
      cellRow.appendChild(sep);
      cellRow.appendChild(valueInp);
      cellRow.appendChild(delBtn);
      cellsSection.appendChild(cellRow);
    });

    body.appendChild(cellsSection);
    element.appendChild(body);
    emit();
  }

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-rich-locked', !val);
    render();
  }

  render();
  element._setEditable = setEditableFn;
  return {
    element,
    getData: function () {
      return Object.assign({}, data, { cells: data.cells.map(function (c) { return Object.assign({}, c); }) });
    },
    setEditable: setEditableFn,
  };
}
