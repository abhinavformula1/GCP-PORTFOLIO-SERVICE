/**
 * DataTable — small reusable table renderer for the admin UI.
 *
 * Intent:
 * - Keep tables consistent (wrap, empty state, column definitions).
 * - Stay flexible: callers own row shaping + actions.
 *
 * This is not a full grid (sorting/pagination/virtualization). It’s a
 * lightweight shared primitive that we can extend when requirements stabilize.
 */


/**
 * @typedef {Object} DataTableColumn
 * @property {string} key
 * @property {string} header
 * @property {string=} align - 'left' | 'right' | 'center'
 * @property {string|number=} width - e.g. '240px' or 240
 * @property {(row:any, idx:number)=>string=} renderText - returns unescaped text (we escape)
 * @property {(row:any, idx:number)=>string=} renderHtml - returns HTML (caller must escape as needed)
 * @property {string=} className
 */

/**
 * Renders a table into `mount` and returns the created wrapper element.
 *
 * @param {HTMLElement} mount
 * @param {Object} opts
 * @param {string=} opts.ariaLabel
 * @param {DataTableColumn[]} opts.columns
 * @param {any[]} opts.rows
 * @param {string=} opts.emptyText
 * @param {string=} opts.tableClassName
 * @param {boolean=} opts.responsive - stacks rows into label/value pairs on small screens
 * @param {string|number=} opts.minWidth
 */
export function renderDataTable(mount, opts) {
  const options = opts || {};
  const columns = Array.isArray(options.columns) ? options.columns : [];
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const emptyText = String(options.emptyText || 'No rows.');

  const wrap = document.createElement('div');
  wrap.className = 'sd-analytics-table-wrap' + (options.responsive ? ' sd-table-responsive' : '');

  const table = document.createElement('table');
  table.className = 'sd-analytics-table' + (options.tableClassName ? (' ' + String(options.tableClassName)) : '');
  if (options.ariaLabel) table.setAttribute('aria-label', String(options.ariaLabel));
  if (options.minWidth) {
    const w = typeof options.minWidth === 'number' ? (String(options.minWidth) + 'px') : String(options.minWidth);
    table.style.minWidth = w;
  }

  // Optional column widths
  const hasWidths = columns.some((c) => c && c.width);
  if (hasWidths) {
    const colgroup = document.createElement('colgroup');
    columns.forEach((c) => {
      const col = document.createElement('col');
      if (c && c.width) {
        col.style.width = typeof c.width === 'number' ? (String(c.width) + 'px') : String(c.width);
      }
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
  }

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  columns.forEach((c) => {
    const th = document.createElement('th');
    const headerLabel = c && c.header ? String(c.header) : '';
    th.textContent = headerLabel;
    if (c && c.align === 'right') th.classList.add('sd-analytics-num');
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = Math.max(1, columns.length);
    td.className = 'sd-analytics-empty';
    td.textContent = emptyText;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    rows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      columns.forEach((c) => {
        const td = document.createElement('td');
        const headerLabel = c && c.header ? String(c.header) : '';
        if (headerLabel) td.setAttribute('data-label', headerLabel);
        if (c && c.className) td.className = String(c.className);
        if (c && c.align === 'right') td.classList.add('sd-analytics-num');

        const value = document.createElement('div');
        value.className = 'sd-dt-value';
        if (c && typeof c.renderHtml === 'function') {
          value.innerHTML = String(c.renderHtml(row, idx) || '');
        } else if (c && typeof c.renderText === 'function') {
          value.textContent = String(c.renderText(row, idx) ?? '');
        } else {
          value.textContent = String(row && c && c.key ? (row[c.key] ?? '') : '');
        }
        td.appendChild(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  mount.replaceChildren(wrap);
  return wrap;
}

