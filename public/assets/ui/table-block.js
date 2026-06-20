/**
 * TableBlock — dedicated table editor with dynamic rows & columns.
 *
 * Layout (edit mode):
 *   ┌──────────┬──────────┬──────────┬──────┐
 *   │  [×]     │  [×]     │  [×]     │ [+]  │  ← thead: del-col per col, add-col at end
 *   ├──────────┼──────────┼──────────┼──────┤
 *   │ input    │ input    │ input    │ + −  │  ← tbody: inputs + row actions
 *   ├──────────┼──────────┼──────────┼──────┤
 *   │ input    │ input    │ input    │ + −  │
 *   └──────────┴──────────┴──────────┴──────┘
 *
 * Data model:  rows = [['cell0', 'cell1', 'cell2'], ...]
 * Backward compat: legacy {key, value} rows are auto-migrated to ['key','value'].
 *
 * Public API
 *   createTableBlock(rows, onChange) → { element, getRows(), setEditable(bool) }
 */

function normaliseRow(row, colCount) {
  let cells;
  if (Array.isArray(row)) {
    cells = row.map(function (c) { return String(c == null ? '' : c); });
  } else if (row && typeof row === 'object') {
    if (Array.isArray(row.cells)) {
      // Firestore-safe storage format {cells:['c0','c1',...]}
      cells = row.cells.map(function (c) { return String(c == null ? '' : c); });
    } else {
      // Legacy {key, value} format
      cells = [String(row.key || ''), String(row.value || '')];
    }
  } else {
    cells = [];
  }
  while (cells.length < colCount) cells.push('');
  return cells.slice(0, colCount);
}

export function createTableBlock(initialRows, onChange) {
  // Derive initial column count from data (minimum 3).
  const seedRows = Array.isArray(initialRows) && initialRows.length ? initialRows : null;
  let colCount = 2;
  if (seedRows) {
    const firstLen = Array.isArray(seedRows[0])
      ? seedRows[0].length
      : (seedRows[0] && typeof seedRows[0] === 'object' ? 2 : 0);
    colCount = Math.max(colCount, firstLen);
  }

  const rows = seedRows
    ? seedRows.map(function (r) { return normaliseRow(r, colCount); })
    : [Array(colCount).fill(''), Array(colCount).fill('')];

  const element = document.createElement('div');
  element.className = 'sd-table-block';
  element.contentEditable = 'false';
  element.setAttribute('data-block', 'matrix');
  element.setAttribute('tabindex', '-1');

  let editable = true;

  // ── state helpers ──────────────────────────────────────────────────────────

  function syncAttr() {
    element.dataset.rows = JSON.stringify(rows);
    element.dataset.cols = String(colCount);
  }

  function emit() {
    syncAttr();
    if (typeof onChange === 'function') onChange(rows.map(function (r) { return r.slice(); }));
  }

  function allInputs() {
    return Array.from(element.querySelectorAll('.sd-tbl-input'));
  }

  function focusCell(rowIdx, colIdx) {
    const inputs = allInputs();
    const i = Math.max(0, Math.min(rowIdx, rows.length - 1));
    const j = Math.max(0, Math.min(colIdx, colCount - 1));
    const target = inputs[i * colCount + j];
    if (target) { target.focus(); target.select(); }
  }

  // ── column operations ──────────────────────────────────────────────────────

  function addColumn() {
    colCount++;
    rows.forEach(function (r) { r.push(''); });
    render(); emit();
  }

  function deleteColumn(colIdx) {
    if (colCount <= 1) return;
    colCount--;
    rows.forEach(function (r) { r.splice(colIdx, 1); });
    render(); emit();
    focusCell(0, Math.min(colIdx, colCount - 1));
  }

  // ── row operations ─────────────────────────────────────────────────────────

  function addRowAfter(rowIdx) {
    rows.splice(rowIdx + 1, 0, Array(colCount).fill(''));
    render(); emit();
    focusCell(rowIdx + 1, 0);
  }

  function deleteRow(rowIdx) {
    if (rows.length <= 1) return;
    rows.splice(rowIdx, 1);
    render(); emit();
    focusCell(Math.max(0, rowIdx - 1), 0);
  }

  // ── keyboard navigation ────────────────────────────────────────────────────

  function navKeys(e, rowIdx, colIdx) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const inputs = allInputs();
      const idx = rowIdx * colCount + colIdx;
      const next = inputs[e.shiftKey ? idx - 1 : idx + 1];
      if (next) {
        next.focus(); next.select();
      } else if (!e.shiftKey) {
        rows.push(Array(colCount).fill(''));
        render(); emit();
        focusCell(rows.length - 1, 0);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (rowIdx + 1 < rows.length) {
        focusCell(rowIdx + 1, colIdx);
      } else {
        rows.push(Array(colCount).fill(''));
        render(); emit();
        focusCell(rows.length - 1, colIdx);
      }
      return;
    }
    if (e.key === 'Backspace' && e.target.value === '' && rows.length > 1) {
      e.preventDefault();
      deleteRow(rowIdx);
    }
  }

  // ── button factory ─────────────────────────────────────────────────────────

  function makeBtn(icon, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-tbl-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = title;
    btn.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>';
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── render ─────────────────────────────────────────────────────────────────

  function buildColCtrlRow() {
    const tr = document.createElement('tr');
    tr.className = 'sd-tbl-col-ctrl';

    for (let c = 0; c < colCount; c++) {
      const th = document.createElement('th');
      th.className = 'sd-tbl-col-hdr';

      const delBtn = makeBtn('close', 'Delete column', (function (ci) {
        return function () { deleteColumn(ci); };
      }(c)), 'sd-tbl-col-del');
      delBtn.disabled = colCount <= 1;
      th.appendChild(delBtn);

      tr.appendChild(th);
    }

    // Action-column header: add-column button.
    const actionTh = document.createElement('th');
    actionTh.className = 'sd-tbl-action-hdr';
    actionTh.appendChild(makeBtn('add', 'Add column', addColumn, 'sd-tbl-add-col'));
    tr.appendChild(actionTh);

    return tr;
  }

  function buildDataRow(row, i) {
    const tr = document.createElement('tr');
    tr.className = 'sd-tbl-row';

    row.forEach(function (cellVal, j) {
      const td = document.createElement('td');
      td.className = 'sd-tbl-cell';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'sd-tbl-input';
      input.value = cellVal;
      input.disabled = !editable;
      input.addEventListener('input', function () { rows[i][j] = input.value; emit(); });
      input.addEventListener('keydown', function (e) { navKeys(e, i, j); });
      td.appendChild(input);

      tr.appendChild(td);
    });

    // Action column: add row below + delete row.
    const actionTd = document.createElement('td');
    actionTd.className = 'sd-tbl-action-cell';
    actionTd.appendChild(makeBtn('add', 'Insert row below', (function (ri) {
      return function () { addRowAfter(ri); };
    }(i))));
    const delRowBtn = makeBtn('remove', 'Delete row', (function (ri) {
      return function () { deleteRow(ri); };
    }(i)), 'sd-tbl-del');
    delRowBtn.disabled = rows.length <= 1;
    actionTd.appendChild(delRowBtn);
    tr.appendChild(actionTd);

    return tr;
  }

  function render() {
    element.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'sd-tbl-wrap';

    const table = document.createElement('table');
    table.className = 'sd-tbl';

    // colgroup: equal widths for data cols, fixed narrow width for action col.
    const colgroup = document.createElement('colgroup');
    for (let c = 0; c < colCount; c++) {
      colgroup.appendChild(document.createElement('col'));
    }
    const actionCol = document.createElement('col');
    actionCol.className = 'sd-tbl-action-col';
    colgroup.appendChild(actionCol);
    table.appendChild(colgroup);

    // thead: column controls (only shown in edit mode via CSS).
    const thead = document.createElement('thead');
    thead.appendChild(buildColCtrlRow());
    table.appendChild(thead);

    // tbody: data rows.
    const tbody = document.createElement('tbody');
    rows.forEach(function (row, i) { tbody.appendChild(buildDataRow(row, i)); });
    table.appendChild(tbody);

    wrap.appendChild(table);
    element.appendChild(wrap);
    syncAttr();
  }

  // ── public API ─────────────────────────────────────────────────────────────

  render();
  // Start in editing mode — mark the element so CSS shows controls.
  element.classList.add('sd-tbl-editing');

  function setEditableFn(val) {
    editable = !!val;
    element.querySelectorAll('.sd-tbl-input').forEach(function (el) { el.disabled = !val; });
    element.querySelectorAll('.sd-tbl-btn').forEach(function (el) { el.disabled = !val; });
    element.classList.toggle('sd-tbl-editing', !!val);
    element.classList.toggle('sd-tbl-locked', !val);
  }

  element._setEditable = setEditableFn;

  return {
    element,
    getRows: function () { return rows.map(function (r) { return r.slice(); }); },
    setEditable: setEditableFn,
  };
}
