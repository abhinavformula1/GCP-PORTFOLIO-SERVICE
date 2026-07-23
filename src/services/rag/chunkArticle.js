'use strict';

/**
 * Article chunker.
 *
 * SOLID:
 *   S — One job: convert article blocks into embedding-ready text chunks.
 *       Pure function — zero I/O, zero side effects.  Can be unit-tested
 *       without a running server, Firestore, or Gemini API key.
 *   O — New block types: add a case in blockToText() and the loop below.
 *       Callers (ragStore, orchestrator) never need to change.
 *
 * Strategy: streaming chunk buffer with size + overlap controls.
 *   • Maintains original block order (headings, paragraphs, lists, etc.)
 *   • Tables (matrix) and code blocks are NEVER split — losing a row/line
 *     breaks the semantic unit.
 *   • A rolling buffer is cut into chunks at ~chunkSize chars, with
 *     chunkOverlap chars repeated into the next chunk for continuity.
 *   • Splitter type influences preferred cut boundaries.
 */

const MIN_CHARS = 40; // discard/merge chunks shorter than this
const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_CHUNK_OVERLAP = 200;

function clampInt(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const i = Math.trunc(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function pickCutIndex(text, limit, splitterType) {
  const s = String(text || '');
  const L = Math.max(1, Math.min(Number(limit) || 1, s.length));
  if (s.length <= L) return s.length;

  const before = s.slice(0, L);

  // Prefer "hard" boundaries first.
  const hard = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', '];
  for (const sep of hard) {
    const idx = before.lastIndexOf(sep);
    if (idx > MIN_CHARS) return idx + sep.length;
  }

  // Markdown splitter: try not to cut right before a heading marker.
  if (String(splitterType || '').toLowerCase() === 'markdown') {
    const idx = before.lastIndexOf('\n#');
    if (idx > MIN_CHARS) return idx;
  }

  // Fallback: cut at last whitespace, else at the limit.
  const ws = before.lastIndexOf(' ');
  if (ws > MIN_CHARS) return ws;
  return L;
}

/**
 * Extract searchable plain text from a single Firestore article block.
 * The output is what gets embedded — structure is flattened to prose/CSV.
 *
 * @param {object} block  Normalised article block (type, text, items, rows, …)
 * @returns {string}
 */
function blockToText(block) {
  if (!block || typeof block !== 'object') return '';
  const type = String(block.type || 'paragraph');

  if (type === 'matrix' && Array.isArray(block.rows)) {
    // Tables: convert to "header: cell" pairs so each cell is grounded
    // in its column name. This preserves "row 14, column 3" semantics.
    const rows   = block.rows;
    const header = Array.isArray(rows[0] && rows[0].cells) ? rows[0].cells : [];
    return rows.slice(1)
      .map((row) =>
        (row.cells || []).map((cell, i) => `${header[i] || `col${i}`}: ${cell}`).join(', ')
      )
      .join('\n');
  }

  if (type === 'code') {
    // Code blocks: prepend the language so "Python snippet" is searchable.
    return `Code (${block.language || 'unknown'}):\n${String(block.code || '')}`;
  }

  if (type === 'list' && Array.isArray(block.items)) {
    return block.items.map((item) => `• ${String(item || '')}`).join('\n');
  }

  // heading, paragraph, callout, quote, divider — all carry a `text` field.
  return String(block.text || block.label || '').trim();
}

/**
 * Split one article into ordered, embedding-ready chunks.
 *
 * @param {{
 *   id:     string,
 *   en:     { title: string },
 *   blocks: object[],
 * }} article
 *
 * @returns {Array<{
 *   articleId:    string,
 *   articleTitle: string,
 *   chunkIndex:   number,
 *   blockType:    string,
 *   text:         string,
 * }>}
 */
function chunkArticle(article) {
  if (!article || typeof article !== 'object') return [];

  const articleId    = String(article.id    || '');
  const articleTitle = String((article.en && article.en.title) || article.id || '');
  const blocks       = Array.isArray(article.blocks) ? article.blocks : [];

  const opts = arguments.length > 1 ? arguments[1] : null;
  const chunkSize = clampInt(opts && opts.chunkSize != null ? opts.chunkSize : DEFAULT_CHUNK_SIZE, 500, 8000) || DEFAULT_CHUNK_SIZE;
  const chunkOverlapRaw = clampInt(opts && opts.chunkOverlap != null ? opts.chunkOverlap : DEFAULT_CHUNK_OVERLAP, 0, 1000) || 0;
  const chunkOverlap = Math.max(0, Math.min(chunkOverlapRaw, chunkSize - 1));
  const splitterType = String(opts && opts.splitterType ? opts.splitterType : 'recursive').trim().toLowerCase();

  const rawChunks = [];
  let buffer = '';
  let bufferType = 'paragraph';

  function emitBufferChunk(text, type) {
    const t = String(text || '').trim();
    if (t.length < MIN_CHARS) return;
    rawChunks.push({ text: t, blockType: type || 'paragraph' });
  }

  function flushBuffer() {
    emitBufferChunk(buffer, bufferType);
    buffer = '';
    bufferType = 'paragraph';
  }

  function cutBufferIfNeeded() {
    while (buffer.length > chunkSize) {
      const cut = pickCutIndex(buffer, chunkSize, splitterType);
      const head = buffer.slice(0, cut);
      emitBufferChunk(head, bufferType);
      const keepFrom = Math.max(0, cut - chunkOverlap);
      buffer = buffer.slice(keepFrom).trimStart();
      // After a cut, treat buffer as paragraph-like even if it started with a heading.
      if (bufferType === 'heading') bufferType = 'paragraph';
    }
  }

  for (const block of blocks) {
    const text = blockToText(block).trim();
    const type = String((block && block.type) || 'paragraph');

    if (!text) continue;

    const isStructured = type === 'matrix' || type === 'code';
    if (isStructured) {
      flushBuffer();
      // Never split structured blocks; keep as a dedicated chunk.
      emitBufferChunk(text, type);
      continue;
    }

    if (type === 'heading') {
      flushBuffer();
      const headingText = splitterType === 'markdown' ? `# ${text}` : text;
      buffer = headingText;
      bufferType = 'heading';
      cutBufferIfNeeded();
      continue;
    }

    // Normal text blocks: append into the rolling buffer.
    buffer += (buffer ? '\n\n' : '') + text;
    bufferType = bufferType || type;
    cutBufferIfNeeded();
  }

  flushBuffer();

  return rawChunks.map((chunk, index) => ({
    articleId,
    articleTitle,
    chunkIndex: index,
    blockType:  chunk.blockType,
    text:       chunk.text,
  }));
}

module.exports = { chunkArticle, blockToText };
