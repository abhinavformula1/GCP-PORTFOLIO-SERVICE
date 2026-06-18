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

function getStack() {
  if (stack && stack.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('aria-live', 'polite');
  stack.setAttribute('aria-atomic', 'false');
  document.body.appendChild(stack);
  return stack;
}

export function showToast(message, options) {
  const opts = options || {};
  const kind = opts.kind || 'info';
  const duration = typeof opts.duration === 'number' ? opts.duration : 5000;

  const item = document.createElement('div');
  item.className = 'toast-item toast-' + kind;
  item.setAttribute('role', 'alert');

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
