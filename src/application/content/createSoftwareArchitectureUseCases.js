'use strict';

const { GOLDEN_SET } = require('../../domain/rag/goldenSet');
const { SYSTEM_PROMPT } = require('../../domain/atlas/persona');
const { ValidationError } = require('../../domain/errors');
const { assertDependencies } = require('../ports/assert');

function createSoftwareArchitectureUseCases(dependencies) {
  assertDependencies(dependencies, 'application.softwareArchitecture', {
    configuration: [
      'getTierConfig', 'getSeoConfig', 'upsertSeoConfig', 'getComponentRegistry',
      'upsertComponentRegistry', 'upsertTierConfig', 'upsertContactPolicyConfig',
      'getAtlasConfig', 'patchAtlasObservabilityConfig', 'upsertAtlasConfig',
    ],
    articles: ['listPublishedArticles', 'getArticle', 'listArticles', 'upsertArticle', 'deleteArticle'],
    ragAdmin: [
      'getGoldenDatasetRows', 'resetGoldenDataset', 'saveGoldenDatasetRows',
      'saveRagEvalRun', 'listRagEvalRuns', 'deleteRagEvalRun',
    ],
    billing: ['getUserSubscriptionEntitlement'],
    contactPolicy: ['getContactPolicyConfig', 'normaliseDomains', 'normaliseEmails'],
    sponsorships: ['listActiveSponsorships', 'listSponsorships', 'upsertSponsorship', 'deleteSponsorship'],
    localPreviewContent: ['getLocalPreviewArticles', 'getLocalPreviewArticle'],
    indexArticle: 'function',
    removeArticleChunks: 'function',
    evaluateRetrieval: 'function',
    generateChatResponse: 'function',
    runtimeMetrics: 'function',
    clock: ['now'],
    logger: 'value',
    settings: 'value',
  });
  const {
    configuration, articles, ragAdmin, billing, contactPolicy, sponsorships,
    localPreviewContent, indexArticle, removeArticleChunks, evaluateRetrieval,
    generateChatResponse, runtimeMetrics, clock, logger, settings,
  } = dependencies;

  function premiumSafe(article) {
    if (!article || typeof article !== 'object') return article;
    const output = { ...article, blocks: [] };
    if (output.en && typeof output.en === 'object') output.en = { ...output.en, body: '' };
    if (output.fr && typeof output.fr === 'object') output.fr = { ...output.fr, body: '' };
    if (Object.prototype.hasOwnProperty.call(output, 'bodyHtml')) output.bodyHtml = '';
    return output;
  }

  async function entitlement(uid, forceLocked) {
    if (forceLocked) return false;
    if (settings.localPreview) return true;
    if (!uid) return false;
    try { return !!(await billing.getUserSubscriptionEntitlement(uid)).active; }
    catch (_) { return false; }
  }

  function applyAccess(article, access) {
    const premium = String(article?.tier || '').trim().toLowerCase() === 'premium';
    const hasAccess = !premium || access;
    return { ...(hasAccess ? article : premiumSafe(article)), hasAccess };
  }

  async function getTierConfig() {
    try { return { success: true, config: await configuration.getTierConfig() }; }
    catch (error) {
      logger.warn('[tier-config] Firestore read failed:', error.message);
      return { success: true, config: { free: { items: [] }, premium: { items: [] } } };
    }
  }
  async function getSeoConfig() {
    try { return { success: true, config: await configuration.getSeoConfig() }; }
    catch (error) {
      logger.warn('[seo-config] Firestore read failed:', error.message);
      return { success: true, config: {} };
    }
  }
  async function saveSeoConfig(input) {
    await configuration.upsertSeoConfig(input);
    return { success: true };
  }
  async function getComponentRegistry() {
    try { return { success: true, enabled: await configuration.getComponentRegistry() }; }
    catch (error) {
      logger.warn('[component-registry] Firestore read failed:', error.message);
      return { success: true, enabled: {} };
    }
  }
  async function saveComponentRegistry(enabled) {
    await configuration.upsertComponentRegistry(enabled);
    return { success: true };
  }
  async function saveTierConfig(input) {
    await configuration.upsertTierConfig(input);
    return { success: true };
  }

  async function listPublished({ uid, forceLocked }) {
    const access = await entitlement(uid, forceLocked && settings.localPreview);
    try {
      const rows = await articles.listPublishedArticles();
      return {
        body: { success: true, articles: (Array.isArray(rows) ? rows : []).map((article) => applyAccess(article, access)) },
        cacheControl: uid ? 'private, no-store' : 'public, max-age=60, s-maxage=300',
      };
    } catch (error) {
      logger.warn('[system-design] Firestore list failed:', error.message);
      if (settings.localPreview) {
        return {
          body: {
            success: true,
            articles: localPreviewContent.getLocalPreviewArticles().map((article) => applyAccess(article, !forceLocked)),
            degraded: true,
            degradedReason: 'FIRESTORE_NOT_CONFIGURED',
          },
          cacheControl: uid ? 'private, no-store' : 'public, max-age=60, s-maxage=300',
        };
      }
      return { body: { success: true, articles: [], degraded: true }, cacheControl: 'public, max-age=60, s-maxage=300' };
    }
  }

  async function getPublished({ id, uid, forceLocked }) {
    try {
      const article = await articles.getArticle(id);
      if (!article) return { statusCode: 404, body: { success: false, error: 'Article not found.' } };
      const premium = String(article?.tier || '').trim().toLowerCase() === 'premium';
      const access = premium ? await entitlement(uid, forceLocked && settings.localPreview) : true;
      return {
        statusCode: 200,
        body: { success: true, article: premium ? applyAccess(article, access) : article },
        cacheControl: premium && uid ? 'private, no-store' : 'public, max-age=60, s-maxage=300',
      };
    } catch (error) {
      logger.warn('[system-design] Firestore read failed:', error.message);
      if (!settings.localPreview) {
        return { statusCode: 503, body: { success: false, error: 'System Design content is unavailable.' } };
      }
      const article = localPreviewContent.getLocalPreviewArticle(id);
      if (!article) return { statusCode: 404, body: { success: false, error: 'Article not found.' } };
      const premium = String(article?.tier || '').trim().toLowerCase() === 'premium';
      return {
        statusCode: 200,
        body: { success: true, article: premium ? applyAccess(article, !forceLocked) : article, degraded: true },
      };
    }
  }

  async function listAdminArticles() {
    try { return { success: true, articles: await articles.listArticles() }; }
    catch (error) {
      if (!settings.localPreview) throw error;
      logger.warn('[admin] Firestore unavailable in local preview:', error.message);
      return { success: true, articles: [], degraded: true, degradedReason: 'FIRESTORE_NOT_CONFIGURED' };
    }
  }
  function adminIdentity(email) {
    return { success: true, isAdmin: settings.allowedAdminEmails.includes(String(email || '').toLowerCase()) };
  }
  function localPreview() {
    return { success: true, enabled: settings.localPreview };
  }
  async function getContactPolicy() {
    return { success: true, policy: await contactPolicy.getContactPolicyConfig() };
  }

  function domains(values) {
    if (!Array.isArray(values)) throw new ValidationError('Domains must be an array.');
    const clean = contactPolicy.normaliseDomains(values);
    if (clean.length > 50) throw new ValidationError('Domain lists cannot exceed 50 entries.');
    if (clean.some((domain) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes('..'))) {
      throw new ValidationError('Domains must be valid domain names.');
    }
    return [...new Set(clean)];
  }
  function emails(values) {
    if (!Array.isArray(values)) throw new ValidationError('Allowed emails must be an array.');
    const clean = contactPolicy.normaliseEmails(values);
    if (clean.length > 50) throw new ValidationError('Allowed email list cannot exceed 50 entries.');
    if (clean.some((email) => !/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email))) {
      throw new ValidationError('Allowed emails must be valid email addresses.');
    }
    return [...new Set(clean)];
  }
  function phone(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length > 40) throw new ValidationError('Private phone is too long.');
    if (!/^[+\d\s().-]+$/.test(raw)) throw new ValidationError('Private phone contains invalid characters.');
    if (raw.replace(/[^\d]/g, '').length < 8) throw new ValidationError('Private phone must contain at least 8 digits.');
    return raw;
  }
  function phoneConfigured(value) {
    const raw = String(value || '').trim();
    return !!raw && !/[xX]/.test(raw) && raw.replace(/[^\d]/g, '').length >= 8;
  }
  async function saveContactPolicy(input, userEmail) {
    const policy = {
      privatePhone: phone(input?.privatePhone),
      allowedDomains: domains(input?.allowedDomains || []),
      personalDomains: domains(input?.personalDomains || []),
      allowedEmails: emails(input?.allowedEmails || []),
      blockedDomains: domains(input?.blockedDomains || []),
      updatedBy: userEmail,
    };
    if (settings.localDevelopment) {
      return {
        success: true,
        policy: {
          source: 'local-dev', ...policy, updatedAt: clock.now(),
          privatePhoneConfigured: phoneConfigured(policy.privatePhone || settings.privatePhone),
        },
      };
    }
    const saved = await configuration.upsertContactPolicyConfig(policy);
    return {
      success: true,
      policy: {
        source: 'firestore',
        privatePhone: saved.privatePhone || '',
        allowedDomains: saved.allowedDomains,
        personalDomains: saved.personalDomains,
        allowedEmails: saved.allowedEmails,
        blockedDomains: saved.blockedDomains,
        updatedBy: saved.updatedBy,
        updatedAt: saved.updatedAt,
        privatePhoneConfigured: phoneConfigured(saved.privatePhone || settings.privatePhone),
      },
    };
  }

  function stripHeading(text, label) {
    const escaped = String(label || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped
      ? String(text || '').trim().replace(new RegExp(`^(?:#{1,6}\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*\\n+`, 'i'), '').trim()
      : String(text || '').trim();
  }
  async function writingAssist(input) {
    if (settings.localPreview) {
      const text = String(input.sectionBody || '').trim().replace(/\s+/g, ' ');
      const suggestion = input.mode === 'concise'
        ? text.split('. ').slice(0, 2).join('. ') + (text.includes('.') ? '.' : '')
        : input.mode === 'grammar'
          ? text.replace(/\bwa[mn]\b/gi, 'was').replace(/\bfro\b/gi, 'for').replace(/\s+/g, ' ')
          : `${text}\n\nThis section now reads as a clearer system-design narrative while preserving the original technical decision and risk focus.`;
      return { success: true, suggestion: stripHeading(suggestion, input.sectionLabel), usage: null, source: 'local-preview' };
    }
    const instruction = input.mode === 'concise'
      ? 'Make the section shorter and sharper. Remove repetition. Keep only the strongest points.'
      : input.mode === 'grammar'
        ? 'Fix grammar, spelling, punctuation, and flow. Do not change the technical meaning or add new content.'
        : 'Improve clarity, structure, and executive readability while keeping it technically accurate.';
    const result = await generateChatResponse({
      model: 'flash-lite',
      systemPrompt: [
        'You are an expert system-design editor for an enterprise engineering portfolio.',
        'Rewrite only the provided article section.',
        'Do not include the section heading or article title in the response.',
        'Preserve the author intent and technical facts. Do not invent systems, metrics, vendors, claims, or diagrams.',
        'Return plain Markdown only. No HTML. No preamble. No code fences unless the user provided code.',
        'Prefer crisp sentences, clear bullets where useful, and language suitable for Google, Salesforce, Meta, or Palantir reviewers.',
      ].join(' '),
      userMessage: [
        `Article title: ${input.articleTitle || 'Untitled article'}`,
        `Article subtitle: ${input.articleSubtitle || 'No subtitle'}`,
        `Section: ${input.sectionLabel || input.sectionType}`,
        '', 'Current section draft:', input.sectionBody, '', instruction,
      ].join('\n'),
      generationConfig: { temperature: 0.35, topP: 0.85, maxOutputTokens: 900 },
    });
    return { success: true, suggestion: stripHeading(result.text, input.sectionLabel), usage: result.usage, source: 'llm' };
  }

  async function saveArticle(previousIdInput, input, userEmail) {
    const previousId = String(previousIdInput || '').trim();
    const article = { ...input, id: String(input.id || previousId).trim() };
    if (!article.contentType) article.contentType = 'system-design';
    if (settings.localPreview) {
      return {
        success: true,
        article: { ...article, updatedAt: clock.now(), updatedBy: userEmail },
        version: 'local-preview',
        source: 'local-preview',
      };
    }
    const result = await articles.upsertArticle(article, { publishedBy: userEmail });
    if (previousId && previousId !== result.id) {
      await articles.deleteArticle(previousId);
      removeArticleChunks(previousId).catch((error) => logger.warn('[rag] removeArticleChunks (id-change) failed:', previousId, error.message));
    }
    const saved = await articles.getArticle(result.id);
    const action = String(saved?.status || '').toLowerCase() === 'published'
      ? indexArticle(saved)
      : removeArticleChunks(saved.id);
    action.catch((error) => logger.warn('[rag] background indexing failed:', saved.id, error.message));
    return { success: true, article: saved, version: result.version };
  }

  async function activeSponsors(placement) {
    try { return { success: true, sponsors: await sponsorships.listActiveSponsorships(placement || null) }; }
    catch (error) {
      logger.warn('[sponsorships] list active failed:', error.message);
      return { success: true, sponsors: [] };
    }
  }
  async function allSponsors() { return { success: true, sponsors: await sponsorships.listSponsorships() }; }
  async function saveSponsor(id, input) {
    return { success: true, sponsor: await sponsorships.upsertSponsorship(id || null, input) };
  }
  async function deleteSponsor(id) {
    await sponsorships.deleteSponsorship(id);
    return { success: true };
  }
  function systemHealth() { return { success: true, ...runtimeMetrics() }; }

  async function atlasConfig() {
    const config = await configuration.getAtlasConfig();
    return {
      success: true,
      config,
      meta: {
        generationEvalsReady: settings.geminiReady,
        generationEvalsReason: settings.geminiReady
          ? 'Gemini-backed offline generation evals are available for new runs.'
          : 'Gemini API key is missing in this environment, so generation evals cannot run yet.',
        langsmithReady: settings.langsmithReady,
        langsmithReason: settings.langsmithReady
          ? 'LangSmith is configured in this environment. You can enable/disable tracing from the admin UI without redeploying.'
          : 'LangSmith is not configured in this environment. Set LANGSMITH_API_KEY and LANGSMITH_TRACING=true in Cloud Run to enable LangSmith tracing.',
      },
    };
  }
  async function saveAtlasObservability(enabled) {
    return {
      success: true,
      config: await configuration.patchAtlasObservabilityConfig({ langsmithTracingEnabled: enabled === true }),
    };
  }
  async function saveAtlasConfig(input) {
    const boolean = (value) => value === true || value === 'true';
    const number = (value) => value != null ? Number(value) : undefined;
    await configuration.upsertAtlasConfig({
      enabledModels: input.enabledModels,
      defaultModel: input.defaultModel,
      fallbackModel: typeof input.fallbackModel === 'string' ? input.fallbackModel : '',
      modelOptions: input.modelOptions,
      temperature: number(input.temperature),
      topP: number(input.topP),
      maxOutputTokens: number(input.maxOutputTokens),
      streamingEnabled: input.streamingEnabled != null ? boolean(input.streamingEnabled) : undefined,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: number(input.embeddingDimensions),
      distanceMetric: input.distanceMetric,
      embeddingBatchSize: number(input.embeddingBatchSize),
      chunkSize: number(input.chunkSize),
      chunkOverlap: number(input.chunkOverlap),
      splitterType: input.splitterType,
      ragEnabled: boolean(input.ragEnabled),
      ragTopK: number(input.ragTopK),
      hybridSearchEnabled: input.hybridSearchEnabled != null ? boolean(input.hybridSearchEnabled) : undefined,
      rerankerEnabled: input.rerankerEnabled != null ? boolean(input.rerankerEnabled) : undefined,
      similarityThreshold: number(input.similarityThreshold),
      keywordSearchProvider: input.keywordSearchProvider,
      fusionStrategy: input.fusionStrategy,
      rrfK: number(input.rrfK),
      rerankerProvider: input.rerankerProvider,
      rerankerModel: input.rerankerModel,
      rerankerTopN: number(input.rerankerTopN),
      systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt : undefined,
      guardrailsEnabled: input.guardrailsEnabled != null ? boolean(input.guardrailsEnabled) : undefined,
      conversationMemoryTurns: number(input.conversationMemoryTurns),
      executionMode: input.executionMode,
      routingStrategy: input.routingStrategy,
      routingFallbackModel: input.routingFallbackModel,
      recallThreshold: number(input.recallThreshold),
      faithfulnessThreshold: number(input.faithfulnessThreshold),
      tracingEnabled: input.tracingEnabled != null ? boolean(input.tracingEnabled) : undefined,
      langsmithTracingEnabled: input.langsmithTracingEnabled != null ? boolean(input.langsmithTracingEnabled) : undefined,
      capturePrompts: input.capturePrompts != null ? boolean(input.capturePrompts) : undefined,
      captureChunks: input.captureChunks != null ? boolean(input.captureChunks) : undefined,
      captureTokens: input.captureTokens != null ? boolean(input.captureTokens) : undefined,
      budgetCapInr: number(input.budgetCapInr),
      dailyBudgetCapInr: number(input.dailyBudgetCapInr),
      tokenLimitPerQuery: number(input.tokenLimitPerQuery),
      budgetAlertThreshold: number(input.budgetAlertThreshold),
      piiRedactionEnabled: input.piiRedactionEnabled != null ? boolean(input.piiRedactionEnabled) : undefined,
      promptInjectionDetection: input.promptInjectionDetection != null ? boolean(input.promptInjectionDetection) : undefined,
      rateLimitPerMinute: number(input.rateLimitPerMinute),
      contentModerationEnabled: input.contentModerationEnabled != null ? boolean(input.contentModerationEnabled) : undefined,
      modelSelectorVisible: boolean(input.modelSelectorVisible),
    });
    return { success: true };
  }

  function fallbackRows() {
    return GOLDEN_SET.map((item) => ({
      question: item.question,
      expectedArticleId: item.expectedArticleId,
      expectedAnswer: item.expectedAnswer || '',
    }));
  }
  async function goldenDataset() {
    try {
      const rows = await ragAdmin.getGoldenDatasetRows();
      return rows ? { success: true, rows } : { success: true, rows: fallbackRows(), source: 'fallback' };
    } catch (error) {
      logger.warn('[golden-dataset] Firestore error, using fallback:', error.message);
      return { success: true, rows: fallbackRows(), source: 'fallback' };
    }
  }
  async function resetGoldenDataset() {
    try {
      await ragAdmin.resetGoldenDataset();
      return { success: true, message: 'Golden dataset reset to defaults.' };
    } catch (_) {
      return { success: true, message: 'Reset complete (fallback will be used).' };
    }
  }
  async function saveGoldenDataset(rows) {
    if (!Array.isArray(rows)) return { statusCode: 400, body: { success: false, error: 'rows must be an array.' } };
    const clean = rows.filter((row) => row && typeof row.question === 'string' && row.question.trim()).map((row) => ({
      question: String(row.question).trim(),
      expectedArticleId: String(row.expectedArticleId || '').trim(),
      expectedAnswer: String(row.expectedAnswer || '').trim(),
    }));
    if (!clean.length) return { statusCode: 400, body: { success: false, error: 'At least one valid question is required.' } };
    try {
      await ragAdmin.saveGoldenDatasetRows(clean);
      return { statusCode: 200, body: { success: true, count: clean.length } };
    } catch (error) {
      return { statusCode: 500, body: { success: false, error: error.message } };
    }
  }

  async function runEvaluation({ kInput, modeInput }, onProgress) {
    const k = Math.max(1, Math.min(Number(kInput) || 5, 20));
    const mode = String(modeInput || 'golden');
    let golden = GOLDEN_SET;
    try { golden = await ragAdmin.getGoldenDatasetRows() || golden; } catch (_) {}
    const evaluationSet = mode === 'smoke' ? golden.slice(0, 10) : golden;
    const config = await configuration.getAtlasConfig().catch(() => null);
    const generationConfig = {};
    if (typeof config?.temperature === 'number') generationConfig.temperature = config.temperature;
    if (typeof config?.topP === 'number') generationConfig.topP = config.topP;
    if (typeof config?.maxOutputTokens === 'number') generationConfig.maxOutputTokens = config.maxOutputTokens;
    const { metrics, details } = await evaluateRetrieval(evaluationSet, {
      k,
      delayMs: 300,
      generationEval: {
        enabled: true,
        baseSystemPrompt: typeof config?.systemPrompt === 'string' && config.systemPrompt.trim() ? config.systemPrompt.trim() : SYSTEM_PROMPT,
        answerModel: config?.defaultModel || 'flash-lite',
        answerGenerationConfig: generationConfig,
        judgeModel: config?.routingFallbackModel || 'flash-lite',
      },
      onProgress({ index, total, question, hit, rank }) {
        onProgress({ index, total, question, hit, rank });
      },
    });
    const passed = Number(metrics?.recallAtK || 0) >= (typeof config?.recallThreshold === 'number' ? config.recallThreshold : 0.80)
      && Number(metrics?.mrr || 0) >= (typeof config?.faithfulnessThreshold === 'number' ? config.faithfulnessThreshold : 0.70);
    let savedRun = null;
    try { savedRun = await ragAdmin.saveRagEvalRun({ k, mode, metrics, details, passed }); }
    catch (error) { logger.error('[rag-eval] failed to save run history:', error.message); }
    return { metrics, details, passed, savedRun };
  }

  async function *reindex(isAborted) {
    try {
      const rows = await articles.listPublishedArticles();
      for (let index = 0; index < rows.length; index += 1) {
        if (isAborted()) break;
        const article = rows[index];
        try {
          const output = await indexArticle(article);
          yield {
            event: 'progress',
            data: {
              index: index + 1,
              total: rows.length,
              articleId: article?.id ? String(article.id) : '',
              title: article?.en?.title ? String(article.en.title) : '',
              indexedChunks: typeof output?.indexed === 'number' ? output.indexed : null,
            },
          };
        } catch (error) {
          yield { event: 'error', data: { message: `Reindex failed for ${article?.id || 'article'}: ${error.message || 'error'}` } };
        }
      }
    } catch (error) {
      yield { event: 'error', data: { message: error.message || 'Reindex failed.' } };
    }
  }
  async function evaluationHistory(limitInput) {
    const limit = Math.max(1, Math.min(Number(limitInput) || 10, 50));
    try { return { statusCode: 200, body: { success: true, runs: await ragAdmin.listRagEvalRuns(limit) } }; }
    catch (error) { return { statusCode: 500, body: { success: false, error: error.message } }; }
  }
  async function deleteEvaluation(idInput) {
    const id = String(idInput || '');
    if (!id) return { statusCode: 400, body: { success: false, error: 'Missing run id.' } };
    try {
      await ragAdmin.deleteRagEvalRun(id);
      return { statusCode: 200, body: { success: true } };
    } catch (error) {
      return { statusCode: 500, body: { success: false, error: error.message } };
    }
  }

  return Object.freeze({
    getTierConfig, getSeoConfig, saveSeoConfig, getComponentRegistry, saveComponentRegistry,
    saveTierConfig, listPublished, getPublished, listAdminArticles, adminIdentity, localPreview,
    getContactPolicy, saveContactPolicy, writingAssist, saveArticle, activeSponsors, allSponsors,
    saveSponsor, deleteSponsor, systemHealth, atlasConfig, saveAtlasObservability, saveAtlasConfig,
    goldenDataset, resetGoldenDataset, saveGoldenDataset, runEvaluation, reindex,
    evaluationHistory, deleteEvaluation,
  });
}

module.exports = { createSoftwareArchitectureUseCases };
