/**
 * Small DOM widgets shared between chat.js (guided 7-step flow) and
 * atlas.js (free-form Q&A). Extracted so we don't have two copies of
 * the same input + paper-plane-button construction lying around — the
 * SVG path and the keyboard wiring are now in one place.
 *
 * Public surface:
 *   - createInputRow(opts) → { row, input, button }
 *
 * Each consumer can attach extra classes / IDs to the returned elements
 * (atlas needs `gaAtlasInput`/`gaAtlasSendBtn`; the guided flow doesn't
 * need IDs at all). This avoids a "kitchen-sink options bag" while still
 * deduplicating the boilerplate.
 */

const SEND_ICON_SVG =
  '<svg class="ga-send-svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
  '<path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a.993.993 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z"/>' +
  '</svg>';

/**
 * Build a `[ <text input> | <send button> ]` row with the standard
 * paper-plane icon. Returns the row element plus references to its
 * input and button so callers can wire up handlers / set IDs.
 *
 * @param {object}  opts
 * @param {string}  opts.placeholder
 * @param {number}  [opts.maxLength]
 * @param {string}  [opts.rowClass='ga-input-row']
 * @param {string}  [opts.inputClass='ga-text-input']
 * @param {string}  [opts.buttonClass='ga-send-btn ga-send-icon-btn']
 * @param {string}  [opts.buttonAriaLabel='Send']
 * @param {string}  [opts.buttonTitle='Send']
 * @param {function(string): void} opts.onSubmit  fired on Enter or click;
 *   receives the raw input value (caller decides whether to trim/validate).
 *
 * @returns {{ row: HTMLDivElement, input: HTMLInputElement, button: HTMLButtonElement }}
 */
export function createInputRow(opts) {
  const o = opts || {};

  const row = document.createElement('div');
  row.className = o.rowClass || 'ga-input-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = o.inputClass || 'ga-text-input';
  input.placeholder = o.placeholder || '';
  if (typeof o.maxLength === 'number') input.maxLength = o.maxLength;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = o.buttonClass || 'ga-send-btn ga-send-icon-btn';
  button.setAttribute('aria-label', o.buttonAriaLabel || 'Send');
  button.title = o.buttonTitle || 'Send';
  button.innerHTML = SEND_ICON_SVG;

  function fire() {
    if (typeof o.onSubmit === 'function') o.onSubmit(input.value);
  }
  button.onclick = fire;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      fire();
    }
  });

  row.appendChild(input);
  row.appendChild(button);

  return { row, input, button };
}
