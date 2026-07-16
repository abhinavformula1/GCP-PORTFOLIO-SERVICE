/**
 * Atlas AI Configuration module — all 10 accordion sections.
 *
 * S — load/save the Firestore atlasConfig document; render the form.
 * O — adding a new field only requires editing this file.
 * D — depends on authedJson/setSectionStatus from http.js; never on nav.
 */

import { authedJson, setSectionStatus } from '../../http.js';

export const ATLAS_ALL_MODELS = {
  'flash-lite': { label: 'Flash-Lite', detail: 'Gemini 2.5 Flash-Lite · Fast & economical · Default' },
  'flash':      { label: 'Flash',      detail: 'Gemini 2.5 Flash · More detailed · Higher cost'  },
};

/** Exposed so evaluation.js can read thresholds without a second fetch. */
export let atlasConfig = null;

export async function renderAtlasConfig(els) {
  setSectionStatus(els.atlasConfigStatus, 'Loading…', 'info');
  try {
    const data = await authedJson('/api/admin/atlas/config');
    atlasConfig = data.config || {};
    _wireConfigAccordion();
    _wireConfigInputs();
    _fillForm(els, atlasConfig);
    setSectionStatus(els.atlasConfigStatus, '', '');
  } catch (err) {
    setSectionStatus(els.atlasConfigStatus, 'Failed to load Atlas config: ' + err.message, 'error');
  }
}

export async function saveAtlasConfig(els) {
  setSectionStatus(els.atlasConfigStatus, 'Saving…', 'info');
  els.saveAtlasConfigBtn.disabled = true;
  try {
    const toggles = els.atlasModelRows.querySelectorAll('.sd-atlas-model-toggle');
    const enabledModels = Array.from(toggles).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.dataset.key; });
    if (!enabledModels.length) { setSectionStatus(els.atlasConfigStatus, 'At least one model must be enabled.', 'error'); return; }
    const defaultRadio = els.atlasModelRows.querySelector('input[name="atlasDefaultModel"]:checked');
    const defaultModel = defaultRadio ? defaultRadio.value : enabledModels[0];
    const splitterRadio = document.querySelector('input[name="atlasSplitterType"]:checked');
    const payload = _buildPayload(els, enabledModels, defaultModel, splitterRadio);
    await authedJson('/api/admin/atlas/config', { method: 'PUT', body: JSON.stringify(payload) });
    atlasConfig = payload;
    setSectionStatus(els.atlasConfigStatus, 'Atlas settings saved.', 'success');
  } catch (err) {
    setSectionStatus(els.atlasConfigStatus, 'Save failed: ' + err.message, 'error');
  } finally {
    els.saveAtlasConfigBtn.disabled = false;
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _fillForm(els, cfg) {
  // Model rows
  els.atlasModelRows.innerHTML = '';
  const enabled      = Array.isArray(cfg.enabledModels) ? cfg.enabledModels : ['flash-lite', 'flash'];
  const defaultModel = cfg.defaultModel || 'flash-lite';
  Object.keys(ATLAS_ALL_MODELS).forEach(function (key) {
    const meta = ATLAS_ALL_MODELS[key];
    const row  = document.createElement('div');
    row.className = 'sd-atlas-model-row';
    row.innerHTML = [
      '<div class="sd-atlas-model-info"><strong>' + meta.label + '</strong><span>' + meta.detail + '</span></div>',
      '<div class="sd-atlas-model-controls">',
      '  <label class="sd-atlas-model-select sd-atlas-default-label" title="Set as default">',
      '    <input type="radio" name="atlasDefaultModel" value="' + key + '"' + (defaultModel === key ? ' checked' : '') + '>',
      '    <span>Default</span>',
      '  </label>',
      '  <label class="sd-toggle-switch" aria-label="Enable ' + meta.label + '">',
      '    <input type="checkbox" class="sd-atlas-model-toggle" data-key="' + key + '"' + (enabled.includes(key) ? ' checked' : '') + '>',
      '    <span class="sd-toggle-slider"></span>',
      '  </label>',
      '</div>',
    ].join('');
    els.atlasModelRows.appendChild(row);
  });
  _syncModelCardState(els.atlasModelRows);

  // ① LLM
  _setV(els.atlasModelSelectorVisible, 'checked', cfg.modelSelectorVisible !== false);
  _setV(els.atlasFallbackModel,       'value',   cfg.fallbackModel || '');
  _setV(els.atlasTemperature,         'value',   cfg.temperature    != null ? cfg.temperature    : 0.35);
  _setV(els.atlasTopP,                'value',   cfg.topP           != null ? cfg.topP           : 0.85);
  _setV(els.atlasMaxOutputTokens,     'value',   cfg.maxOutputTokens!= null ? cfg.maxOutputTokens: 900);
  _setV(els.atlasStreamingEnabled,    'checked', cfg.streamingEnabled !== false);
  _syncLinkedInput('atlasTemperature');
  _syncLinkedInput('atlasTopP');
  _syncLinkedInput('atlasMaxOutputTokens');
  // ② Embedding
  _setV(els.atlasEmbeddingModel,      'value',   cfg.embeddingModel  || 'gemini-embedding-001');
  _setV(els.atlasEmbeddingDimensions, 'value',   cfg.embeddingDimensions || 768);
  _setV(els.atlasDistanceMetric,      'value',   cfg.distanceMetric  || 'COSINE');
  _setV(els.atlasEmbeddingBatchSize,  'value',   cfg.embeddingBatchSize != null ? cfg.embeddingBatchSize : 5);
  // ③ Chunking
  _setV(els.atlasChunkSize,           'value',   cfg.chunkSize   != null ? cfg.chunkSize   : 4000);
  _setV(els.atlasChunkOverlap,        'value',   cfg.chunkOverlap!= null ? cfg.chunkOverlap: 200);
  const splitterEl = document.querySelector('input[name="atlasSplitterType"][value="' + (cfg.splitterType || 'recursive') + '"]');
  if (splitterEl) splitterEl.checked = true;
  // ④ Retrieval
  _setV(els.atlasRagEnabled,          'checked', cfg.ragEnabled === true);
  _setV(els.atlasHybridSearch,        'checked', cfg.hybridSearch === true);
  _setV(els.atlasReranker,            'checked', cfg.reranker === true);
  _setV(els.atlasRagTopK,             'value',   cfg.ragTopK    != null ? cfg.ragTopK    : 5);
  _setV(els.atlasSimilarityThreshold, 'value',   cfg.similarityThreshold != null ? cfg.similarityThreshold : 0);
  // ⑤ Prompt
  _setV(els.atlasSystemPrompt,        'value',   cfg.systemPrompt || '');
  _setV(els.atlasConversationMemory,  'value',   cfg.conversationMemory != null ? cfg.conversationMemory : 5);
  _setV(els.atlasGuardrails,          'checked', cfg.guardrails === true);
  // ⑥ Routing
  _setV(els.atlasRoutingStrategy,     'value',   cfg.routingStrategy || 'default');
  _setV(els.atlasRoutingFallbackModel,'value',   cfg.routingFallbackModel || 'flash-lite');
  // ⑦ Evaluation
  _setV(els.atlasRecallThreshold,     'value',   cfg.recallThreshold     != null ? cfg.recallThreshold     : 0.80);
  _setV(els.atlasFaithfulnessThreshold,'value',  cfg.faithfulnessThreshold!= null ? cfg.faithfulnessThreshold: 0.70);
  // ⑧ Observability
  _setV(els.atlasTracingEnabled,      'checked', cfg.tracingEnabled === true);
  _setV(els.atlasCapturePrompts,      'checked', cfg.capturePrompts === true);
  _setV(els.atlasCaptureChunks,       'checked', cfg.captureChunks === true);
  _setV(els.atlasCaptureTokens,       'checked', cfg.captureTokens !== false);
  // ⑨ Cost
  _setV(els.atlasBudgetCapInr,        'value',   cfg.budgetCapInr        != null ? cfg.budgetCapInr        : 100);
  _setV(els.atlasDailyBudgetCapInr,   'value',   cfg.dailyBudgetCapInr   != null ? cfg.dailyBudgetCapInr   : 0);
  _setV(els.atlasTokenLimitPerQuery,  'value',   cfg.tokenLimitPerQuery  != null ? cfg.tokenLimitPerQuery  : 1000);
  _setV(els.atlasBudgetAlertThreshold,'value',   cfg.budgetAlertThreshold!= null ? cfg.budgetAlertThreshold: 0.8);
  // ⑩ Security
  _setV(els.atlasPiiRedaction,        'checked', cfg.piiRedaction === true);
  _setV(els.atlasInjectionDetection,  'checked', cfg.injectionDetection === true);
  _setV(els.atlasContentModeration,   'checked', cfg.contentModeration === true);
  _setV(els.atlasRateLimitPerMinute,  'value',   cfg.rateLimitPerMinute  != null ? cfg.rateLimitPerMinute  : 20);
}

function _buildPayload(els, enabledModels, defaultModel, splitterRadio) {
  return {
    enabledModels,    defaultModel,
    fallbackModel:        _g(els.atlasFallbackModel,         'value')  || '',
    temperature:          _n(els.atlasTemperature,           0.35),
    topP:                 _n(els.atlasTopP,                  0.85),
    maxOutputTokens:      _n(els.atlasMaxOutputTokens,       900),
    streamingEnabled:     _c(els.atlasStreamingEnabled,      true),
    modelSelectorVisible: _c(els.atlasModelSelectorVisible,  true),
    embeddingModel:       _g(els.atlasEmbeddingModel,        'value')  || 'gemini-embedding-001',
    embeddingDimensions:  _n(els.atlasEmbeddingDimensions,   768),
    distanceMetric:       _g(els.atlasDistanceMetric,        'value')  || 'COSINE',
    embeddingBatchSize:   _n(els.atlasEmbeddingBatchSize,    5),
    chunkSize:            _n(els.atlasChunkSize,             4000),
    chunkOverlap:         _n(els.atlasChunkOverlap,          200),
    splitterType:         splitterRadio ? splitterRadio.value : 'recursive',
    ragEnabled:           _c(els.atlasRagEnabled,            false),
    hybridSearch:         _c(els.atlasHybridSearch,          false),
    reranker:             _c(els.atlasReranker,              false),
    ragTopK:              _n(els.atlasRagTopK,               5),
    similarityThreshold:  _n(els.atlasSimilarityThreshold,   0),
    systemPrompt:         (_g(els.atlasSystemPrompt,         'value') || '').trim(),
    conversationMemory:   _n(els.atlasConversationMemory,    5),
    guardrails:           _c(els.atlasGuardrails,            false),
    routingStrategy:      _g(els.atlasRoutingStrategy,       'value')  || 'default',
    routingFallbackModel: _g(els.atlasRoutingFallbackModel,  'value')  || 'flash-lite',
    recallThreshold:      _n(els.atlasRecallThreshold,       0.80),
    faithfulnessThreshold:_n(els.atlasFaithfulnessThreshold, 0.70),
    tracingEnabled:       _c(els.atlasTracingEnabled,        false),
    capturePrompts:       _c(els.atlasCapturePrompts,        false),
    captureChunks:        _c(els.atlasCaptureChunks,         false),
    captureTokens:        _c(els.atlasCaptureTokens,         true),
    budgetCapInr:         _n(els.atlasBudgetCapInr,          0),
    dailyBudgetCapInr:    _n(els.atlasDailyBudgetCapInr,     0),
    tokenLimitPerQuery:   _n(els.atlasTokenLimitPerQuery,    1000),
    budgetAlertThreshold: _n(els.atlasBudgetAlertThreshold,  0.8),
    piiRedaction:         _c(els.atlasPiiRedaction,          false),
    injectionDetection:   _c(els.atlasInjectionDetection,    false),
    contentModeration:    _c(els.atlasContentModeration,     false),
    rateLimitPerMinute:   _n(els.atlasRateLimitPerMinute,    20),
  };
}

function _wireConfigAccordion() {
  const panel = document.querySelector('.sd-atlas-config-panel');
  if (!panel || panel.dataset.accordionWired === 'true') return;
  panel.dataset.accordionWired = 'true';

  panel.addEventListener('toggle', function (event) {
    const target = event.target;
    if (!target || !target.classList || !target.classList.contains('sd-ai-accordion') || !target.open) return;
    panel.querySelectorAll('.sd-ai-accordion').forEach(function (item) {
      if (item !== target) item.open = false;
    });
  }, true);
}

function _wireConfigInputs() {
  const panel = document.querySelector('.sd-atlas-config-panel');
  if (!panel || panel.dataset.inputsWired === 'true') return;
  panel.dataset.inputsWired = 'true';

  panel.addEventListener('input', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('#atlasTemperature, #atlasTopP, #atlasMaxOutputTokens')) {
      _syncLinkedInput(target.id);
      return;
    }

    if (target.matches('.sd-ai-slider-value[data-sync-source]')) {
      const sourceId = target.dataset.syncSource;
      if (!sourceId) return;
      const source = document.getElementById(sourceId);
      if (!source) return;
      source.value = target.value;
      return;
    }

    if (target.matches('input[name="atlasDefaultModel"], .sd-atlas-model-toggle')) {
      _syncModelCardState(panel.querySelector('#atlasModelRows'));
    }
  });

  panel.addEventListener('change', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('.sd-ai-slider-value[data-sync-source]')) {
      _syncLinkedInput(target.dataset.syncSource);
      return;
    }

    if (target.matches('input[name="atlasDefaultModel"], .sd-atlas-model-toggle')) {
      _syncModelCardState(panel.querySelector('#atlasModelRows'));
    }
  });
}

function _syncLinkedInput(sourceId) {
  if (!sourceId) return;
  const source = document.getElementById(sourceId);
  const mirror = document.querySelector('.sd-ai-slider-value[data-sync-source="' + sourceId + '"]');
  if (!source || !mirror) return;
  mirror.value = source.value;
}

function _syncModelCardState(container) {
  if (!container) return;
  const selected = container.querySelector('input[name="atlasDefaultModel"]:checked');
  container.querySelectorAll('.sd-atlas-model-row').forEach(function (row) {
    const radio = row.querySelector('input[name="atlasDefaultModel"]');
    const toggle = row.querySelector('.sd-atlas-model-toggle');
    row.classList.toggle('is-default', Boolean(selected && radio && selected.value === radio.value));
    row.classList.toggle('is-disabled', Boolean(toggle && !toggle.checked));
  });
}

function _setV(el, prop, val) { if (el) el[prop] = val; }
function _g(el, prop) { return el ? el[prop] : null; }
function _n(el, def)  { return el ? (Number(el.value) || def) : def; }
function _c(el, def)  { return el ? el.checked : def; }
