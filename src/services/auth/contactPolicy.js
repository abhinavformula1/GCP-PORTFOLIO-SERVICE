'use strict';

/**
 * Contact-reveal policy.
 */

const config = require('../../config');
const adminConfig = require('../adminConfig');

function domainOf(email) {
  if (!email || typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

function normaliseDomains(domains) {
  return (Array.isArray(domains) ? domains : [])
    .map((domain) => String(domain).trim().toLowerCase())
    .filter(Boolean);
}

function normaliseEmails(emails) {
  return (Array.isArray(emails) ? emails : [])
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean);
}

function canUseLocalDefaults() {
  return config.server.env !== 'production' && !process.env.K_SERVICE;
}

function matchesDomain(domain, allowedDomain) {
  return domain === allowedDomain || domain.endsWith('.' + allowedDomain);
}

function looksConfiguredPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return false;
  if (/[xX]/.test(value)) return false;
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 8;
}

function defaultPolicy() {
  return {
    privatePhone: String(config.contactPolicy.privatePhone || '').trim(),
    allowedDomains: normaliseDomains(config.contactPolicy.allowedDomains),
    personalDomains: normaliseDomains(config.contactPolicy.personalDomains),
    allowedEmails: Array.from(new Set(normaliseEmails([
      ...config.admin.allowedEmails,
      ...config.contactPolicy.allowedEmails,
    ]))),
    blockedDomains: normaliseDomains(config.contactPolicy.blockedDomains),
  };
}

function resolveWithPolicy(viewer, policy) {
  const email = String((viewer && viewer.email) || '').trim().toLowerCase();
  const domain = domainOf(email);
  const effective = Object.assign(defaultPolicy(), policy || {});
  const allowedEmails = normaliseEmails(effective.allowedEmails);
  const blockedDomains = normaliseDomains(effective.blockedDomains);
  const personalDomains = normaliseDomains(effective.personalDomains);
  const allowedDomains = normaliseDomains(effective.allowedDomains);
  const privatePhone = String(effective.privatePhone || '').trim();

  if (!email || !domain) {
    return { canSeePhone: false, phone: null, matchedDomain: null, reason: 'invalid-email' };
  }

  if (allowedEmails.includes(email)) {
    if (!looksConfiguredPhone(privatePhone)) {
      return { canSeePhone: false, phone: null, matchedDomain: domain, reason: 'phone-not-configured' };
    }
    return {
      canSeePhone: true,
      phone: privatePhone,
      matchedDomain: domain,
      reason: 'allowed-email',
    };
  }

  const blocked = blockedDomains.find((d) => matchesDomain(domain, d));
  if (blocked) {
    return { canSeePhone: false, phone: null, matchedDomain: blocked, reason: 'blocked-domain' };
  }

  const personal = personalDomains.find((d) => matchesDomain(domain, d));
  if (personal) {
    return { canSeePhone: false, phone: null, matchedDomain: personal, reason: 'personal-domain' };
  }

  const allowed = allowedDomains.find((d) => matchesDomain(domain, d));
  if (!looksConfiguredPhone(privatePhone)) {
    return { canSeePhone: false, phone: null, matchedDomain: allowed || domain, reason: 'phone-not-configured' };
  }
  return {
    canSeePhone: true,
    phone: privatePhone,
    matchedDomain: allowed || domain,
    reason: allowed ? 'allowed-domain' : 'company-domain',
  };
}

async function getContactPolicyConfig() {
  if (canUseLocalDefaults()) {
    return {
      source: 'environment',
      ...defaultPolicy(),
      updatedBy: null,
      updatedAt: null,
      privatePhoneConfigured: looksConfiguredPhone(defaultPolicy().privatePhone),
    };
  }
  try {
    const stored = await adminConfig.getContactPolicyConfig();
    if (stored) {
      const defaults = defaultPolicy();
      return {
        source: 'firestore',
        privatePhone: Object.prototype.hasOwnProperty.call(stored, 'privatePhone')
          ? String(stored.privatePhone || '').trim()
          : defaults.privatePhone,
        allowedDomains: normaliseDomains(stored.allowedDomains),
        personalDomains: Object.prototype.hasOwnProperty.call(stored, 'personalDomains')
          ? normaliseDomains(stored.personalDomains)
          : defaults.personalDomains,
        allowedEmails: Object.prototype.hasOwnProperty.call(stored, 'allowedEmails')
          ? normaliseEmails(stored.allowedEmails)
          : defaults.allowedEmails,
        blockedDomains: Object.prototype.hasOwnProperty.call(stored, 'blockedDomains')
          ? normaliseDomains(stored.blockedDomains)
          : defaults.blockedDomains,
        updatedBy: stored.updatedBy || null,
        updatedAt: stored.updatedAt || null,
        privatePhoneConfigured: looksConfiguredPhone(
          (Object.prototype.hasOwnProperty.call(stored, 'privatePhone') ? String(stored.privatePhone || '').trim() : defaults.privatePhone)
        ),
      };
    }
  } catch (err) {
    console.warn('[contact-policy] Firestore config read failed:', err.message);
  }
  return {
    source: 'environment',
    ...defaultPolicy(),
    updatedBy: null,
    updatedAt: null,
    privatePhoneConfigured: looksConfiguredPhone(defaultPolicy().privatePhone),
  };
}

async function resolveContactViewAsync(viewer) {
  const policy = await getContactPolicyConfig();
  return resolveWithPolicy(viewer, policy);
}

module.exports = {
  resolveContactViewAsync,
  getContactPolicyConfig,
  normaliseDomains,
  normaliseEmails,
};
