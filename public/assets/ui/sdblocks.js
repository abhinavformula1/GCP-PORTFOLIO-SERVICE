/**
 * Shared System Design article block model.
 *
 * One content model, one renderer. The admin editor composes an ordered list
 * of typed blocks; the public System Design page renders the exact same blocks.
 * HTML is generated deterministically from blocks via `blocksToHtml` so what an
 * author approves in the admin preview is byte-for-byte what readers see.
 *
 * Legacy articles that only have rich `en.body` HTML are migrated into blocks
 * via `htmlToBlocks`, with an `html` fallback block so nothing is ever lost.
 */

export const BLOCK_DEFS = [
  { type: 'heading',    label: 'Heading',        icon: 'title',          hint: 'Section heading (e.g. Problem, Solution).' },
  { type: 'paragraph',  label: 'Paragraph',      icon: 'notes',          hint: 'A block of prose. Supports **bold**, _italic_, `code`.' },
  { type: 'bullets',    label: 'Bullet list',    icon: 'format_list_bulleted', hint: 'A list of points, one per line.' },
  { type: 'hero',       label: 'Selected design', icon: 'stars',         hint: 'Highlighted summary with a decision grid.' },
  { type: 'cards',      label: 'Info cards',     icon: 'grid_view',      hint: 'Titled cards, e.g. design goals.' },
  { type: 'flow',       label: 'Flow',           icon: 'linear_scale',   hint: 'Left-to-right steps, e.g. trust boundaries.' },
  { type: 'comparison', label: 'Comparison',     icon: 'compare_arrows', hint: 'Options with a status and verdict.' },
  { type: 'sequence',   label: 'Sequence',       icon: 'format_list_numbered', hint: 'Numbered steps for an architecture flow.' },
  { type: 'matrix',     label: 'Matrix table',   icon: 'table_rows',     hint: 'Key/value rows, e.g. security properties.' },
  { type: 'risks',      label: 'Risk grid',      icon: 'warning',        hint: 'Risk cards with a severity level.' },
  { type: 'html',       label: 'Custom HTML',    icon: 'code',           hint: 'Advanced: raw HTML preserved as-is.' },
];

const RISK_LEVELS = ['low', 'medium', 'high'];

export function blockLabel(type) {
  const def = BLOCK_DEFS.find(function (item) { return item.type === type; });
  return def ? def.label : 'Block';
}

export function blockIcon(type) {
  const def = BLOCK_DEFS.find(function (item) { return item.type === type; });
  return def ? def.icon : 'widgets';
}

function uid() {
  return 'block-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function newBlock(type) {
  const base = { id: uid(), type };
  switch (type) {
    case 'heading':    return Object.assign(base, { text: '' });
    case 'paragraph':  return Object.assign(base, { text: '' });
    case 'bullets':    return Object.assign(base, { items: [] });
    case 'hero':       return Object.assign(base, { kicker: 'Selected design', heading: '', text: '', cells: [] });
    case 'cards':      return Object.assign(base, { items: [] });
    case 'flow':       return Object.assign(base, { steps: [] });
    case 'comparison': return Object.assign(base, { rows: [] });
    case 'sequence':   return Object.assign(base, { steps: [] });
    case 'matrix':     return Object.assign(base, { rows: [] });
    case 'risks':      return Object.assign(base, { items: [] });
    case 'html':       return Object.assign(base, { html: '' });
    default:           return Object.assign(base, { type: 'paragraph', text: '' });
  }
}

export function cloneBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map(function (block) {
    return JSON.parse(JSON.stringify(block));
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(value) {
  let text = escapeHtml(value);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  return text;
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

// ── Block → HTML ──────────────────────────────────────────────────────────────

function heroToHtml(block) {
  let html = '<section class="sd-hero-block">';
  if (block.kicker) html += '<div class="sd-kicker">' + escapeHtml(block.kicker) + '</div>';
  if (block.heading) html += '<h3>' + inlineMd(block.heading) + '</h3>';
  if (block.text) html += '<p>' + inlineMd(block.text) + '</p>';
  const cells = Array.isArray(block.cells) ? block.cells.filter(function (c) { return c && (c.label || c.value); }) : [];
  if (cells.length) {
    html += '<div class="sd-decision-grid">';
    cells.forEach(function (cell) {
      html += '<div><span>' + escapeHtml(cell.label) + '</span><strong>' + escapeHtml(cell.value) + '</strong></div>';
    });
    html += '</div>';
  }
  html += '</section>';
  return html;
}

function cardsToHtml(block) {
  const items = Array.isArray(block.items) ? block.items.filter(function (i) { return i && (i.title || i.text); }) : [];
  if (!items.length) return '';
  let html = '<div class="sd-card-grid">';
  items.forEach(function (item) {
    html += '<div class="sd-info-card"><strong>' + inlineMd(item.title) + '</strong><span>' + inlineMd(item.text) + '</span></div>';
  });
  html += '</div>';
  return html;
}

function comparisonToHtml(block) {
  const rows = Array.isArray(block.rows) ? block.rows.filter(function (r) { return r && (r.title || r.text); }) : [];
  if (!rows.length) return '';
  let html = '<div class="sd-comparison">';
  rows.forEach(function (row) {
    html += '<div class="sd-comparison-row' + (row.selected ? ' sd-selected' : '') + '">';
    html += '<strong>' + escapeHtml(row.title) + '</strong>';
    if (row.status) html += '<span>' + escapeHtml(row.status) + '</span>';
    if (row.text) html += '<p>' + inlineMd(row.text) + '</p>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function sequenceToHtml(block) {
  const steps = Array.isArray(block.steps) ? block.steps.filter(Boolean) : [];
  if (!steps.length) return '';
  let html = '<div class="sd-sequence">';
  steps.forEach(function (step, index) {
    html += '<div><b>' + (index + 1) + '</b><span>' + inlineMd(step) + '</span></div>';
  });
  html += '</div>';
  return html;
}

function matrixToHtml(block) {
  // Keep all rows (including empty ones) so the table renders in the editor.
  // Only skip null/undefined entries; guard against a completely rowless block.
  const rows = Array.isArray(block.rows) ? block.rows.filter(function (r) { return r != null; }) : [];
  if (!rows.length) return '';
  let html = '<div class="sd-matrix-wrap"><table class="sd-matrix"><tbody>';
  rows.forEach(function (row) {
    html += '<tr><th>' + escapeHtml(row.key) + '</th><td>' + inlineMd(row.value) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function risksToHtml(block) {
  const items = Array.isArray(block.items) ? block.items.filter(function (i) { return i && (i.title || i.text); }) : [];
  if (!items.length) return '';
  let html = '<div class="sd-risk-grid">';
  items.forEach(function (item) {
    const level = RISK_LEVELS.indexOf(item.level) === -1 ? 'medium' : item.level;
    html += '<div class="sd-risk ' + level + '"><strong>' + escapeHtml(item.title) + '</strong><span>' + inlineMd(item.text) + '</span></div>';
  });
  html += '</div>';
  return html;
}

export function blockToHtml(block) {
  if (!block || !block.type) return '';
  switch (block.type) {
    case 'heading':    return block.text ? '<h3>' + inlineMd(block.text) + '</h3>' : '';
    case 'paragraph':  return block.text ? '<p>' + inlineMd(block.text) + '</p>' : '';
    case 'bullets': {
      const items = Array.isArray(block.items) ? block.items.filter(Boolean) : [];
      if (!items.length) return '';
      return '<ul>' + items.map(function (item) { return '<li>' + inlineMd(item) + '</li>'; }).join('') + '</ul>';
    }
    case 'hero':       return heroToHtml(block);
    case 'cards':      return cardsToHtml(block);
    case 'flow': {
      const steps = Array.isArray(block.steps) ? block.steps.filter(Boolean) : [];
      if (!steps.length) return '';
      return '<div class="sd-flow">' + steps.map(function (step) { return '<span>' + escapeHtml(step) + '</span>'; }).join('') + '</div>';
    }
    case 'comparison': return comparisonToHtml(block);
    case 'sequence':   return sequenceToHtml(block);
    case 'matrix':     return matrixToHtml(block);
    case 'risks':      return risksToHtml(block);
    case 'html':       return String(block.html || '');
    default:           return '';
  }
}

export function blocksToHtml(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(blockToHtml).filter(Boolean).join('');
}

// ── Plain-text summary (for read-only cards / search) ──────────────────────────

export function blockSummary(block) {
  if (!block) return '';
  switch (block.type) {
    case 'heading':   return cleanText(block.heading || block.text);
    case 'paragraph': return cleanText(block.text);
    case 'bullets':   return (block.items || []).map(cleanText).filter(Boolean).join(' · ');
    case 'hero':      return cleanText(block.heading || block.text || block.kicker);
    case 'cards':     return (block.items || []).map(function (i) { return cleanText(i.title); }).filter(Boolean).join(' · ');
    case 'flow':      return (block.steps || []).map(cleanText).filter(Boolean).join(' → ');
    case 'comparison':return (block.rows || []).map(function (r) { return cleanText(r.title); }).filter(Boolean).join(' · ');
    case 'sequence':  return (block.steps || []).map(cleanText).filter(Boolean).join(' · ');
    case 'matrix':    return (block.rows || []).map(function (r) { return cleanText(r.key); }).filter(Boolean).join(' · ');
    case 'risks':     return (block.items || []).map(function (i) { return cleanText(i.title); }).filter(Boolean).join(' · ');
    case 'html':      return 'Custom HTML block';
    default:          return '';
  }
}

// ── HTML → blocks (migration of legacy rich articles) ──────────────────────────

function inlineToMd(node) {
  if (!node) return '';
  let out = '';
  Array.prototype.forEach.call(node.childNodes, function (child) {
    if (child.nodeType === 3) {
      out += child.textContent;
      return;
    }
    if (child.nodeType !== 1) return;
    const tag = child.tagName.toLowerCase();
    const inner = inlineToMd(child);
    if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
    else if (tag === 'code') out += '`' + inner + '`';
    else if (tag === 'em' || tag === 'i') out += '_' + inner + '_';
    else if (tag === 'br') out += ' ';
    else out += inner;
  });
  return out.replace(/\s+/g, ' ').trim();
}

function heroFromNode(node) {
  const block = newBlock('hero');
  const kicker = node.querySelector('.sd-kicker');
  const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
  block.kicker = kicker ? cleanText(kicker.textContent) : '';
  block.heading = heading ? inlineToMd(heading) : '';
  const paras = Array.prototype.filter.call(node.children, function (child) {
    return child.tagName && child.tagName.toLowerCase() === 'p';
  });
  block.text = paras.length ? inlineToMd(paras[0]) : '';
  const grid = node.querySelector('.sd-decision-grid');
  if (grid) {
    block.cells = Array.prototype.map.call(grid.children, function (cell) {
      return {
        label: cleanText(cell.querySelector('span') ? cell.querySelector('span').textContent : ''),
        value: cleanText(cell.querySelector('strong') ? cell.querySelector('strong').textContent : ''),
      };
    });
  }
  return block;
}

function cardsFromNode(node) {
  const block = newBlock('cards');
  block.items = Array.prototype.map.call(node.children, function (card) {
    return {
      title: inlineToMd(card.querySelector('strong') || card),
      text:  inlineToMd(card.querySelector('span') || card),
    };
  });
  return block;
}

function comparisonFromNode(node) {
  const block = newBlock('comparison');
  block.rows = Array.prototype.map.call(node.children, function (row) {
    return {
      title:    cleanText(row.querySelector('strong') ? row.querySelector('strong').textContent : ''),
      status:   cleanText(row.querySelector('span') ? row.querySelector('span').textContent : ''),
      text:     inlineToMd(row.querySelector('p') || document.createElement('p')),
      selected: row.classList && row.classList.contains('sd-selected'),
    };
  });
  return block;
}

function sequenceFromNode(node) {
  const block = newBlock('sequence');
  block.steps = Array.prototype.map.call(node.children, function (step) {
    const span = step.querySelector('span');
    return inlineToMd(span || step);
  });
  return block;
}

function matrixFromNode(node) {
  const block = newBlock('matrix');
  block.rows = Array.prototype.map.call(node.querySelectorAll('tr'), function (row) {
    return {
      key:   cleanText(row.querySelector('th') ? row.querySelector('th').textContent : ''),
      value: inlineToMd(row.querySelector('td') || document.createElement('td')),
    };
  });
  return block;
}

function risksFromNode(node) {
  const block = newBlock('risks');
  block.items = Array.prototype.map.call(node.children, function (risk) {
    const level = RISK_LEVELS.find(function (lvl) { return risk.classList && risk.classList.contains(lvl); }) || 'medium';
    return {
      level: level,
      title: cleanText(risk.querySelector('strong') ? risk.querySelector('strong').textContent : ''),
      text:  inlineToMd(risk.querySelector('span') || risk),
    };
  });
  return block;
}

function bulletsFromNode(node) {
  const block = newBlock('bullets');
  block.items = Array.prototype.map.call(node.querySelectorAll('li'), function (li) {
    return inlineToMd(li);
  }).filter(Boolean);
  return block;
}

function flowFromNode(node) {
  const block = newBlock('flow');
  block.steps = Array.prototype.map.call(node.children, function (step) {
    return cleanText(step.textContent);
  }).filter(Boolean);
  return block;
}

function nodeToBlock(node) {
  if (node.nodeType !== 1) {
    const text = cleanText(node.textContent);
    if (!text) return null;
    const para = newBlock('paragraph');
    para.text = text;
    return para;
  }
  const tag = node.tagName.toLowerCase();
  if (tag === 'section' && node.classList.contains('sd-hero-block')) return heroFromNode(node);
  if (/^h[1-6]$/.test(tag)) {
    const heading = newBlock('heading');
    heading.text = inlineToMd(node);
    return heading;
  }
  if (tag === 'p') {
    const para = newBlock('paragraph');
    para.text = inlineToMd(node);
    return para.text ? para : null;
  }
  if (tag === 'ul' || tag === 'ol') return bulletsFromNode(node);
  if (node.classList.contains('sd-card-grid')) return cardsFromNode(node);
  if (node.classList.contains('sd-decision-grid')) {
    const block = newBlock('hero');
    block.kicker = '';
    block.cells = Array.prototype.map.call(node.children, function (cell) {
      return {
        label: cleanText(cell.querySelector('span') ? cell.querySelector('span').textContent : ''),
        value: cleanText(cell.querySelector('strong') ? cell.querySelector('strong').textContent : ''),
      };
    });
    return block;
  }
  if (node.classList.contains('sd-comparison')) return comparisonFromNode(node);
  if (node.classList.contains('sd-sequence')) return sequenceFromNode(node);
  if (node.classList.contains('sd-flow')) return flowFromNode(node);
  if (node.classList.contains('sd-risk-grid')) return risksFromNode(node);
  if (tag === 'table') return matrixFromNode(node);
  if (tag === 'section') {
    // Unwrap a generic section: convert its children individually.
    return Array.prototype.map.call(node.children, nodeToBlock).filter(Boolean);
  }
  const raw = newBlock('html');
  raw.html = node.outerHTML;
  return raw;
}

export function htmlToBlocks(html) {
  const source = String(html || '').trim();
  if (!source) return [];
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const blocks = [];
  Array.prototype.forEach.call(doc.body.children, function (node) {
    const result = nodeToBlock(node);
    if (!result) return;
    if (Array.isArray(result)) blocks.push.apply(blocks, result.filter(Boolean));
    else blocks.push(result);
  });
  return blocks;
}
