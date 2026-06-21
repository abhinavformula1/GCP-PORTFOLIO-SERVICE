'use strict';

/**
 * Server-side article HTML renderer for PDF generation.
 *
 * Mirrors the rendering logic in public/assets/ui/sdblocks.js (which is ESM
 * and cannot be require()'d from Node.js CommonJS).  Produces identical CSS
 * class names so the @media print stylesheet in public/assets/style.css
 * applies exactly as on the live page.
 */

const fs   = require('fs');
const path = require('path');

const STYLE_PATH = path.join(__dirname, '../../public/assets/style.css');
const FULL_CSS   = fs.existsSync(STYLE_PATH) ? fs.readFileSync(STYLE_PATH, 'utf8') : '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(value) {
  let t = esc(value);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/(^|[\s([{])_([^_]+)_(?=$|[\s)\]},.:!?])/g, '$1<em>$2</em>');
  return t;
}

// ── Block renderers — exact mirror of sdblocks.js ────────────────────────────

function heroToHtml(b) {
  let h = '<section class="sd-hero-block">';
  if (b.kicker)  h += '<div class="sd-kicker">' + esc(b.kicker) + '</div>';
  if (b.heading) h += '<h3>' + inlineMd(b.heading) + '</h3>';
  if (b.text)    h += '<p>'  + inlineMd(b.text)    + '</p>';
  const cells = Array.isArray(b.cells) ? b.cells.filter(c => c && (c.label || c.value)) : [];
  if (cells.length) {
    h += '<div class="sd-decision-grid">';
    cells.forEach(c => {
      h += '<div><span>' + esc(c.label) + '</span><strong>' + esc(c.value) + '</strong></div>';
    });
    h += '</div>';
  }
  h += '</section>';
  return h;
}

function cardsToHtml(b) {
  const items = Array.isArray(b.items) ? b.items.filter(i => i && (i.title || i.text)) : [];
  if (!items.length) return '';
  return '<div class="sd-card-grid">'
    + items.map(item =>
        '<div class="sd-info-card"><strong>' + inlineMd(item.title) +
        '</strong><span>' + inlineMd(item.text) + '</span></div>'
      ).join('')
    + '</div>';
}

function comparisonToHtml(b) {
  const rows = Array.isArray(b.rows) ? b.rows.filter(r => r && (r.title || r.text)) : [];
  if (!rows.length) return '';
  return '<div class="sd-comparison">'
    + rows.map(row =>
        '<div class="sd-comparison-row' + (row.selected ? ' sd-selected' : '') + '">' +
        '<strong>' + esc(row.title) + '</strong>' +
        (row.status ? '<span>' + esc(row.status) + '</span>' : '') +
        (row.text   ? '<p>' + inlineMd(row.text) + '</p>' : '') +
        '</div>'
      ).join('')
    + '</div>';
}

function sequenceToHtml(b) {
  const steps = Array.isArray(b.steps) ? b.steps.filter(Boolean) : [];
  if (!steps.length) return '';
  return '<div class="sd-sequence">'
    + steps.map((step, i) =>
        '<div><b>' + (i + 1) + '</b><span>' + inlineMd(step) + '</span></div>'
      ).join('')
    + '</div>';
}

function matrixRowCells(row) {
  if (Array.isArray(row)) return row.map(c => String(c == null ? '' : c));
  if (row && typeof row === 'object') {
    if (Array.isArray(row.cells)) return row.cells.map(c => String(c == null ? '' : c));
    return [String(row.key || ''), String(row.value || '')];
  }
  return [];
}

function matrixToHtml(b) {
  const rows = Array.isArray(b.rows) ? b.rows.filter(r => r != null) : [];
  if (!rows.length) return '';
  let h = '<div class="sd-matrix-wrap"><table class="sd-matrix"><tbody>';
  rows.forEach(row => {
    const cells = matrixRowCells(row);
    if (!cells.length) return;
    h += '<tr><th>' + esc(cells[0]) + '</th>';
    cells.slice(1).forEach(c => { h += '<td>' + inlineMd(c) + '</td>'; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function risksToHtml(b) {
  const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
  const items = Array.isArray(b.items) ? b.items.filter(i => i && (i.title || i.text)) : [];
  if (!items.length) return '';
  return '<div class="sd-risk-grid">'
    + items.map(item => {
        const level = RISK_LEVELS.includes(item.level) ? item.level : 'medium';
        return '<div class="sd-risk ' + level + '">' +
               '<strong>' + esc(item.title) + '</strong>' +
               '<span>' + inlineMd(item.text) + '</span>' +
               '</div>';
      }).join('')
    + '</div>';
}

function codeToHtml(b) {
  const lang = b.lang || 'plaintext';
  const code = b.code || '';
  if (!code.trim()) return '';
  return '<pre class="sd-code-block" data-lang="' + esc(lang) + '"><code>' + esc(code) + '</code></pre>';
}

function imageToHtml(b) {
  if (!b.url) return '';
  let h = '<figure class="sd-image-block">';
  h += '<img src="' + esc(b.url) + '" alt="' + esc(b.alt || '') + '" loading="eager"';
  if (b.width)  h += ' width="'  + Number(b.width)  + '"';
  if (b.height) h += ' height="' + Number(b.height) + '"';
  h += '>';
  if (b.caption) h += '<figcaption>' + esc(b.caption) + '</figcaption>';
  h += '</figure>';
  return h;
}

function blockToHtml(block) {
  if (!block || !block.type) return '';
  switch (block.type) {
    case 'heading':   return block.text ? '<h3>' + inlineMd(block.text) + '</h3>' : '';
    case 'paragraph': return block.text ? '<p>'  + inlineMd(block.text) + '</p>'  : '';
    case 'bullets': {
      const items = Array.isArray(block.items) ? block.items.filter(Boolean) : [];
      return items.length ? '<ul>' + items.map(i => '<li>' + inlineMd(i) + '</li>').join('') + '</ul>' : '';
    }
    case 'hero':       return heroToHtml(block);
    case 'cards':      return cardsToHtml(block);
    case 'flow': {
      const steps = Array.isArray(block.steps) ? block.steps.filter(Boolean) : [];
      return steps.length
        ? '<div class="sd-flow">' + steps.map(s => '<span>' + esc(s) + '</span>').join('') + '</div>'
        : '';
    }
    case 'comparison': return comparisonToHtml(block);
    case 'sequence':   return sequenceToHtml(block);
    case 'matrix':     return matrixToHtml(block);
    case 'risks':      return risksToHtml(block);
    case 'code':       return codeToHtml(block);
    case 'image':      return imageToHtml(block);
    case 'html':       return String(block.html || '');
    default:           return '';
  }
}

function blocksToHtml(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(blockToHtml).filter(Boolean).join('');
}

// ── Document builder ──────────────────────────────────────────────────────────

/**
 * Build a self-contained, printable HTML document for an article.
 * Embeds full site CSS so Puppeteer page.setContent() renders correctly
 * with the exact same visual output as the live site.
 */
function buildPrintDocument(article) {
  const title  = article.title   || article.id || 'Design Note';
  const sub    = article.subtitle || article.description || '';
  const tags   = Array.isArray(article.tags) ? article.tags : [];
  const mins   = article.readMinutes ? String(article.readMinutes) + ' min read' : '';
  const date   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const bodyHtml = blocksToHtml(article.blocks || []);

  const tagsHtml = tags.map(t =>
    '<span class="sd-tag">' + esc(t) + '</span>'
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
/* ── Full site CSS (includes @media print rules) ── */
${FULL_CSS}

/* ── Page-level resets for the PDF viewport ── */
body {
  background: #fff;
  margin: 0;
  padding: 24px 32px;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 10.5pt;
  color: #111;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
</style>
</head>
<body>
<div class="sd-print-header">
  <span class="sd-print-logo">Abhinav Kumar &mdash; System Design</span>
  <span class="sd-print-date">${esc(date)}</span>
</div>

<article class="sd-article">
  <header class="sd-article-header">
    <div class="sd-kicker">DESIGN NOTE</div>
    <h1 class="sd-article-title">${esc(title)}</h1>
    ${sub ? `<p class="sd-article-sub">${esc(sub)}</p>` : ''}
    <div class="sd-article-meta">
      ${tagsHtml}
      ${mins ? `<span class="sd-read-time">${esc(mins)}</span>` : ''}
    </div>
  </header>

  <div class="sd-article-body">
    ${bodyHtml}
  </div>
</article>
</body>
</html>`;
}

module.exports = { buildPrintDocument };
