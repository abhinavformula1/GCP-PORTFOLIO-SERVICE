'use strict';

/**
 * Salesforce service — public facade.
 *
 * The only file callers (routes, etc.) should import from. Internals
 * are split by change-frequency:
 *
 *   ./auth.js               ← STABLE   (JWT, token cache, env check)
 *   ./httpClient.js         ← STABLE   (generic /sobjects + /apexrest transport)
 *   ./retry.js              ← STABLE   (exponential-backoff helper)
 *   ./recruiterInquiry.js   ← VOLATILE (Recruiter_Inquiry__c ops)
 *   ./recruiterQuestion.js  ← VOLATILE (Recruiter_Question__c ops)
 *   ./siteVisitor.js        ← VOLATILE (Site_Visitor__c ops)
 *
 * Callers do:
 *   const sf = require('../services/salesforce');
 *   sf.createInquiry(...)
 *   sf.upsertQuestion(...)
 *   sf.upsertSiteVisitor(...)
 *   sf.isConfigured()
 */

const { createInquiry }        = require('./recruiterInquiry');
const { upsertQuestion }       = require('./recruiterQuestion');
const { upsertRecommendation } = require('./recommendation');
const { upsertSiteVisitor }    = require('./siteVisitor');
const { isConfigured }         = require('./auth');

module.exports = {
  createInquiry,
  upsertQuestion,
  upsertRecommendation,
  upsertSiteVisitor,
  isConfigured,
};
