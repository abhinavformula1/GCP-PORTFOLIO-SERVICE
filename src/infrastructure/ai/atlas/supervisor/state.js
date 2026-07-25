'use strict';

const { Annotation } = require('@langchain/langgraph');

function mergeObjects(left, right) {
  return Object.assign({}, left || {}, right || {});
}

const AtlasSupervisorState = Annotation.Root({
  userMessage: Annotation(),
  atlasCfg: Annotation(),
  basePrompt: Annotation(),
  preliminaryPlan: Annotation(),
  plan: Annotation(),
  signal: Annotation(),
  webSearchResult: Annotation(),
  webAgentMetadata: Annotation(),
  ragPrompt: Annotation(),
  errors: Annotation({
    reducer: function (left, right) {
      return (Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : []);
    },
    default: function () { return []; },
  }),
  nodeTimings: Annotation({
    reducer: mergeObjects,
    default: function () { return {}; },
  }),
});

module.exports = { AtlasSupervisorState };
