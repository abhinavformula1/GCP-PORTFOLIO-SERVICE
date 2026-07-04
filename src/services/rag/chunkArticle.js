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
 * Strategy: block-level chunking with short-block merging.
 *   • Each content block (heading, paragraph, list, callout) → one chunk.
 *   • Tables (matrix) and code blocks are NEVER split — losing a row or
 *     line would break the semantic unit.
 *   • Blocks shorter than MIN_CHARS are merged into the running buffer
 *     so we don't waste embeddings on stub chunks.
 *   • Each chunk carries articleId + chunkIndex as a "foreign key" back
 *     to its parent article — same role as a DB foreign key.
 */

const MIN_CHARS = 40; // discard/merge chunks shorter than this

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

  const rawChunks = [];
  let buffer      = '';
  let bufferType  = 'paragraph';

  for (const block of blocks) {
    const text = blockToText(block).trim();
    const type = String((block && block.type) || 'paragraph');

    if (!text) continue;

    // ── Structured blocks (table, code): always their own chunk ──────────
    const isStructured = type === 'matrix' || type === 'code';
    if (isStructured) {
      if (buffer.length >= MIN_CHARS) {
        rawChunks.push({ text: buffer.trim(), blockType: bufferType });
        buffer = '';
      }
      rawChunks.push({ text, blockType: type });
      continue;
    }

    // ── Headings: always start a new chunk ───────────────────────────────
    if (type === 'heading') {
      if (buffer.length >= MIN_CHARS) {
        rawChunks.push({ text: buffer.trim(), blockType: bufferType });
      }
      buffer     = text;
      bufferType = 'heading';
      continue;
    }

    // ── Short text blocks: merge into the running buffer ─────────────────
    // Prevents embedding a chunk like "See figure 2." in isolation — that
    // has near-zero information density by itself.
    if (text.length < MIN_CHARS) {
      buffer    += (buffer ? ' ' : '') + text;
      bufferType = bufferType === 'heading' ? 'paragraph' : bufferType;
      continue;
    }

    // ── Normal text block: flush buffer, begin new one ───────────────────
    if (buffer.length >= MIN_CHARS) {
      rawChunks.push({ text: buffer.trim(), blockType: bufferType });
    }
    buffer     = text;
    bufferType = type;
  }

  // Flush the final buffer.
  if (buffer.trim().length >= MIN_CHARS) {
    rawChunks.push({ text: buffer.trim(), blockType: bufferType });
  }

  return rawChunks.map((chunk, index) => ({
    articleId,
    articleTitle,
    chunkIndex: index,
    blockType:  chunk.blockType,
    text:       chunk.text,
  }));
}

module.exports = { chunkArticle, blockToText };
