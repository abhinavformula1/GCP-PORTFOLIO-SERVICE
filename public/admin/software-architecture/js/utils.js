/**
 * Pure utility functions — no DOM, no state, no side-effects.
 * S — each function does one thing; O — extend by adding exports, never edits.
 */

export function slugify(value) {
  const source = String(value || '').toLowerCase();
  let slug = '';
  let pendingDash = false;
  for (const ch of source) {
    const isSafe = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (isSafe) {
      if (pendingDash && slug) slug += '-';
      slug += ch;
      pendingDash = false;
    } else {
      pendingDash = true;
    }
    if (slug.length >= 80) break;
  }
  return slug;
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Alias kept for modules that imported the local escHtml variant. */
export const escHtml = escapeHtml;

export function safeText(s) {
  return String(s == null ? '' : s);
}

export function parseListInput(el) {
  return el.value
    .split(/\n|,/)
    .map(function (v) { return v.trim().toLowerCase(); })
    .filter(Boolean);
}

export function domainFromEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '';
  return value.slice(at + 1);
}

export function formatBytes(n) {
  const bytes = Number(n || 0);
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(i === 0 ? 0 : v >= 10 ? 1 : 2) + ' ' + units[i];
}

export function formatWhen(ts) {
  const t = Number(ts || 0);
  if (!t) return '';
  try { return new Date(t).toLocaleString(); } catch (_) { return ''; }
}

export function pct(num, den) {
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return '0%';
  const v = Math.max(0, Math.min(1, n / d)) * 100;
  return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%';
}

export function articleDisplayName(article) {
  const en = article && article.en ? article.en : {};
  return en.title || (article && article.id) || 'Untitled article';
}
