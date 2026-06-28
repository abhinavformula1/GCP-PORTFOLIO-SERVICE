/**
 * Tech footer component.
 *
 * Renders the "Built with Google Cloud + Salesforce" footer into a target
 * element.
 *
 * Used by: portfolio page (main.js).
 */

import { createEl } from './dom.js';

export function renderTechFooter(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;
  const opts = options || {};
  const footer = createEl('footer', { className: opts.className || 'sponsors-footer' }, [
    createEl('div', { className: 'sponsors-inner' }, [
      createEl('span', {
        className: 'sponsors-label',
        'data-i18n': opts.i18n !== false ? 'footerBuiltWith' : null,
        text: 'Built with',
      }),
      createEl('div', { className: 'sponsors-logos' }, [
        createEl('a', {
          href: 'https://cloud.google.com',
          target: '_blank',
          rel: 'noopener',
          className: 'sponsor-link sponsor-link-gcp',
          'aria-label': 'Google Cloud',
        }, [
          createEl('img', {
            className: 'sponsor-logo',
            src: '/assets/img/google-cloud.svg',
            alt: 'Google Cloud',
            width: '155',
            height: '24',
          }),
        ]),
        createEl('span', { className: 'sponsor-divider' }),
        createEl('a', {
          href: 'https://www.salesforce.com',
          target: '_blank',
          rel: 'noopener',
          className: 'sponsor-link sponsor-link-sf',
          'aria-label': 'Salesforce',
        }, [
          createEl('img', {
            className: 'sponsor-logo',
            src: '/assets/img/salesforce.svg',
            alt: 'Salesforce',
            width: '50',
            height: '36',
          }),
        ]),
        createEl('span', { className: 'sponsor-divider' }),
        createEl('a', {
          href: 'https://stripe.com',
          target: '_blank',
          rel: 'noopener',
          className: 'sponsor-link sponsor-link-stripe',
          'aria-label': 'Stripe',
        }, [
          createEl('img', {
            className: 'sponsor-logo',
            src: '/assets/img/stripe.svg',
            alt: 'Stripe',
            width: '112',
            height: '34',
          }),
        ]),
      ]),
    ]),
    createEl('p', {
      className: 'sponsors-disclaimer',
      'data-i18n': opts.i18n !== false ? 'footerTrademarkNote' : null,
      text: 'Trademarks are property of their respective owners. This is a personal portfolio; no endorsement or sponsorship is implied.',
    }),
  ]);

  root.replaceChildren(footer);
}
