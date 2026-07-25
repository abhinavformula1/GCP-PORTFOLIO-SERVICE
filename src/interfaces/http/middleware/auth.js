'use strict';

function createAuthMiddleware({ authorization }) {
  function requestHost(req) {
    const raw = req.headers['x-forwarded-host'] || req.headers.host || '';
    return String(Array.isArray(raw) ? raw[0] : raw).split(',')[0].trim();
  }

  function bearerToken(req) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    return match ? String(match[1] || '').trim() : '';
  }

  async function requireAuth(req, _res, next) {
    try {
      req.user = await authorization.authenticate({
        token: bearerToken(req),
        host: requestHost(req),
      });
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function optionalAuth(req, _res, next) {
    req.user = await authorization.authenticate({
      token: bearerToken(req),
      host: requestHost(req),
      optional: true,
    });
    return next();
  }

  async function requireAdmin(req, _res, next) {
    try {
      req.user = await authorization.authorizeAdmin({
        token: bearerToken(req),
        host: requestHost(req),
      });
      return next();
    } catch (error) {
      return next(error);
    }
  }

  async function verifyAdminAccess(req, {
    allowQueryToken = false,
    allowHeaderToken = true,
  } = {}) {
    const headerToken = allowHeaderToken ? bearerToken(req) : '';
    const queryToken = allowQueryToken ? String(req.query?.token || '').trim() : '';
    req.user = await authorization.verifyAdminAccess({
      token: headerToken || queryToken,
      host: requestHost(req),
    });
    return req.user;
  }

  function requireAdminAccess(options = {}) {
    return async function adminAccessMiddleware(req, _res, next) {
      try {
        await verifyAdminAccess(req, options);
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  return { requireAuth, optionalAuth, requireAdmin, verifyAdminAccess, requireAdminAccess };
}

module.exports = { createAuthMiddleware };
