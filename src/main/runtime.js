'use strict';

function createRuntime(config) {
  if (!config || !config.runtime || !config.server) {
    throw new TypeError('runtime requires validated configuration');
  }
  return Object.freeze({
    isCloudRuntime: config.runtime.isCloudRuntime,
    nodeEnv: config.server.env,
    mediaBucket: config.runtime.mediaBucket,
    adminLocalPreview: config.admin.localPreview,
    chromePath: config.runtime.chromePath,
    sfApiKey: config.runtime.sfApiKey,
    siteUrl: config.stripe.siteUrl,
  });
}

module.exports = { createRuntime };
