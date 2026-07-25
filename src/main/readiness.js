'use strict';

function createReadiness(checks) {
  const entries = Object.entries(checks || {});
  return Object.freeze({
    async check() {
      const failed = [];
      for (const [name, check] of entries) {
        try {
          if (await check() !== true) failed.push(name);
        } catch (_) {
          failed.push(name);
        }
      }
      return Object.freeze({ ready: failed.length === 0, failed: Object.freeze(failed) });
    },
  });
}

module.exports = { createReadiness };
