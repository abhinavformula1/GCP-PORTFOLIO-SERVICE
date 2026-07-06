/**
 * Contact Policy module — load, render, save, and test the contact form policy.
 * S — all policy concerns live here and nowhere else.
 */

import { state }                from '../state.js';
import { authedJson, setSectionStatus } from '../http.js';
import { parseListInput, domainFromEmail } from '../utils.js';

export async function loadContactPolicy(els) {
  const data = await authedJson('/api/admin/contact-policy');
  renderContactPolicy(els, data.policy || {});
}

export function renderContactPolicy(els, policy) {
  state.contactPolicyState = policy || {};
  const p = state.contactPolicyState;
  els.privatePhone.value   = String(p.privatePhone || '').trim();
  const allowedDomains  = Array.isArray(p.allowedDomains)  ? p.allowedDomains  : [];
  const personalDomains = Array.isArray(p.personalDomains) ? p.personalDomains : [];
  const allowedEmails   = Array.isArray(p.allowedEmails)   ? p.allowedEmails   : [];
  const blockedDomains  = Array.isArray(p.blockedDomains)  ? p.blockedDomains  : [];
  els.allowedDomains.value  = allowedDomains.join('\n');
  els.personalDomains.value = personalDomains.join('\n');
  els.allowedEmails.value   = allowedEmails.join('\n');
  els.blockedDomains.value  = blockedDomains.join('\n');
  _renderPolicyRuleCards(els);
  const source  = p.source === 'firestore' ? 'Firestore override' : 'Environment defaults';
  const updated = p.updatedAt ? new Date(p.updatedAt).toLocaleString() : 'Not edited yet';
  const phoneOk = p.privatePhoneConfigured ? 'private phone set' : 'private phone missing';
  els.policyMeta.textContent = source + ' · ' + phoneOk + ' · ' + personalDomains.length + ' personal domains blocked · ' + allowedEmails.length + ' email exceptions · Updated: ' + updated;
  setSectionStatus(els.policyTest, '', 'info');
}

export async function saveContactPolicy(els) {
  const payload = {
    privatePhone:   String(els.privatePhone.value || '').trim(),
    allowedDomains: parseListInput(els.allowedDomains),
    personalDomains:parseListInput(els.personalDomains),
    allowedEmails:  parseListInput(els.allowedEmails),
    blockedDomains: parseListInput(els.blockedDomains),
  };
  setSectionStatus(els.policyTest, 'Saving contact policy...', 'info');
  const data = await authedJson('/api/admin/contact-policy', {
    method: 'PUT', body: JSON.stringify(payload),
  });
  renderContactPolicy(els, data.policy || {});
  setSectionStatus(els.policyTest, 'Contact policy saved.', 'success');
}

export function testContactPolicy(els) {
  const email           = String(els.testEmail.value || '').trim().toLowerCase();
  const domain          = domainFromEmail(els.testEmail.value);
  const allowedDomains  = parseListInput(els.allowedDomains);
  const personalDomains = parseListInput(els.personalDomains);
  const allowedEmails   = parseListInput(els.allowedEmails);
  const blockedDomains  = parseListInput(els.blockedDomains);
  if (!domain) { setSectionStatus(els.policyTest, 'Enter a valid email to test.', 'error'); return; }
  if (allowedEmails.includes(email))                                { setSectionStatus(els.policyTest, 'Allowed. ' + email + ' is an approved email exception.', 'success'); return; }
  if (blockedDomains.find(function (d)  { return domain === d || domain.endsWith('.' + d); })) { setSectionStatus(els.policyTest, 'Blocked. ' + domain + ' is in blocked company domains.', 'error'); return; }
  if (personalDomains.find(function (d) { return domain === d || domain.endsWith('.' + d); })) { setSectionStatus(els.policyTest, 'Blocked. ' + domain + ' is a personal email domain.', 'error'); return; }
  if (allowedDomains.find(function (d)  { return domain === d || domain.endsWith('.' + d); })) { setSectionStatus(els.policyTest, 'Allowed. ' + domain + ' is an always-allowed company domain.', 'success'); return; }
  setSectionStatus(els.policyTest, 'Allowed. ' + domain + ' looks like a company domain.', 'success');
}

export function closePolicyRuleMenus() {
  document.querySelectorAll('.sd-policy-rule-menu').forEach(function (menu) { menu.hidden = true; });
  document.querySelectorAll('.sd-policy-rule-action-btn[aria-expanded="true"]').forEach(function (t) {
    t.setAttribute('aria-expanded', 'false');
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _formatPrivatePhonePreview(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 4) return raw;
  return '•••• ••• ' + digits.slice(-4);
}

function _renderPolicyValues(target, values, emptyText) {
  target.textContent = '';
  if (!values.length) {
    const empty = document.createElement('span');
    empty.className = 'sd-policy-empty';
    empty.textContent = emptyText;
    target.appendChild(empty);
    return;
  }
  values.forEach(function (value) {
    const chip = document.createElement('span');
    chip.className = 'sd-admin-chip sd-admin-chip-muted';
    chip.textContent = value;
    target.appendChild(chip);
  });
}

function _renderPolicyRuleCards(els) {
  _renderPolicyValues(els.privatePhoneView,    [_formatPrivatePhonePreview(els.privatePhone?.value)],  'No private phone configured.');
  _renderPolicyValues(els.personalDomainsView, parseListInput(els.personalDomains), 'No personal domains configured.');
  _renderPolicyValues(els.allowedEmailsView,   parseListInput(els.allowedEmails),   'No email exceptions configured.');
  _renderPolicyValues(els.blockedDomainsView,  parseListInput(els.blockedDomains),  'No blocked company domains.');
  _renderPolicyValues(els.allowedDomainsView,  parseListInput(els.allowedDomains),  'No strategic domains configured.');
}
