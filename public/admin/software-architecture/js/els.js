/**
 * Element registry — single place that maps semantic names to DOM nodes.
 *
 * S — only concerned with resolving IDs to elements at startup.
 * Evaluated once when admin.js imports it (DOM is ready because the script
 * tag is type="module", which defers execution until after HTML parsing).
 *
 * Caveat — topbar nodes don't exist yet at that point: `renderAppHeader()`
 * builds the sign-in/avatar/dropdown DOM at runtime, AFTER this module's
 * top-level `els` object below has already run its one-shot getElementById
 * lookups (ES module imports are always evaluated before the importing
 * module's own code, so admin.js's `renderAppHeader(...)` call can never
 * run first). Those fields would resolve to permanent `null`s. Callers must
 * invoke `refreshTopbarEls()` once, right after `renderAppHeader()` runs.
 */

function g(id) { return document.getElementById(id); }
function q(sel) { return document.querySelector(sel); }

export const els = {
  // ── Topbar / Auth (rendered later by renderAppHeader — see refreshTopbarEls) ─
  topbarSignIn:    g('adminTopbarSignInBtn'),
  topbarUser:      g('adminTopbarUser'),
  avatarBtn:       g('adminAvatarBtn'),
  userPhoto:       g('adminUserPhoto'),
  userName:        g('adminUserName'),
  dropdown:        g('adminTopbarDropdown'),
  signOut:         g('adminSignOut'),
  signInWallSlot:  g('topbarSignInBtnWall'),
  welcomeGoogle:   g('welcomeGoogleBtn'),
  welcomeClose:    g('welcomeCloseBtn'),
  welcomeGuest:    g('welcomeGuestBtn'),
  authWall:        g('adminAuthWall'),

  // ── Shell / Nav ──────────────────────────────────────────────────────────
  workspace:        g('adminWorkspace'),
  shell:            g('adminShell'),
  modules:          g('adminModules'),
  adminNav:         g('adminNav'),
  sidebarScrim:     g('sidebarScrim'),
  mobileSidebarBtn: g('mobileSidebarBtn'),
  toggleLibraryBtn: g('toggleArticleLibraryBtn'),

  // ── Article editor ───────────────────────────────────────────────────────
  list:            g('articleList'),
  listMain:        g('articleListMain'),
  totalCount:      g('articleTotalCount'),
  publishedCount:  g('articlePublishedCount'),
  draftCount:      g('articleDraftCount'),
  newBtn:          g('newArticleBtn'),
  id:              g('articleId'),
  statusField:     g('articleStatus'),
  contentType:     g('articleContentType'),
  icon:            g('articleIcon'),
  readMinutes:     g('articleReadMinutes'),
  order:           g('articleOrder'),
  title:           g('articleTitle'),
  subtitle:        g('articleSubtitle'),
  tags:            g('articleTags'),
  body:            g('articleBody'),
  detailsTitle:    g('articleDetailsTitle'),
  detailsSubtitle: g('articleDetailsSubtitle'),
  detailsTags:     g('articleDetailsTags'),
  detailsForm:     g('articleDetailsForm'),
  detailsBanner:   g('articleDetailsBanner'),
  detailsActionsBtn:  g('articleDetailsActionsBtn'),
  detailsActionsMenu: g('articleDetailsActionsMenu'),
  detailsCard:     g('articleDetailsCard'),
  detailsHead:     q('.sd-article-details-head'),
  editorHead:      q('.sd-admin-editor-head'),
  editDetailsBtn:  g('editArticleDetailsBtn'),
  sections:        g('articleSections'),
  sectionBuilder:  q('.sd-section-builder'),
  addSectionBtn:   g('addSectionBtn'),
  saveDetailsBtn:  g('saveArticleDetailsBtn'),
  detailsSaveStatus: g('articleDetailsSaveStatus'),
  systemStatus:    g('systemDesignStatus'),
  previewBtn:      g('previewBtn'),
  publishBtn:      g('publishBtn'),

  // ── Thumbnail ────────────────────────────────────────────────────────────
  thumbInput:       g('articleThumbInput'),
  thumbDropzone:    g('articleThumbDropzone'),
  thumbPreviewWrap: g('articleThumbPreviewWrap'),
  thumbPreview:     g('articleThumbPreview'),
  thumbRemoveBtn:   g('articleThumbRemoveBtn'),
  thumbStatus:      g('articleThumbStatus'),

  // ── Publish dialog ───────────────────────────────────────────────────────
  publishDialog:           g('publishReviewDialog'),
  publishSuccessPanel:     g('publishSuccessPanel'),
  publishSuccessTitle:     g('publishSuccessTitle'),
  publishReviewHeading:    g('publishReviewTitle'),
  publishReviewDescription:g('publishReviewDescription'),
  publishReviewTitle:      g('publishReviewArticleTitle'),
  publishReviewSubtitle:   g('publishReviewSubtitle'),
  publishReviewTags:       g('publishReviewTags'),
  publishReviewReadTime:   g('publishReviewReadTime'),
  publishReviewBody:       g('publishReviewBody'),
  publishPreviewPanel:     g('publishPreviewPanel'),
  publishSeoPanel:         g('publishSeoPanel'),
  publishSeoSlug:          g('publishSeoSlug'),
  publishSeoContentType:   g('publishSeoContentType'),
  publishSeoIcon:          g('publishSeoIcon'),
  publishSeoReadMinutes:   g('publishSeoReadMinutes'),
  publishSeoOrder:         g('publishSeoOrder'),
  publishOrderWarning:     g('publishOrderWarning'),
  publishOrderWarningText: g('publishOrderWarningText'),
  useNextOrderBtn:         g('useNextOrderBtn'),
  closePublishReviewBtn:   g('closePublishReviewBtn'),
  continueEditingBtn:      g('continueEditingBtn'),
  confirmPublishBtn:       g('confirmPublishBtn'),
  publishActionLabel:      g('publishActionLabel'),

  // ── Contact Policy ────────────────────────────────────────────────────────
  policyWorkspace:      g('contactPolicyWorkspace'),
  togglePolicyInfoBtn:  g('toggleContactPolicyInfoBtn'),
  policyMeta:           g('contactPolicyMeta'),
  privatePhone:         g('contactPrivatePhone'),
  allowedDomains:       g('contactAllowedDomains'),
  personalDomains:      g('contactPersonalDomains'),
  allowedEmails:        g('contactAllowedEmails'),
  blockedDomains:       g('contactBlockedDomains'),
  privatePhoneView:     g('contactPrivatePhoneView'),
  allowedDomainsView:   g('contactAllowedDomainsView'),
  personalDomainsView:  g('contactPersonalDomainsView'),
  allowedEmailsView:    g('contactAllowedEmailsView'),
  blockedDomainsView:   g('contactBlockedDomainsView'),
  testEmail:            g('contactTestEmail'),
  policyTest:           g('contactPolicyTestResult'),
  testPolicyBtn:        g('testContactPolicyBtn'),
  savePolicyBtn:        g('saveContactPolicyBtn'),

  // ── Article Settings ─────────────────────────────────────────────────────
  articleSettingsWorkspace: g('articleSettingsWorkspace'),
  articleSettingsList:      g('articleSettingsList'),
  articleSettingsStatus:    g('articleSettingsStatus'),
  autoFixArticleOrderBtn:   g('autoFixArticleOrderBtn'),
  saveArticleSettingsBtn:   g('saveArticleSettingsBtn'),

  // ── Media Library ────────────────────────────────────────────────────────
  mediaWorkspace:       g('mediaWorkspace'),
  mediaOrphansOnly:     g('mediaOrphansOnly'),
  refreshMediaAuditBtn: g('refreshMediaAuditBtn'),
  mediaAuditStatus:     g('mediaAuditStatus'),
  mediaAuditPanel:      g('mediaAuditPanel'),

  // ── Tier Settings ────────────────────────────────────────────────────────
  tierSettingsWorkspace: g('tierSettingsWorkspace'),
  tierSettingsPanel:     g('tierSettingsPanel'),
  tierSettingsStatus:    g('tierSettingsStatus'),
  freeTierList:          g('freeTierList'),
  premiumTierList:       g('premiumTierList'),
  saveTierSettingsBtn:   g('saveTierSettingsBtn'),

  // ── Metadata Config ──────────────────────────────────────────────────────
  metadataConfigWorkspace: g('metadataConfigWorkspace'),
  metadataConfigPanel:     g('metadataConfigPanel'),
  metadataConfigStatus:    g('metadataConfigStatus'),
  saveMetadataConfigBtn:   g('saveMetadataConfigBtn'),

  // ── Sponsorships ─────────────────────────────────────────────────────────
  sponsorshipsWorkspace: g('sponsorshipsWorkspace'),
  sponsorshipsPanel:     g('sponsorshipsPanel'),
  sponsorshipsStatus:    g('sponsorshipsStatus'),
  addSponsorBtn:         g('addSponsorBtn'),
  sponsorDrawer:         g('sponsorDrawer'),
  sponsorDrawerTitle:    g('sponsorDrawerTitle'),
  sponsorDrawerStatus:   g('sponsorDrawerStatus'),
  closeSponsorDrawerBtn: g('closeSponsorDrawerBtn'),
  saveSponsorBtn:        g('saveSponsorBtn'),
  deleteSponsorBtn:      g('deleteSponsorBtn'),

  // ── SEO Config ───────────────────────────────────────────────────────────
  seoConfigWorkspace:    g('seoConfigWorkspace'),
  seoConfigStatus:       g('seoConfigStatus'),
  saveSeoConfigBtn:      g('saveSeoConfigBtn'),
  seoSiteUrl:            g('seoSiteUrl'),
  seoSiteDescription:    g('seoSiteDescription'),
  seoOgImageUrl:         g('seoOgImageUrl'),
  seoJsonLd:             g('seoJsonLd'),
  seoSitemap:            g('seoSitemap'),
  seoHreflangFr:         g('seoHreflangFr'),
  seoRobotsNoindex:      g('seoRobotsNoindex'),
  seoDescCharCount:      g('seoDescCharCount'),
  seoAdsensePublisherId: g('seoAdsensePublisherId'),
  seoLlmsTxtEnabled:     g('seoLlmsTxtEnabled'),
  seoAiCrawlersAllowed:  g('seoAiCrawlersAllowed'),
  seoEeatSignalsEnabled: g('seoEeatSignalsEnabled'),
  seoSerpUrl:            g('seoSerpUrl'),
  seoSerpTitle:          g('seoSerpTitle'),
  seoSerpDesc:           g('seoSerpDesc'),

  // ── Atlas AI workspaces ──────────────────────────────────────────────────
  atlasAiConfigWorkspace:      g('atlasAiConfigWorkspace'),
  atlasEvaluationWorkspace:    g('atlasEvaluationWorkspace'),
  atlasObservabilityWorkspace: g('atlasObservabilityWorkspace'),
  atlasMonitoringWorkspace:    g('atlasMonitoringWorkspace'),

  // ── Atlas AI Configuration fields ─────────────────────────────────────────
  atlasConfigStatus:          g('atlasConfigStatus'),
  saveAtlasConfigBtn:         g('saveAtlasConfigBtn'),
  atlasModelRows:             g('atlasModelRows'),
  atlasModelSelectorVisible:  g('atlasModelSelectorVisible'),
  atlasFallbackModel:         g('atlasFallbackModel'),
  atlasTemperature:           g('atlasTemperature'),
  atlasTopP:                  g('atlasTopP'),
  atlasMaxOutputTokens:       g('atlasMaxOutputTokens'),
  atlasStreamingEnabled:      g('atlasStreamingEnabled'),
  atlasEmbeddingModel:        g('atlasEmbeddingModel'),
  atlasEmbeddingDimensions:   g('atlasEmbeddingDimensions'),
  atlasDistanceMetric:        g('atlasDistanceMetric'),
  atlasEmbeddingBatchSize:    g('atlasEmbeddingBatchSize'),
  atlasChunkSize:             g('atlasChunkSize'),
  atlasChunkOverlap:          g('atlasChunkOverlap'),
  atlasRagEnabled:            g('atlasRagEnabled'),
  atlasHybridSearch:          g('atlasHybridSearch'),
  atlasReranker:              g('atlasReranker'),
  atlasRagTopK:               g('atlasRagTopK'),
  atlasSimilarityThreshold:   g('atlasSimilarityThreshold'),
  atlasSystemPrompt:          g('atlasSystemPrompt'),
  atlasConversationMemory:    g('atlasConversationMemory'),
  atlasGuardrails:            g('atlasGuardrails'),
  atlasExecutionMode:         g('atlasExecutionMode'),
  atlasRoutingStrategy:       g('atlasRoutingStrategy'),
  atlasRoutingFallbackModel:  g('atlasRoutingFallbackModel'),
  atlasRecallThreshold:       g('atlasRecallThreshold'),
  atlasFaithfulnessThreshold: g('atlasFaithfulnessThreshold'),
  atlasTracingEnabled:        g('atlasTracingEnabled'),
  atlasCapturePrompts:        g('atlasCapturePrompts'),
  atlasCaptureChunks:         g('atlasCaptureChunks'),
  atlasCaptureTokens:         g('atlasCaptureTokens'),
  atlasBudgetCapInr:          g('atlasBudgetCapInr'),
  atlasDailyBudgetCapInr:     g('atlasDailyBudgetCapInr'),
  atlasTokenLimitPerQuery:    g('atlasTokenLimitPerQuery'),
  atlasBudgetAlertThreshold:  g('atlasBudgetAlertThreshold'),
  atlasPiiRedaction:          g('atlasPiiRedaction'),
  atlasInjectionDetection:    g('atlasInjectionDetection'),
  atlasContentModeration:     g('atlasContentModeration'),
  atlasRateLimitPerMinute:    g('atlasRateLimitPerMinute'),

  // ── Atlas AI Evaluation fields ────────────────────────────────────────────
  atlasEvalStatus:      g('atlasEvalStatus'),
  runEvalBtn:           g('runEvalBtn'),

  // Summary & metrics mount points (renderKpiCards targets)
  evalTabRetrievalBtn: g('evalTabRetrievalBtn'),
  evalTabGenerationBtn:g('evalTabGenerationBtn'),
  evalRetrievalPanel:  g('evalRetrievalPanel'),
  evalGenerationPanel: g('evalGenerationPanel'),
  evalSummaryMount:     g('evalSummaryMount'),
  evalMetricsWrap:      g('evalMetricsWrap'),
  evalMetricsMount:     g('evalMetricsMount'),
  evalGenerationSummaryMount:  g('evalGenerationSummaryMount'),
  evalGenerationMetricsWrap:   g('evalGenerationMetricsWrap'),
  evalGenerationMetricsMount:  g('evalGenerationMetricsMount'),

  // Threshold chips
  evalThresholdRecall:  g('evalThresholdRecall'),
  evalThresholdMrr:     g('evalThresholdMrr'),
  generationEvalStatusCard:  g('generationEvalStatusCard'),
  generationEvalStatusBadge: g('generationEvalStatusBadge'),
  generationEvalStatusText:  g('generationEvalStatusText'),

  // Progress + gate
  ragProgressWrap:      g('ragProgressWrap'),
  ragProgressBar:       g('ragProgressBar'),
  ragProgressLabel:     g('ragProgressLabel'),
  ragGateBadge:         g('ragGateBadge'),

  // Golden dataset (editable form table — stays custom)
  goldenDatasetBody:    g('goldenDatasetBody'),
  goldenDatasetEmpty:   g('goldenDatasetEmpty'),
  goldenDatasetStatus:  g('goldenDatasetStatus'),
  addGoldenRowBtn:       g('addGoldenRowBtn'),
  saveGoldenDatasetBtn:  g('saveGoldenDatasetBtn'),
  resetGoldenDatasetBtn: g('resetGoldenDatasetBtn'),
  goldenDatasetSearch:   g('goldenDatasetSearch'),
  goldenDatasetFilterBtn:g('goldenDatasetFilterBtn'),

  // renderDataTable mount points
  ragHistoryWrap:       g('ragHistoryWrap'),
  ragHistoryMount:      g('ragHistoryMount'),
  ragDetailWrap:        g('ragDetailWrap'),
  ragDetailMount:       g('ragDetailMount'),

  // ── Atlas Observability fields ────────────────────────────────────────────
  atlasObservabilityStatus: g('atlasObservabilityStatus'),
  obsRefreshBtn:        g('obsRefreshBtn'),

  // Summary KPIs (individual badge/value elements)
  obsTracingStatus:     g('obsTracingStatus'),
  obsPromptsStatus:     g('obsPromptsStatus'),
  obsChunksStatus:      g('obsChunksStatus'),
  obsTokensStatus:      g('obsTokensStatus'),
  obsTotalTraces:       g('obsTotalTraces'),
  obsAvgLatency:        g('obsAvgLatency'),
  obsErrorRate:         g('obsErrorRate'),
  obsCost24h:           g('obsCost24h'),

  // Request Traces (renderDataTable mount)
  obsTracesMount:       g('obsTracesMount'),
  obsTracesSearch:      g('obsTracesSearch'),
  obsTracesFilter:      g('obsTracesFilter'),

  // Trace Detail + Prompt Timeline + Chunks
  obsTraceDetailWrap:   g('obsTraceDetailWrap'),
  obsTraceDetailGrid:   g('obsTraceDetailGrid'),
  obsCloseTraceBtn:     g('obsCloseTraceBtn'),
  obsPromptTimelineWrap:g('obsPromptTimelineWrap'),
  obsPromptTimeline:    g('obsPromptTimeline'),
  obsChunksWrap:        g('obsChunksWrap'),
  obsChunksList:        g('obsChunksList'),

  // Model Routing
  obsRoutingGrid:       g('obsRoutingGrid'),
  obsRoutingEmpty:      g('obsRoutingEmpty'),

  // Token & Cost Analytics
  obsTokenStatsIn:      g('obsTokenStatsIn'),
  obsTokenStatsOut:     g('obsTokenStatsOut'),
  obsTokenStatsCost:    g('obsTokenStatsCost'),
  obsTokenStatsAvg:     g('obsTokenStatsAvg'),
  obsCostBarList:       g('obsCostBarList'),

  // Latency Breakdown
  obsLatencyGrid:       g('obsLatencyGrid'),
  obsLatencyEmpty:      g('obsLatencyEmpty'),

  // User Feedback (KPI els + renderDataTable mount)
  obsFeedbackPositive:     g('obsFeedbackPositive'),
  obsFeedbackNegative:     g('obsFeedbackNegative'),
  obsFeedbackSatisfaction: g('obsFeedbackSatisfaction'),
  obsFeedbackMount:        g('obsFeedbackMount'),

  // ── AI Monitoring fields ──────────────────────────────────────────────────
  atlasMonitoringStatus: g('atlasMonitoringStatus'),
  monRefreshBtn:         g('monRefreshBtn'),

  // ① renderKpiCards mount
  monInfraMount:    g('monInfraMount'),

  // ② Service Health (custom card grid — JS-rendered)
  monServicesGrid:  g('monServicesGrid'),
  monServicesEmpty: g('monServicesEmpty'),

  // ③ Resource Utilization (progress bars stay custom — no table)
  monCpuBar:             g('monCpuBar'),
  monCpuPct:             g('monCpuPct'),
  monMemBar:             g('monMemBar'),
  monMemPct:             g('monMemPct'),
  monHeapBar:            g('monHeapBar'),
  monHeapPct:            g('monHeapPct'),
  monBudgetMonthlyBar:   g('monBudgetMonthlyBar'),
  monBudgetMonthlyLabel: g('monBudgetMonthlyLabel'),
  monBudgetDailyBar:     g('monBudgetDailyBar'),
  monBudgetDailyLabel:   g('monBudgetDailyLabel'),

  // ④ renderKpiCards mount
  monPerfMount:     g('monPerfMount'),

  // ⑤ renderDataTable mount
  monDepsMount:     g('monDepsMount'),

  // ⑥ Alerts & Incidents
  monActiveAlertCount: g('monActiveAlertCount'),
  monAckAllBtn:        g('monAckAllBtn'),
  monAlertsList:       g('monAlertsList'),
  monAlertsEmpty:      g('monAlertsEmpty'),
  monIncidentsMount:   g('monIncidentsMount'),

  // ⑦ Historical Metrics
  monHistoryGrid:  g('monHistoryGrid'),
  monHistoryEmpty: g('monHistoryEmpty'),

  // ── Analytics ─────────────────────────────────────────────────────────────
  analyticsWorkspace:  g('analyticsWorkspace'),
  analyticsMonth:      g('analyticsMonth'),
  refreshAnalyticsBtn: g('refreshAnalyticsBtn'),
  analyticsStatus:     g('analyticsStatus'),
  analyticsPanel:      g('analyticsPanel'),

  // ── Subscriptions ─────────────────────────────────────────────────────────
  subscriptionsWorkspace:  g('subscriptionsWorkspace'),
  refreshSubscriptionsBtn: g('refreshSubscriptionsBtn'),
  subscriptionsStatus:     g('subscriptionsStatus'),
  subscriptionsPanel:      g('subscriptionsPanel'),
};

/**
 * Re-resolves the topbar/auth node references above.
 *
 * Call once, immediately after `renderAppHeader('#sharedTopbar', ...)` has
 * run — that's the point those nodes first exist. Everything downstream
 * (auth.js's `if (els.topbarSignIn) ...` guards, click listeners wired in
 * admin.js) reads from this same shared `els` object, so mutating it here
 * in place is enough; no other module needs to know this happened.
 */
export function refreshTopbarEls() {
  Object.assign(els, {
    topbarSignIn:   g('adminTopbarSignInBtn'),
    topbarUser:     g('adminTopbarUser'),
    avatarBtn:      g('adminAvatarBtn'),
    userPhoto:      g('adminUserPhoto'),
    userName:       g('adminUserName'),
    dropdown:       g('adminTopbarDropdown'),
    signOut:        g('adminSignOut'),
    signInWallSlot: g('topbarSignInBtnWall'),
  });
}
