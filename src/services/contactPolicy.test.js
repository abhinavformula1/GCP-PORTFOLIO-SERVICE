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
  delete process.env.CONTACT_ALLOWED_DOMAINS;
  delete process.env.CONTACT_PERSONAL_DOMAINS;
  delete process.env.CONTACT_ALLOWED_EMAILS;
  delete process.env.CONTACT_BLOCKED_DOMAINS;
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
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'someone@gmail.com' });
  assert.equal(decision.canSeePhone, false);
  assert.equal(decision.phone, null);
});

test('@google.com — company domain, phone revealed', () => {
  const policy = loadFreshPolicy({
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'recruiter@google.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.phone, '+91 98765 43210');
  assert.equal(decision.matchedDomain, 'google.com');
  assert.equal(decision.reason, 'company-domain');
});

test('@corp.google.com — subdomain company domain, phone revealed', () => {
  const policy = loadFreshPolicy({
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'recruiter@corp.google.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.matchedDomain, 'corp.google.com');
});

test('allowed domain list still marks explicit strategic domains', () => {
  const policy = loadFreshPolicy({
    CONTACT_ALLOWED_DOMAINS: 'google.com,salesforce.com',
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'lookalike@salesforce.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.matchedDomain, 'salesforce.com');
  assert.equal(decision.reason, 'allowed-domain');
});

test('blocked domain exception hides company-looking domains', () => {
  const policy = loadFreshPolicy({
    CONTACT_BLOCKED_DOMAINS: 'notgoogle.com',
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'attacker@notgoogle.com' });
  assert.equal(decision.canSeePhone, false);
  assert.equal(decision.matchedDomain, 'notgoogle.com');
  assert.equal(decision.reason, 'blocked-domain');
});

test('mixed-case email — domain matching is case-insensitive', () => {
  const policy = loadFreshPolicy({
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
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

test('allowed email exception reveals phone for trusted personal email', () => {
  const policy = loadFreshPolicy({
    CONTACT_PERSONAL_DOMAINS: 'gmail.com,yahoo.com',
    CONTACT_ALLOWED_EMAILS: 'trusted@gmail.com',
    PRIVATE_PHONE: '+91 98765 43210',
  });
  const decision = policy.resolveContactView({ email: 'trusted@gmail.com' });
  assert.equal(decision.canSeePhone, true);
  assert.equal(decision.reason, 'allowed-email');
});
