'use strict';

const crypto = require('crypto');
const geoip = require('geoip-lite');
const defaultConfig = require('../infrastructure/config');
const { createFirestoreClient } = require('../infrastructure/persistence/firestore/client');
const { createAdminConfigRepository } = require('../infrastructure/persistence/firestore/adminConfigRepository');
const { createAnalyticsRepository } = require('../infrastructure/persistence/firestore/analyticsRepository');
const { createArticlesRepository } = require('../infrastructure/persistence/firestore/articlesRepository');
const { createAtlasRepository } = require('../infrastructure/persistence/firestore/atlasRepository');
const { createBillingRepository } = require('../infrastructure/persistence/firestore/billingRepository');
const { createChatSessionsRepository } = require('../infrastructure/persistence/firestore/chatSessionsRepository');
const { createRagAdminRepository } = require('../infrastructure/persistence/firestore/ragAdminRepository');
const { createRecommendationsRepository } = require('../infrastructure/persistence/firestore/recommendationsRepository');
const { createSponsorBannerRepository } = require('../infrastructure/persistence/firestore/sponsorBannerRepository');
const { createSponsorshipsRepository } = require('../infrastructure/persistence/firestore/sponsorshipsRepository');
const { createUsersRepository } = require('../infrastructure/persistence/firestore/usersRepository');
const { createTracingAdapter } = require('../infrastructure/observability/langsmith');
const { createGoogleIdentityVerifier } = require('../infrastructure/identity/google');
const { createStripeClient } = require('../infrastructure/billing/stripe');
const { createStripeGateway } = require('../infrastructure/billing/stripeGateway');
const { createMediaStorage } = require('../infrastructure/storage/gcs');
const { createPdfGenerator } = require('../infrastructure/documents/print');
const localPreviewContent = require('../infrastructure/content/localPreviewContent');
const { createGeminiProvider } = require('../infrastructure/ai/llm/providers/gemini');
const { createProviderRegistry } = require('../infrastructure/ai/llm/providers');
const { createLlmGateway } = require('../infrastructure/ai/llm');
const { createRagStore } = require('../infrastructure/ai/rag/ragStore');
const keywordSearch = require('../infrastructure/ai/rag/keywordSearch');
const { embedText } = require('../infrastructure/ai/rag/embedText');
const { rerankIfConfigured } = require('../infrastructure/ai/rag/rerank');
const { createTavilySearch } = require('../infrastructure/search/tavily/search');
const { createWebSearchAgent } = require('../infrastructure/ai/atlas/agents/webSearchAgent');
const { runAtlasSupervisorImpl } = require('../infrastructure/ai/atlas/supervisor');
const { createSupervisorClassifier } = require('../infrastructure/ai/atlas/supervisor/classifier');
const { createSalesforceAuth } = require('../infrastructure/integrations/salesforce/auth');
const { createSalesforceTransport } = require('../infrastructure/integrations/salesforce/httpClient');
const salesforceRetry = require('../infrastructure/integrations/salesforce/retry');
const { createIntegrationLogger } = require('../infrastructure/integrations/salesforce/integrationLog');
const { createBillingService } = require('../application/billing/createBillingService');
const { createBillingUseCases } = require('../application/billing/createBillingUseCases');
const { createAnalyticsService } = require('../application/analytics/createAnalyticsService');
const { createAdminConfigService } = require('../application/admin/createAdminConfigService');
const { createContactPolicy } = require('../application/auth/createContactPolicy');
const { createAuthorizationService } = require('../application/auth/createAuthorizationService');
const { createChatService } = require('../application/chat/createChatService');
const { createInquiryUseCases } = require('../application/inquiries/createInquiryUseCases');
const { createSessionService } = require('../application/session/createSessionService');
const { createRecommendationUseCases } = require('../application/recommendations/createRecommendationUseCases');
const { createHttpCapabilities } = require('../application/http/createHttpCapabilities');
const { createMediaUseCases } = require('../application/media/createMediaUseCases');
const { createSoftwareArchitectureUseCases } = require('../application/content/createSoftwareArchitectureUseCases');
const { createSponsorshipsService } = require('../application/sponsorships/createSponsorshipsService');
const { createSponsorBannerService } = require('../application/sponsorships/createSponsorBannerService');
const { createRagService } = require('../application/rag/createRagService');
const { createRagEvaluationService } = require('../application/rag/createRagEvaluationService');
const { createAtlasResponder } = require('../application/atlas/createAtlasResponder');
const { createAtlasOrchestrator } = require('../application/atlas/createAtlasOrchestrator');
const { createAtlasChatUseCases } = require('../application/atlas/createAtlasChatUseCases');
const { createSupervisorRouter } = require('../application/atlas/supervisor/router');
const { createRecruiterInquiryService } = require('../application/salesforce/createRecruiterInquiryService');
const { createRecruiterQuestionService } = require('../application/salesforce/createRecruiterQuestionService');
const { createRecommendationService } = require('../application/salesforce/createRecommendationService');
const { createSiteVisitorService } = require('../application/salesforce/createSiteVisitorService');
const { resolveModel } = require('../domain/llm/models');
const { validateComposition, freezeCapabilities } = require('./validateComposition');
const { createRuntime } = require('./runtime');
const { createReadiness } = require('./readiness');

function buildComposition(runtime, options = {}) {
  const config = options.config || defaultConfig;
  runtime = runtime || createRuntime(config);
  const firestore = options.firestore || createFirestoreClient({
    config,
    FirestoreClass: options.FirestoreClass,
  });
  const repositories = Object.freeze({
    adminConfig: createAdminConfigRepository({ firestore }),
    analytics: createAnalyticsRepository({ firestore }),
    articles: createArticlesRepository({ firestore }),
    atlas: createAtlasRepository({ firestore, logger: options.logger || console }),
    billing: createBillingRepository({ firestore }),
    chatSessions: createChatSessionsRepository({ firestore }),
    ragAdmin: createRagAdminRepository({ firestore }),
    recommendations: createRecommendationsRepository({ firestore }),
    sponsorBanner: createSponsorBannerRepository({ firestore }),
    sponsorships: createSponsorshipsRepository({ firestore }),
    users: createUsersRepository({ firestore }),
  });
  const ragStore = createRagStore({ firestore });
  const langsmith = createTracingAdapter({ config });
  const geminiProvider = createGeminiProvider({ config, tracing: langsmith });
  const providerRegistry = createProviderRegistry({ geminiProvider });
  const llm = createLlmGateway(providerRegistry);
  const googleAuth = createGoogleIdentityVerifier({ config });
  const authorization = createAuthorizationService({
    identity: googleAuth,
    adminPolicy: config.admin,
    runtime,
  });
  const stripeClient = createStripeClient({ config });
  const stripeGateway = createStripeGateway({ stripeClient });
  const gcs = createMediaStorage({ runtime });
  const print = createPdfGenerator({ runtime });
  const tavily = createTavilySearch({ config });
  const { runWebSearchAgent } = createWebSearchAgent({
    config,
    traceIfEnabled: langsmith.traceIfEnabled,
    searchTavily: tavily.searchTavily,
  });
  const adminConfig = createAdminConfigService({
    adminConfigRepository: repositories.adminConfig,
    appConfig: config,
    setLangSmithRuntimeEnabled: langsmith.setLangSmithRuntimeEnabled,
  });
  const billing = createBillingService({
    clock: Date,
    billingRepository: repositories.billing,
    usersRepository: repositories.users,
    stripeGateway,
  });
  const billingUseCases = createBillingUseCases({
    billing,
    settings: {
      stripe: config.stripe,
      environment: config.server.env,
      adminLocalPreview: config.admin.localPreview,
      isCloudRuntime: runtime.isCloudRuntime,
    },
  });
  const analytics = createAnalyticsService({
    crypto,
    analyticsRepository: repositories.analytics,
    geoLookup: geoip.lookup,
  });
  const chat = createChatService(repositories.chatSessions);
  const contactPolicy = createContactPolicy({
    config,
    adminConfig,
    isCloudRuntime: runtime.isCloudRuntime,
  });
  const sponsorships = createSponsorshipsService(repositories.sponsorships);
  const sponsorBanner = createSponsorBannerService(repositories.sponsorBanner);
  const rag = createRagService({
    embedText,
    saveChunks: ragStore.saveChunks,
    deleteChunksForArticle: ragStore.deleteChunksForArticle,
    findNearestChunks: ragStore.findNearestChunks,
    adminConfig,
    keywordSearch: keywordSearch.keywordSearch,
    upsertKeywordChunks: keywordSearch.upsertKeywordChunks,
    deleteKeywordChunksByArticle: keywordSearch.deleteKeywordChunksByArticle,
    rerankIfConfigured,
  });
  const ragEvaluation = createRagEvaluationService({
    embedText,
    findNearestChunks: ragStore.findNearestChunks,
    getChunksForArticle: ragStore.getChunksForArticle,
    generateChatResponse: llm.generateChatResponse,
  });

  const classify = createSupervisorClassifier({ config, resolveModel });
  const supervisorRouter = createSupervisorRouter({
    hasTavilyApiKey: tavily.hasApiKey,
    looksLikeWebIntent: tavily.looksLikeWebIntent,
    shouldUseWebSearch: tavily.shouldUseWebSearch,
    classify,
  });
  const supervisorDependencies = {
    resolveSupervisorPlan: supervisorRouter.resolveSupervisorPlan,
    runWebSearchAgent,
    searchTavily: tavily.searchTavily,
    buildRagContext: rag.buildRagContext,
  };
  const runAtlasSupervisor = langsmith.traceIfEnabled(function (input, options = {}) {
    return runAtlasSupervisorImpl(input, Object.assign({}, options, {
      dependencies: Object.assign({}, supervisorDependencies, options.dependencies || {}),
    }));
  }, {
    name: 'atlas.langgraph-supervisor',
    run_type: 'chain',
    tags: ['atlas', 'langgraph', 'supervisor'],
  });
  const atlasOrchestrator = createAtlasOrchestrator({
    adminConfig,
    runWebSearchAgent,
    buildPreliminaryPlan: supervisorRouter.buildPreliminaryPlan,
    runAtlasSupervisor,
    buildRagContext: rag.buildRagContext,
    searchTavily: tavily.searchTavily,
    buildWebSearchContext: tavily.buildWebSearchContext,
    toPublicWebSearchMeta: tavily.toPublicWebSearchMeta,
  });
  const atlasResponder = createAtlasResponder(Object.assign({
    generateChatResponse: llm.generateChatResponse,
    generateChatResponseStream: llm.generateChatResponseStream,
    LLM_MODELS: llm.LLM_MODELS,
    DEFAULT_LLM_MODEL_KEY: llm.DEFAULT_LLM_MODEL_KEY,
  }, langsmith));

  const salesforceAuth = createSalesforceAuth({ config });
  const unloggedTransport = createSalesforceTransport({ config });
  const integrationLogger = createIntegrationLogger({
    getToken: salesforceAuth.getToken,
    sfRequest: unloggedTransport.sfRequest,
  });
  const salesforceTransport = createSalesforceTransport({
    config,
    auditLogger: integrationLogger.writeLog,
  });
  const salesforceBase = Object.assign({}, salesforceAuth, salesforceTransport, salesforceRetry);
  const salesforce = Object.assign(
    {},
    createRecruiterInquiryService(salesforceBase),
    createRecruiterQuestionService(salesforceBase),
    createRecommendationService(salesforceBase),
    createSiteVisitorService(salesforceBase),
    { isConfigured: salesforceAuth.isConfigured }
  );
  const inquiries = createInquiryUseCases({
    salesforce,
    randomUUID: crypto.randomUUID,
    logger: console,
  });
  const session = createSessionService({
    users: repositories.users,
    billing,
    billingUseCases,
    salesforce,
    identity: googleAuth,
    contactPolicy,
    randomUUID: crypto.randomUUID,
    now: Date.now,
    logger: console,
    runtime,
  });
  const recommendationUseCases = createRecommendationUseCases({
    repository: repositories.recommendations,
    salesforce,
    identity: googleAuth,
    randomUUID: crypto.randomUUID,
    secureCompare(left, right) {
      const leftBuffer = Buffer.from(left);
      const rightBuffer = Buffer.from(right);
      return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
    },
    nowIso: () => new Date().toISOString(),
    logger: console,
    callbackSecret: String(config.sfCallback.secret || '').trim(),
  });
  const httpCapabilities = createHttpCapabilities({
    atlasRepository: repositories.atlas,
    articlesRepository: repositories.articles,
    ragAdminRepository: repositories.ragAdmin,
    adminConfig,
    pdfGenerator: print,
  });
  const mediaUseCases = createMediaUseCases({
    storage: gcs,
    articles: httpCapabilities.articleContent,
    sponsorBanner,
    runtime,
    clock: Date,
    maxUploadBytes: gcs.MAX_BYTES,
  });
  const atlasChat = createAtlasChatUseCases({
    persistence: httpCapabilities.atlasPersistence,
    responder: atlasResponder,
    orchestrator: atlasOrchestrator,
    tracing: langsmith,
    getAtlasConfig: adminConfig.getAtlasConfig,
    randomUUID: crypto.randomUUID,
    hashText(value) {
      return crypto.createHash('sha256').update(value).digest('hex');
    },
    logger: console,
    settings: { localPreview: config.admin.localPreview },
  });
  const softwareArchitecture = createSoftwareArchitectureUseCases({
    configuration: httpCapabilities.configuration,
    articles: httpCapabilities.articleContent,
    ragAdmin: httpCapabilities.ragAdministration,
    billing,
    contactPolicy,
    sponsorships,
    localPreviewContent,
    indexArticle: rag.indexArticle,
    removeArticleChunks: rag.removeArticleChunks,
    evaluateRetrieval: ragEvaluation.evaluateRetrieval,
    generateChatResponse: llm.generateChatResponse,
    runtimeMetrics() {
      const memory = process.memoryUsage();
      const heapUsedMb = +(memory.heapUsed / 1024 / 1024).toFixed(1);
      const heapTotalMb = +(memory.heapTotal / 1024 / 1024).toFixed(1);
      return {
        infrastructure: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          environment: runtime.nodeEnv || 'development',
          heapUsedMb,
          heapTotalMb,
          platform: process.platform,
        },
        resources: {
          heapPct: heapTotalMb > 0 ? +(heapUsedMb / heapTotalMb * 100).toFixed(1) : 0,
          memPct: null,
          cpuPct: null,
        },
        performance: { totalRequests: null, avgResponseMs: null, reqPerMin: null },
        services: [],
        dependencies: [],
        alerts: [],
        incidents: [],
        history: [],
      };
    },
    clock: Date,
    logger: console,
    settings: {
      localPreview: config.admin.localPreview,
      localDevelopment: config.server.env !== 'production' && !runtime.isCloudRuntime,
      allowedAdminEmails: config.admin.allowedEmails,
      privatePhone: config.contactPolicy.privatePhone,
      geminiReady: !!config.gemini.apiKey,
      langsmithReady: !!(config.langsmith.apiKey && config.langsmith.tracingEnabled),
    },
  });
  const composition = {
    config,
    runtime,
    repositories,
    adminConfig,
    analytics,
    chat,
    inquiries,
    session,
    recommendationUseCases,
    billingUseCases,
    httpCapabilities,
    mediaUseCases,
    atlasChat,
    softwareArchitecture,
    billing,
    contactPolicy,
    sponsorships,
    sponsorBanner,
    rag,
    ragEvaluation,
    supervisorRouter,
    atlasOrchestrator,
    atlasResponder,
    langsmith,
    salesforce,
    firestore,
    tavily,
    googleAuth,
    authorization,
    stripe: stripeClient,
    gcs,
    print,
    localPreviewContent,
    llm,
    readiness: createReadiness({
      config: () => Object.isFrozen(config),
      identity: () => typeof googleAuth.verifyIdToken === 'function',
      persistence: () => typeof repositories.articles.listPublishedArticles === 'function',
      atlas: () => typeof atlasChat.submit === 'function' && typeof atlasChat.stream === 'function',
      billing: () => typeof billingUseCases.status === 'function',
      media: () => typeof mediaUseCases.audit === 'function',
    }),
    closeHooks: Object.freeze([firestore.close]),
  };
  validateComposition(composition);
  return freezeCapabilities(composition);
}

module.exports = { buildComposition };
