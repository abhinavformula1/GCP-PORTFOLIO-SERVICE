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
  const email = viewer && viewer.email;
  const domain = domainOf(email);
  const allowed = config.contactPolicy.allowedDomains;

  // Match on suffix so subdomains (e.g. corp.google.com) are also accepted.
  // Note: we deliberately don't accept arbitrary partial matches — only
  // exact-domain or *.<allowed-domain>.
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

module.exports = { resolveContactView, domainOf };
