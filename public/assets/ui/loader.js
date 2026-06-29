/**
 * <sd-loader> — reusable loading indicator backed by M3 components.
 *
 * Spinner and linear variants delegate to md-circular-progress /
 * md-linear-progress from @material/web — same animation engine, tokens,
 * and accessibility as the rest of the M3 component library.
 *
 * Usage (HTML):
 *   <sd-loader></sd-loader>
 *   <sd-loader label="Fetching articles…"></sd-loader>
 *   <sd-loader size="lg" label="Loading…"></sd-loader>
 *   <sd-loader variant="dots"></sd-loader>
 *   <sd-loader variant="linear"></sd-loader>
 *   <sd-loader overlay label="Saving…"></sd-loader>
 *
 * Usage (JS): import this module once so <sd-loader> is registered.
 *
 * Attributes:
 *   label   — visible text beside the indicator (optional)
 *   size    — 'sm' | 'md' (default) | 'lg'
 *   variant — 'spinner' (default) | 'dots' | 'linear'
 *   overlay — boolean, covers the parent with a translucent backdrop
 */

/* Size maps ─────────────────────────────────────────────────── */
const SPINNER_SIZE   = { sm: '16px', md: '20px', lg: '28px' };
const SPINNER_STROKE = { sm: '14',   md: '10',   lg: '10'   };
const LINEAR_HEIGHT  = { sm: '2px',  md: '3px',  lg: '4px'  };
const LABEL_SIZE     = { sm: '12px', md: '13px', lg: '15px' };

const STYLE = `
  :host {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary, #6b6b6b);
    line-height: 1;
  }

  :host([overlay]) {
    position: absolute;
    inset: 0;
    justify-content: center;
    background: color-mix(in srgb, var(--surface, #fff) 72%, transparent);
    backdrop-filter: blur(2px);
    border-radius: inherit;
    z-index: 10;
  }

  /* ── M3 circular progress sizing ─────────── */
  md-circular-progress {
    flex-shrink: 0;
    --md-circular-progress-color: var(--accent, var(--md-sys-color-primary, #6750a4));
  }

  /* ── M3 linear progress ───────────────────── */
  md-linear-progress {
    width: 100%;
    --md-linear-progress-track-color: color-mix(
      in srgb, var(--accent, var(--md-sys-color-primary, #6750a4)) 20%, transparent
    );
    --md-linear-progress-active-indicator-color: var(--accent, var(--md-sys-color-primary, #6750a4));
  }

  /* ── Dots (no M3 equivalent) ─────────────── */
  .dots {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .dots span {
    border-radius: 50%;
    background: var(--accent, var(--md-sys-color-primary, #6750a4));
    animation: bounce 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(1) { animation-delay: 0s; }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes bounce {
    0%, 80%, 100% { transform: scaleY(0.5); opacity: 0.4; }
    40%           { transform: scaleY(1.0); opacity: 1;   }
  }

  /* ── Label ───────────────────────────────── */
  .label {
    color: inherit;
    white-space: nowrap;
  }
`;

class SdLoader extends HTMLElement {
  static get observedAttributes() {
    return ['label', 'size', 'variant', 'overlay'];
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { if (this.isConnected) this._render(); }

  _render() {
    const variant = this.getAttribute('variant') || 'spinner';
    const size    = this.getAttribute('size')    || 'md';
    const label   = this.getAttribute('label')   || '';

    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

    const dotSize = size === 'sm' ? '4px' : size === 'lg' ? '9px' : '6px';

    const indicatorHtml = variant === 'linear'
      ? `<md-linear-progress
           indeterminate
           aria-hidden="true"
           style="--md-linear-progress-track-height:${LINEAR_HEIGHT[size]};
                  --md-linear-progress-active-indicator-height:${LINEAR_HEIGHT[size]};">
         </md-linear-progress>`
      : variant === 'dots'
        ? `<div class="dots" aria-hidden="true">
             <span style="width:${dotSize};height:${dotSize}"></span>
             <span style="width:${dotSize};height:${dotSize}"></span>
             <span style="width:${dotSize};height:${dotSize}"></span>
           </div>`
        : `<md-circular-progress
             indeterminate
             aria-hidden="true"
             style="--md-circular-progress-size:${SPINNER_SIZE[size]};
                    --md-circular-progress-active-indicator-width:${SPINNER_STROKE[size]};">
           </md-circular-progress>`;

    this.shadowRoot.innerHTML = `
      <style>${STYLE}</style>
      <style>
        .label { font-size: ${LABEL_SIZE[size]}; }
      </style>
      ${indicatorHtml}
      ${label ? `<span class="label">${label}</span>` : ''}
    `;

    this.setAttribute('role', 'status');
    this.setAttribute('aria-label', label || 'Loading');
    this.setAttribute('aria-live', 'polite');
  }
}

if (!customElements.get('sd-loader')) {
  customElements.define('sd-loader', SdLoader);
}
