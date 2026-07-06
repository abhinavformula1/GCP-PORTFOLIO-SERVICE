/**
 * Reusable modal dialog — thin wrapper around <md-dialog> (Material Web).
 *
 * Eliminates the boilerplate that every dialog module used to duplicate:
 *   • waiting for the custom element to upgrade (CDN loads async)
 *   • open / close API with MWC fallback
 *   • headline / content / actions slot wiring
 *   • optional × close button in the headline
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   import { createModal } from './modal.js';
 *
 *   const modal = createModal({
 *     id:        'myModal',
 *     title:     'Choose something',
 *     content:   myContentEl,          // Element or HTML string
 *     actions:   [cancelBtn, okBtn],   // Elements appended to actions slot
 *     width:     '480px',              // optional max-width
 *     onClose:   () => { cleanup(); },
 *   });
 *
 *   document.body.appendChild(modal.el);
 *   modal.open();   // show
 *   modal.close();  // hide
 *
 * ─── Contract ─────────────────────────────────────────────────────────────────
 *   Returns { el, open(), close() }.
 *   `el` is the raw <md-dialog> element — caller appends it wherever needed.
 *   open/close are safe to call before the custom element upgrades.
 */

import { createEl } from './dom.js';

/** @param {Function} cb */
function whenMdDialogReady(cb) {
  if (customElements.get('md-dialog')) { cb(); return; }
  customElements.whenDefined('md-dialog').then(cb);
}

/**
 * @typedef {Object} ModalOptions
 * @property {string=}              id         id on the <md-dialog>
 * @property {string=}              className  extra CSS class(es)
 * @property {string=}              icon       material symbol name shown as a circle icon in the headline
 * @property {string=}              title      primary title text in the headline
 * @property {string=}              subtitle   secondary line shown below the title
 * @property {Element|string=}      content    element or HTML string for the content slot
 * @property {Element[]=}           actions    elements appended to the actions slot
 * @property {string=}              width      e.g. '520px' — applied as --sd-modal-width
 * @property {boolean=}             showClose  show × button in headline (default: true)
 * @property {Function=}            onClose    called whenever the dialog fires 'close'
 */

/**
 * @param {ModalOptions} opts
 * @returns {{ el: HTMLElement, open: () => void, close: () => void }}
 */
export function createModal(opts) {
  opts = opts || {};

  // ── Headline ─────────────────────────────────────────────────────────────
  // Layout: [icon?] [title + subtitle] [×?]
  const headlineChildren = [];

  if (opts.icon) {
    headlineChildren.push(
      createEl('div', { className: 'sd-modal-icon-wrap', 'aria-hidden': 'true' }, [
        createEl('span', { className: 'material-symbols-outlined sd-modal-icon', text: opts.icon }),
      ])
    );
  }

  const textChildren = [];
  if (opts.title) {
    textChildren.push(createEl('span', { className: 'sd-modal-title', text: opts.title }));
  }
  if (opts.subtitle) {
    textChildren.push(createEl('span', { className: 'sd-modal-subtitle', text: opts.subtitle }));
  }
  if (textChildren.length) {
    headlineChildren.push(createEl('div', { className: 'sd-modal-title-group' }, textChildren));
  }

  if (opts.showClose !== false) {
    headlineChildren.push(
      createEl('button', {
        type: 'button',
        className: 'sd-modal-close-btn',
        'aria-label': 'Close dialog',
      }, [createEl('span', { className: 'material-symbols-outlined', 'aria-hidden': 'true', text: 'close' })])
    );
  }
  const headline = createEl('div', { slot: 'headline', className: 'sd-modal-headline' }, headlineChildren);

  // ── Content ───────────────────────────────────────────────────────────────
  const contentWrap = createEl('div', { slot: 'content', className: 'sd-modal-content' });
  if (opts.content) {
    if (typeof opts.content === 'string') {
      contentWrap.innerHTML = opts.content;
    } else {
      contentWrap.appendChild(opts.content);
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const actionsArr = Array.isArray(opts.actions) ? opts.actions.filter(Boolean) : [];
  const actionsSlot = actionsArr.length
    ? createEl('div', { slot: 'actions', className: 'sd-modal-actions' }, actionsArr)
    : null;

  // ── Dialog element ────────────────────────────────────────────────────────
  const classes = ['sd-modal', opts.className].filter(Boolean).join(' ');
  const dlgAttrs = { className: classes };
  if (opts.id)    dlgAttrs.id    = opts.id;
  if (opts.width) dlgAttrs.style = `--sd-modal-width: ${opts.width}`;

  const dlg = createEl(
    'md-dialog',
    dlgAttrs,
    [headline, contentWrap, actionsSlot].filter(Boolean)
  );

  // ── Event wiring ──────────────────────────────────────────────────────────
  const closeBtn = dlg.querySelector('.sd-modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', function () { api.close(); });
  if (typeof opts.onClose === 'function') dlg.addEventListener('close', opts.onClose);

  // ── Public API ────────────────────────────────────────────────────────────
  const api = {
    /** The raw <md-dialog> element. Append to DOM before calling open(). */
    el: dlg,

    /** Opens the dialog. Safe to call before MWC upgrades. */
    open: function () {
      whenMdDialogReady(function () {
        if (typeof dlg.show === 'function') dlg.show();
        else dlg.removeAttribute('hidden');
      });
    },

    /** Closes the dialog. */
    close: function () {
      if (typeof dlg.close === 'function') dlg.close();
      else dlg.setAttribute('hidden', '');
    },

    /**
     * Replace or set the content slot's inner element.
     * Useful when the same modal instance is reused with different content.
     * @param {Element|string} newContent
     */
    setContent: function (newContent) {
      contentWrap.innerHTML = '';
      if (typeof newContent === 'string') {
        contentWrap.innerHTML = newContent;
      } else if (newContent) {
        contentWrap.appendChild(newContent);
      }
    },

    /**
     * Update the headline title text.
     * @param {string} newTitle
     */
    setTitle: function (newTitle) {
      const titleEl = dlg.querySelector('.sd-modal-title');
      if (titleEl) titleEl.textContent = newTitle;
    },

    /**
     * Update the headline subtitle text.
     * @param {string} newSubtitle
     */
    setSubtitle: function (newSubtitle) {
      const el = dlg.querySelector('.sd-modal-subtitle');
      if (el) el.textContent = newSubtitle;
    },
  };

  return api;
}
