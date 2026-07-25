'use strict';

const { assertPort } = require('../application/ports/assert');

const CAPABILITIES = {
  adminConfig: ['getSeoConfig', 'getAtlasConfig', 'getContactPolicyConfig'],
  analytics: ['trackPageViewRequest', 'recordEventRequest', 'getOverviewResponse', 'getTodayResponse'],
  chat: ['getActive', 'saveActive', 'clearActive', 'completeActive'],
  inquiries: ['submitHire', 'submitQuestion'],
  session: ['startSession'],
  recommendationUseCases: ['list', 'submit', 'remove', 'applyReply'],
  billingUseCases: ['status', 'prices', 'createCheckout', 'claim', 'overview'],
  mediaUseCases: ['upload', 'audit', 'removeObject', 'saveSponsorship'],
  atlasChat: ['submit', 'stream', 'activeConversation', 'publicConfig'],
  softwareArchitecture: ['listPublished', 'getPublished', 'saveArticle', 'runEvaluation'],
  billing: ['isStripeConfigured', 'constructWebhookEvent', 'getUserSubscriptionEntitlement'],
  contactPolicy: ['resolveContactViewAsync'],
  sponsorships: ['listActiveSponsorships'],
  sponsorBanner: ['getSponsorBanner'],
  rag: ['buildRagContext', 'indexArticle', 'removeArticleChunks'],
  ragEvaluation: ['evaluateRetrieval'],
  atlasOrchestrator: ['buildExecutionPlan', 'buildCallConfig'],
  atlasResponder: ['ask', 'askStream'],
  salesforce: ['createInquiry', 'upsertQuestion', 'upsertRecommendation', 'deleteRecommendation', 'upsertSiteVisitor', 'isConfigured'],
  googleAuth: ['verifyIdToken'],
  authorization: ['authenticate', 'authorizeAdmin', 'verifyAdminAccess'],
  gcs: ['uploadMedia', 'listMediaObjects', 'deleteMediaObject'],
  print: ['generatePdf', 'checkChrome'],
  llm: ['generateChatResponse', 'summariseConversation'],
};

const REPOSITORY_PORTS = {
  adminConfig: [
    'getTierConfigDoc', 'saveTierConfigDoc', 'getSeoConfigDoc', 'saveSeoConfigDoc',
    'getAtlasConfigDoc', 'saveAtlasConfigDoc', 'getComponentRegistryDoc',
    'saveComponentRegistryDoc', 'getContactPolicyDoc', 'saveContactPolicyDoc',
  ],
  analytics: [
    'recordEvent', 'fetchOverview', 'fetchTodayUsers',
    'cleanupMonthlyTestData', 'cleanupDailyTestUsers',
  ],
  articles: ['listPublishedArticles', 'listArticles', 'getArticle', 'upsertArticle', 'deleteArticle'],
  atlas: [
    'getActiveConversation', 'appendTurn', 'clearActiveConversation',
    'appendUsageEvent', 'getUsageSummary', 'getCacheEntry', 'saveCacheEntry',
  ],
  billing: [
    'appendBillingEvent', 'upsertBillingUser', 'getBillingUser',
    'listBillingUsers', 'upsertBillingCustomer', 'getBillingCustomer',
  ],
  chatSessions: ['getActiveChat', 'upsertActiveChat', 'clearActiveChat', 'completeActiveChat'],
  ragAdmin: [
    'getGoldenDatasetRows', 'resetGoldenDataset', 'saveGoldenDatasetRows',
    'saveRagEvalRun', 'listRagEvalRuns', 'deleteRagEvalRun',
  ],
  recommendations: [
    'upsertRecommendation', 'listActiveRecommendations',
    'writeRecommendationReply', 'deleteRecommendation',
  ],
  sponsorBanner: ['getSponsorBanner', 'upsertSponsorBanner', 'deleteSponsorBanner'],
  sponsorships: [
    'listSponsorships', 'listActiveSponsorships', 'upsertSponsorship', 'deleteSponsorship',
  ],
  users: ['getUser', 'mergeUserFields', 'upsertUserVisit'],
};

const ADAPTER_PORTS = {
  firestore: ['getDb', 'close'],
  langsmith: ['isLangSmithEnabled', 'traceIfEnabled'],
  stripe: ['getStripe', 'isStripeConfigured'],
  tavily: ['hasApiKey', 'searchTavily'],
};

function validateComposition(composition) {
  assertPort(composition, 'composition', []);
  assertPort(composition.config, 'composition.config', []);
  assertPort(composition.repositories, 'composition.repositories', []);
  assertPort(composition.readiness, 'composition.readiness', ['check']);
  assertPort(composition.httpCapabilities, 'composition.httpCapabilities', []);
  if (!Array.isArray(composition.closeHooks)) {
    throw new TypeError('composition.closeHooks: required array is missing');
  }
  composition.closeHooks.forEach((hook, index) => {
    if (typeof hook !== 'function') {
      throw new TypeError(`composition.closeHooks.${index}: required function is missing`);
    }
  });
  for (const [name, methods] of Object.entries(REPOSITORY_PORTS)) {
    assertPort(composition.repositories[name], `composition.repositories.${name}`, methods);
  }
  for (const [name, methods] of Object.entries(ADAPTER_PORTS)) {
    assertPort(composition[name], `composition.${name}`, methods);
  }
  for (const [name, methods] of Object.entries(CAPABILITIES)) {
    assertPort(composition[name], `composition.${name}`, methods);
  }
  return composition;
}

function freezeCapabilities(composition) {
  for (const name of Object.keys(CAPABILITIES)) {
    const capability = composition[name];
    if (capability && Object.getPrototypeOf(capability) === Object.prototype) {
      Object.freeze(capability);
    }
  }
  return Object.freeze(composition);
}

function validateRouteCapabilities(capabilities) {
  assertPort(capabilities.auth, 'routes.auth', [
    'requireAuth', 'optionalAuth', 'requireAdmin', 'requireAdminAccess',
  ]);
  assertPort(capabilities.limits, 'routes.rateLimits', [
    'hireLimiter', 'questionLimiter', 'recommendationLimiter',
    'atlasLimiter', 'analyticsTrackLimiter',
  ]);
  assertPort(capabilities.atlas, 'routes.atlas', [
    'submit', 'stream', 'activeConversation', 'usage', 'publicConfig',
  ]);
  assertPort(capabilities.software, 'routes.softwareArchitecture', [
    'getTierConfig', 'listPublished', 'getPublished', 'saveArticle', 'runEvaluation',
  ]);
  assertPort(capabilities.media, 'routes.media', [
    'upload', 'audit', 'removeObject', 'saveSponsorship',
  ]);
  assertPort(capabilities.pdf, 'routes.pdf', [
    'generatePdf', 'checkChrome', 'getArticle', 'getEntitlement', 'verifyIdToken',
  ]);
  assertPort(capabilities.print, 'routes.print', ['getArticle']);
  assertPort(capabilities.billing, 'routes.billing', [
    'status', 'prices', 'createCheckout', 'claim', 'overview',
  ]);
  return capabilities;
}

module.exports = {
  validateComposition,
  validateRouteCapabilities,
  freezeCapabilities,
  CAPABILITIES,
  REPOSITORY_PORTS,
  ADAPTER_PORTS,
};
