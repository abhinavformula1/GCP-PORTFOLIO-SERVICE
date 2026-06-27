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

function imageToLiteHtml(b) {
  if (!b || !b.url) return '';
  const label = b.caption || b.alt || 'Image';
  return '<div class="sd-print-image-lite">' +
         '<strong>' + esc(label) + '</strong>' +
         '<span>' + esc(b.url) + '</span>' +
         '</div>';
}

function blockToHtml(block, opts) {
  if (!block || !block.type) return '';
  const options = opts || {};
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
    case 'image':      return options.mode === 'lite' ? imageToLiteHtml(block) : imageToHtml(block);
    case 'html':       return String(block.html || '');
    default:           return '';
  }
}

function blocksToHtml(blocks, opts) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(b => blockToHtml(b, opts)).filter(Boolean).join('');
}

// ── Document builder ──────────────────────────────────────────────────────────

/**
 * Build a self-contained, printable HTML document for an article.
 * Embeds full site CSS so Puppeteer page.setContent() renders correctly
 * with the exact same visual output as the live site.
 */
function buildPrintDocument(article, opts) {
  const options = opts || {};
  const loc = (article && article.en) ? article.en : (article || {});
  const title  = loc.title || article.title || article.id || 'Design Note';
  const sub    = loc.subtitle || article.subtitle || article.description || '';
  const tags   = Array.isArray(article.tags) ? article.tags : [];
  const mins   = article.readMinutes ? String(article.readMinutes) + ' min read' : '';
  const contentType = String(article.contentType || '').trim().toLowerCase();
  const typeLabel = contentType === 'architecture'
    ? 'Architecture Note'
    : (contentType === 'case-study' ? 'Case Study' : 'System Design');
  const date   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const bodyHtml = blocksToHtml(article.blocks || [], options);

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

.sd-print-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.sd-print-meta {
  font-size: 9.5pt;
  color: rgba(17, 17, 17, 0.72);
  letter-spacing: 0.01em;
}

.sd-print-meta strong {
  color: #111;
  font-weight: 700;
}

.sd-print-sep {
  margin: 0 6px;
  color: rgba(17, 17, 17, 0.42);
}

.sd-article-header {
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(17, 17, 17, 0.14);
}

.sd-article-title {
  margin-top: 6px;
}

.sd-article-sub {
  margin-top: 6px;
  color: rgba(17, 17, 17, 0.72);
}

.sd-article-meta {
  margin-top: 10px;
  gap: 8px;
}

.sd-article-meta .sd-tag {
  border: 1px solid rgba(17, 17, 17, 0.16);
  background: rgba(17, 17, 17, 0.04);
  color: rgba(17, 17, 17, 0.86);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 9pt;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

.sd-article-meta .sd-read-time {
  color: rgba(17, 17, 17, 0.64);
  font-size: 9pt;
  font-weight: 600;
}

.sd-print-image-lite {
  border: 1px solid rgba(0,0,0,0.12);
  border-radius: 10px;
  padding: 10px 12px;
  margin: 10px 0 14px;
  background: #fafafa;
  page-break-inside: avoid;
}
.sd-print-image-lite strong { display: block; font-size: 9.5pt; margin-bottom: 4px; }
.sd-print-image-lite span { display: block; font-size: 8.5pt; color: #333; word-break: break-all; }
</style>
</head>
<body>
<div class="sd-print-header">
  <div class="sd-print-meta">
    <strong>Abhinav Kumar</strong>
    <span class="sd-print-sep">·</span>
    <span>${esc(typeLabel)}</span>
    <span class="sd-print-sep">·</span>
    <span>${esc(date)}</span>
  </div>
</div>

<article class="sd-article">
  <header class="sd-article-header">
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
