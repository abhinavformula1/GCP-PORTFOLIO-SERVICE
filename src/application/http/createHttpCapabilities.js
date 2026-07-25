'use strict';

const { assertDependencies, assertPort } = require('../ports/assert');

function pickPort(port, path, names) {
  assertPort(port, path, names);
  const capability = {};
  for (const name of names) capability[name] = port[name];
  return Object.freeze(capability);
}

function createHttpCapabilities(dependencies) {
  assertDependencies(dependencies, 'application.httpCapabilities', {
    atlasRepository: 'value',
    articlesRepository: 'value',
    ragAdminRepository: 'value',
    adminConfig: 'value',
    pdfGenerator: 'value',
  });
  const {
    atlasRepository, articlesRepository, ragAdminRepository, adminConfig, pdfGenerator,
  } = dependencies;

  const atlasPersistence = pickPort(atlasRepository, 'application.httpCapabilities.atlas', [
    'getActiveConversation',
    'appendTurn',
    'appendUsageEvent',
    'getCacheEntry',
    'saveCacheEntry',
    'getUsageSummary',
    'clearActiveConversation',
  ]);
  const articleContent = pickPort(articlesRepository, 'application.httpCapabilities.articles', [
    'listPublishedArticles',
    'getArticle',
    'listArticles',
    'upsertArticle',
    'deleteArticle',
  ]);
  const ragAdministration = pickPort(ragAdminRepository, 'application.httpCapabilities.ragAdmin', [
    'getGoldenDatasetRows',
    'resetGoldenDataset',
    'saveGoldenDatasetRows',
    'saveRagEvalRun',
    'listRagEvalRuns',
    'deleteRagEvalRun',
  ]);
  const configuration = pickPort(adminConfig, 'application.httpCapabilities.adminConfig', [
    'getTierConfig',
    'getSeoConfig',
    'upsertSeoConfig',
    'getComponentRegistry',
    'upsertComponentRegistry',
    'upsertTierConfig',
    'upsertContactPolicyConfig',
    'getAtlasConfig',
    'patchAtlasObservabilityConfig',
    'upsertAtlasConfig',
  ]);
  const pdfGeneratorPort = pickPort(pdfGenerator, 'application.httpCapabilities.pdfGenerator', ['generatePdf', 'checkChrome']);
  const pdfArticles = pickPort(articlesRepository, 'application.httpCapabilities.pdfArticles', ['getArticle']);
  const pdf = Object.freeze({
    generatePdf: pdfGeneratorPort.generatePdf,
    checkChrome: pdfGeneratorPort.checkChrome,
    getArticle: pdfArticles.getArticle,
  });
  const print = pickPort(articlesRepository, 'application.httpCapabilities.print', ['getArticle']);

  return Object.freeze({
    atlasPersistence,
    articleContent,
    ragAdministration,
    configuration,
    pdf,
    print,
  });
}

module.exports = { createHttpCapabilities, pickPort };
