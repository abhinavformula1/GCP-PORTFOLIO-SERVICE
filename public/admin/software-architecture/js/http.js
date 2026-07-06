/**
 * HTTP utilities — thin wrappers around fetch that inject the admin auth header.
 *
 * S — only concerned with HTTP communication.
 * D — depends on `state.credential`, never on any feature module.
 */

import { state } from './state.js';

export function authHeaders() {
  return {
    Authorization:  'Bearer ' + state.credential,
    'Content-Type': 'application/json',
  };
}

export async function authedJson(url, options) {
  const extraHeaders = (options && options.headers) || {};
  const resp = await fetch(url, Object.assign({}, options || {}, {
    headers: Object.assign({}, authHeaders(), extraHeaders),
  }));
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || data.success === false) {
    const err = new Error(data.error || data.message || 'Request failed.');
    err.status = resp.status;
    throw err;
  }
  return data;
}

/** Set/clear the global loading/error status bar above the workspace. */
export function setStatus(message, kind) {
  let status = document.getElementById('adminStatus');
  if (!message) {
    if (status) status.remove();
    return;
  }
  if (!status) {
    status = document.createElement('output');
    status.id = 'adminStatus';
    status.className = 'sd-admin-status';
    const workspace = document.getElementById('adminWorkspace');
    if (workspace) workspace.before(status);
  }
  const resolvedKind = kind || 'info';
  status.dataset.kind = resolvedKind;
  if (resolvedKind === 'info') {
    status.innerHTML = '';
    const loader = document.createElement('sd-loader');
    loader.setAttribute('size', 'sm');
    loader.setAttribute('label', message);
    status.appendChild(loader);
  } else {
    status.textContent = message;
  }
}

/** Set/clear the status line inside a section workspace. */
export function setSectionStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || '';
  if (message) el.dataset.kind = kind || 'info';
  else delete el.dataset.kind;
}

export function makeIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}
