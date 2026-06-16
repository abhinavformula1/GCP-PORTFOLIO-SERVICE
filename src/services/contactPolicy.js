'use strict';

/**
 * Contact-reveal policy.
 *
 * Pure function: given a verified Google email (or null for guests), decide
 * which sensitive contact fields the viewer is allowed to see and return
 * those values alongside the decision.
 *
 * Why a separate module:
 *   - One place to evolve the policy (add SMS reveal, calendar booking, etc).
 *   - Trivially unit-testable — no I/O, no side effects.
 *   - Mirrors the IAM "policy decision point" pattern: the route is the
 *     enforcement point, this module is the decision point.
 */

const config = require('../config');
const firestore = require('./firestore');

/**
 * Extract a normalised lowercase domain from an email address.
 * Returns '' for missing / malformed inputs (treated as untrusted).
 */
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

function canUseLocalDefaults() {
  return config.server.env !== 'production' && !process.env.K_SERVICE;
}

function resolveWithAllowedDomains(viewer, allowedDomains) {
  const email = viewer && viewer.email;
  const domain = domainOf(email);
  const allowed = normaliseDomains(allowedDomains);

  const matched = allowed.find(
    (d) => domain === d || domain.endsWith('.' + d)
  );

  if (!matched) {
    return { canSeePhone: false, phone: null, matchedDomain: null };
  }

  return {
    canSeePhone: true,
    phone: config.contactPolicy.privatePhone,
    matchedDomain: matched,
  };
}

/**
 * Resolve the contact view for a viewer.
 *
 * @param {{email?: string} | null} viewer
 * @returns {{
 *   canSeePhone: boolean,
 *   phone: string | null,
 *   matchedDomain: string | null
 * }}
 */
function resolveContactView(viewer) {
  return resolveWithAllowedDomains(viewer, config.contactPolicy.allowedDomains);
}

async function getContactPolicyConfig() {
  if (canUseLocalDefaults()) {
    return {
      source: 'environment',
      allowedDomains: normaliseDomains(config.contactPolicy.allowedDomains),
      updatedBy: null,
      updatedAt: null,
      privatePhoneConfigured: !!config.contactPolicy.privatePhone,
    };
  }
  try {
    const stored = await firestore.getContactPolicyConfig();
    if (stored && Array.isArray(stored.allowedDomains) && stored.allowedDomains.length) {
      return {
        source: 'firestore',
        allowedDomains: normaliseDomains(stored.allowedDomains),
        updatedBy: stored.updatedBy || null,
        updatedAt: stored.updatedAt || null,
        privatePhoneConfigured: !!config.contactPolicy.privatePhone,
      };
    }
  } catch (err) {
    console.warn('[contact-policy] Firestore config read failed:', err.message);
  }
  return {
    source: 'environment',
    allowedDomains: normaliseDomains(config.contactPolicy.allowedDomains),
    updatedBy: null,
    updatedAt: null,
    privatePhoneConfigured: !!config.contactPolicy.privatePhone,
  };
}

async function resolveContactViewAsync(viewer) {
  const policy = await getContactPolicyConfig();
  return resolveWithAllowedDomains(viewer, policy.allowedDomains);
}

module.exports = {
  resolveContactView,
  resolveContactViewAsync,
  getContactPolicyConfig,
  normaliseDomains,
  domainOf,
};
