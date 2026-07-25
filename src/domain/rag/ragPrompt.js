'use strict';

/**
 * RAG prompt builder.
 *
 * SOLID:
 *   S — One job: merge retrieved chunks into an augmented system prompt.
 *       Pure function — zero I/O, zero side effects.  Fully unit-testable.
 *   O — Change the template by editing this file; the orchestrator and all
 *       callers remain untouched (open for extension, closed for modification).
 *
 * Design note:
 *   Retrieved chunks are prepended *before* the persona instructions so
 *   Gemini treats them as the highest-priority grounding context.
 *   The persona (SYSTEM_PROMPT from persona.js) follows after, ensuring
 *   Atlas's tone and identity are still applied.
 *
 *   If no chunks were found (e.g. RAG cold-start or a question outside the
 *   knowledge base), the function returns the base prompt unchanged so the
 *   fallback static-context behaviour is preserved transparently.
 */

/**
 * Build an augmented system prompt by prepending retrieved article chunks.
 *
 * @param {Array<{
 *   articleTitle: string,
 *   blockType:    string,
 *   text:         string,
 * }>} chunks  Top-K chunks returned by findNearestChunks.
 *
 * @param {string} baseSystemPrompt  The unmodified Atlas persona prompt.
 *
 * @returns {string}  Augmented prompt (or baseSystemPrompt unchanged if no chunks).
 */
function buildRagSystemPrompt(chunks, baseSystemPrompt) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return baseSystemPrompt;
  }

  const knowledgeBlock = chunks
    .map((c, i) =>
      `[${i + 1}] Source: "${c.articleTitle}" (${c.blockType})\n${c.text}`
    )
    .join('\n\n');

  return [
    'The following excerpts are retrieved from Abhinav\'s published articles.',
    'Use them as your primary grounding when answering. Cite the article title',
    'when you draw on these excerpts. If the question is unrelated to these',
    'excerpts, fall back to your persona knowledge.',
    '',
    '=== RETRIEVED KNOWLEDGE ===',
    knowledgeBlock,
    '=== END OF RETRIEVED KNOWLEDGE ===',
    '',
    baseSystemPrompt,
  ].join('\n');
}

module.exports = { buildRagSystemPrompt };
