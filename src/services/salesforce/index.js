'use strict';

/**
 * Salesforce service — public facade.
 *
 * The only file callers (routes, etc.) should import from. Internals
 * are split by change-frequency:
 *
 *   ./auth.js              ← STABLE   (JWT, token cache, env check)
 *   ./httpClient.js        ← STABLE   (generic /sobjects transport)
 *   ./recruiterInquiry.js  ← VOLATILE (Recruiter_Inquiry__c ops)
 *   ./siteVisitor.js       ← VOLATILE (Site_Visitor__c ops)
 *
 * Callers do:
 *   const sf = require('../services/salesforce');
 *   sf.createInquiry(...)
 *   sf.upsertSiteVisitor(...)
 *   sf.isConfigured()
 */

const { createInquiry }      = require('./recruiterInquiry');
const { upsertSiteVisitor }  = require('./siteVisitor');
const { isConfigured }       = require('./auth');

module.exports = {
  createInquiry,
  upsertSiteVisitor,
  isConfigured,
};
