'use strict';

/**
 * Unit tests for contactPolicy.resolveContactView.
 *
 * No test framework dependency — uses node:assert + node:test (built-ins
 * since Node 18). Run with:
 *   node --test src/services/contactPolicy.test.js
 *
 * Each case sets the env vars the policy reads, requires the module fresh
 * (clearing the require cache), and asserts the decision.
 */

const test       = require('node:test');
const assert     = require('node:assert/strict');
const path       = require('path');

const POLICY_PATH = path.resolve(__dirname, './contactPolicy.js');
const CONFIG_PATH = path.resolve(__dirname, '../config/index.js');

function loadFreshPolicy(envOverrides) {
  delete require.cache[POLICY_PATH];
  delete require.cache[CONFIG_PATH];
  Object.assign(process.env, envOverrides);
  return require('./contactPolicy');
}

test('guest (no email) — phone stays masked', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView(null);
  assert.equal(decision.canSeePhone, false);
  assert.equal(decision.phone, null);
  assert.equal(decision.matchedDomain, null);
});

test('@gmail.com — random user, phone hidden', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'someone@gmail.com' });
  assert.equal(decision.canSeePhone, false);
  assert.equal(decision.phone, null);
});

test('@google.com — exact domain match, phone revealed', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'recruiter@google.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.phone, '+91 98765 43210');
  assert.equal(decision.matchedDomain, 'google.com');
});

test('@corp.google.com — subdomain match, phone revealed', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'recruiter@corp.google.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.matchedDomain, 'google.com');
});

test('@salesforce.com — second allow-listed domain, phone revealed', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'lookalike@salesforce.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.matchedDomain, 'salesforce.com');
});

test('@notgoogle.com — no false-positive partial match', () => {
  // The string "google.com" is a SUFFIX of "notgoogle.com" — must not match.
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'attacker@notgoogle.com' });
  assert.equal(decision.canSeePhone, false);
  assert.equal(decision.matchedDomain, null);
});

test('mixed-case email — domain matching is case-insensitive', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'Recruiter@GOOGLE.com' });
  assert.equal(decision.canSeePhone, true);
});

test('malformed email — treated as untrusted', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  for (const bad of ['', '@', 'noatsign', 'user@', '@google.com']) {
    const decision = policy.resolveContactView({ email: bad });
    assert.equal(decision.canSeePhone, false, `expected hidden for "${bad}"`);
  }
});

test('empty allow-list — all viewers blocked', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: '',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'recruiter@google.com' });
  assert.equal(decision.canSeePhone, false);
});
