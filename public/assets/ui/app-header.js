/**
 * App Header — small composer for topbar + (optional) public header nav.
 *
 * Why this exists:
 * - Keep `topbar.js` focused on auth/preferences controls (shared across pages).
 * - Keep `header-nav.js` focused on public site navigation (home/docs/resume/cta).
 * - Provide ONE reusable entrypoint to assemble a page header without
 *   duplicating orchestration in each page module.
 */

import { renderTopbar } from './topbar.js';
import { renderHeaderNavIntoTopbar } from './header-nav.js';

/**
 * @param {string|HTMLElement} mount
 * @param {{
 *   mode?: 'public'|'admin',
 *   topbar?: any,
 *   nav?: any,
 * }} opts
 */
export function renderAppHeader(mount, opts) {
  const options = opts || {};
  const mode = options.mode === 'admin' ? 'admin' : 'public';

  renderTopbar(mount, options.topbar || {});

  if (mode === 'public') {
    // Mount public navigation into the topbar shell.
    renderHeaderNavIntoTopbar(options.nav || {});
  }
}

