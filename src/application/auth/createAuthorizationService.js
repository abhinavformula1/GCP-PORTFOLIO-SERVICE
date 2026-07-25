'use strict';

const { AppError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createAuthorizationService(dependencies) {
  assertDependencies(dependencies, 'application.authorization', {
    identity: ['verifyIdToken'],
    adminPolicy: 'value',
    runtime: 'value',
  });
  const { identity, adminPolicy, runtime } = dependencies;

  const localUser = Object.freeze({
    uid: 'local-admin-preview',
    email: 'local-admin@localhost',
    name: 'Local Admin Preview',
    picture: '',
  });

  function isLocalHost(host) {
    const normalized = String(host || '').split(',')[0].trim().toLowerCase();
    return normalized.startsWith('localhost') || normalized.startsWith('127.0.0.1');
  }

  function canUseLocalPreview(host, token) {
    return runtime.adminLocalPreview === true
      && runtime.nodeEnv !== 'production'
      && !runtime.isCloudRuntime
      && isLocalHost(host)
      && token === 'local-admin-preview';
  }

  async function authenticate({ token, host, optional = false }) {
    if (!token) {
      if (optional) return null;
      throw new AppError('Missing Authorization header.', 401, 'UNAUTHORIZED');
    }
    if (canUseLocalPreview(host, token)) return localUser;
    try {
      return await identity.verifyIdToken(token);
    } catch (error) {
      if (optional) return null;
      throw error;
    }
  }

  async function authorizeAdmin({ token, host }) {
    const user = await authenticate({ token, host });
    const email = String(user.email || '').toLowerCase();
    if (!adminPolicy.allowedEmails.length || !adminPolicy.allowedEmails.includes(email)) {
      throw new AppError('Admin access is not allowed for this account.', 403, 'FORBIDDEN');
    }
    return user;
  }

  async function verifyAdminAccess({ token, host }) {
    if (!token) throw new AppError('Missing token.', 401, 'UNAUTHORIZED');
    let user;
    try {
      user = await authenticate({ token, host });
    } catch (_) {
      throw new AppError('Invalid or expired token.', 401, 'UNAUTHORIZED');
    }
    const email = String(user.email || '').toLowerCase();
    if (adminPolicy.allowedEmails.length && !adminPolicy.allowedEmails.includes(email)) {
      throw new AppError('Admin access not allowed.', 403, 'FORBIDDEN');
    }
    return user;
  }

  return Object.freeze({ authenticate, authorizeAdmin, verifyAdminAccess });
}

module.exports = { createAuthorizationService };
