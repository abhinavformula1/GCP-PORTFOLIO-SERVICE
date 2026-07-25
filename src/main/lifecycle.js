'use strict';

function createCloseController({ server, closeHooks = [], logger = console }) {
  if (!server || typeof server.close !== 'function') {
    throw new TypeError('lifecycle.server.close is required');
  }
  if (!Array.isArray(closeHooks) || closeHooks.some((hook) => typeof hook !== 'function')) {
    throw new TypeError('lifecycle.closeHooks must be an array of functions');
  }
  let closePromise = null;
  return function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      const failures = [];
      if (server.listening) {
        try {
          await new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
          });
        } catch (error) {
          failures.push(error);
        }
      }
      for (const hook of [...closeHooks].reverse()) {
        try {
          await hook();
        } catch (error) {
          failures.push(error);
          try { logger.error('Adapter close hook failed:', error); } catch (_) {}
        }
      }
      if (failures.length) {
        throw new AggregateError(failures, 'One or more shutdown operations failed.');
      }
    })();
    return closePromise;
  };
}

function installGracefulShutdown(control, {
  processRef = process,
  logger = console,
  signals = ['SIGTERM', 'SIGINT'],
} = {}) {
  let closing = false;
  const handlers = new Map();

  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    try {
      await control.close();
      logger.log(`Server stopped after ${signal}.`);
    } catch (error) {
      logger.error(`Graceful shutdown failed after ${signal}:`, error);
      processRef.exitCode = 1;
    }
  }

  for (const signal of signals) {
    const handler = () => { void shutdown(signal); };
    handlers.set(signal, handler);
    processRef.on(signal, handler);
  }

  return function uninstall() {
    for (const [signal, handler] of handlers) {
      processRef.removeListener(signal, handler);
    }
  };
}

module.exports = { createCloseController, installGracefulShutdown };
