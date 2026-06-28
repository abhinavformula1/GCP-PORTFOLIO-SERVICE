/**
 * showToast — a lightweight, accessible toast notification.
 *
 * Usage:
 *   showToast('Something went wrong.', { kind: 'error' });
 *   showToast('Saved successfully.', { kind: 'success', duration: 4000 });
 *
 * Kinds: 'info' (default) | 'success' | 'error' | 'warning'
 * The toast is appended to <body>, stacks above all content, auto-dismisses,
 * and has a close button. Only one stack anchor is created per page.
 */

let stack = null;
let _stackListenersBound = false;
let _lastToastKey = '';
let _lastToastAt = 0;

function computeTopOffsetPx() {
  try {
    const topbar = document.querySelector('.topbar-with-header-nav') || document.querySelector('.topbar');
    if (!topbar) return 16;
    const rect = topbar.getBoundingClientRect();
    const bottom = rect.bottom;
    // If the topbar is visible at the top, pin to just below it.
    if (bottom > 0 && bottom < 220) return Math.round(bottom + 12);
    return 16;
  } catch (_) {
    return 16;
  }
}

function getStack() {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-atomic', 'false');
  document.body.appendChild(stack);

  // Keep toasts out of the topbar/header area.
  function updateTop() {
    if (!stack || !stack.isConnected) return;
    stack.style.top = computeTopOffsetPx() + 'px';
  }
  updateTop();
  if (!_stackListenersBound) {
    _stackListenersBound = true;
    window.addEventListener('scroll', updateTop, { passive: true });
    window.addEventListener('resize', updateTop);
  }
  return stack;
}

export function showToast(message, options) {
  const opts = options || {};
  const kind = opts.kind || 'info';
  const duration = typeof opts.duration === 'number' ? opts.duration : 5000;
  const key = kind + '|' + String(message || '');
  const now = Date.now();

  // Dedupe: if the same toast fires twice quickly, keep only one.
  if (_lastToastKey === key && (now - _lastToastAt) < 1200) {
    return { dismiss: function () {} };
  }
  _lastToastKey = key;
  _lastToastAt = now;

  const item = document.createElement('div');
  item.className = 'toast-item toast-' + kind;
  item.setAttribute('role', 'alert');
  item.setAttribute('data-toast-key', key);

  // If an identical toast is already visible, don't stack it.
  try {
    const existing = getStack().querySelector('[data-toast-key="' + CSS.escape(key) + '"]');
    if (existing) return { dismiss: function () { existing.remove(); } };
  } catch (_) {}

  const iconMap = { info: 'info', success: 'check_circle', error: 'error', warning: 'warning' };
  const iconEl = document.createElement('span');
  iconEl.className = 'material-symbols-outlined toast-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = iconMap[kind] || 'info';

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message || '';

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  const closeIcon = document.createElement('span');
  closeIcon.className = 'material-symbols-outlined';
  closeIcon.setAttribute('aria-hidden', 'true');
  closeIcon.textContent = 'close';
  close.appendChild(closeIcon);

  item.append(iconEl, text, close);
  getStack().appendChild(item);

  // Animate in
  requestAnimationFrame(function () { item.classList.add('toast-visible'); });

  function dismiss() {
    item.classList.remove('toast-visible');
    item.classList.add('toast-out');
    item.addEventListener('transitionend', function () { item.remove(); }, { once: true });
  }

  close.addEventListener('click', dismiss);

  let timer = duration > 0 ? setTimeout(dismiss, duration) : null;
  item.addEventListener('mouseenter', function () { if (timer) { clearTimeout(timer); timer = null; } });
  item.addEventListener('mouseleave', function () { if (duration > 0 && !timer) timer = setTimeout(dismiss, 2000); });

  return { dismiss };
}
