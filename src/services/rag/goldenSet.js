'use strict';

/**
 * Golden evaluation set — 50 questions a real visitor would ask about
 * Abhinav's published articles.  Shared between:
 *   - scripts/rag-eval.js (CLI runner)
 *   - src/routes/software-architecture.js (admin SSE endpoint)
 *
 * A "hit" = the expectedArticleId appears in the top-K retrieved chunks.
 */

const GOLDEN_SET = [

  // ── Article: why-we-didn-t-use-rag-yet ───────────────────────────────────
  { question: 'Why did you not use RAG initially for Atlas?',                             expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'What is the static prompt approach used by Atlas?',                        expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'When does a static system prompt become insufficient for an LLM?',         expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'What are the trade-offs between RAG and a static context prompt?',         expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'Why would you avoid RAG for a small knowledge base?',                      expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'What is prompt grounding and how does it differ from retrieval augmentation?', expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'How does Atlas answer questions without a vector database?',                expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'What triggered the decision to eventually build a RAG pipeline?',          expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'When should you choose a static system prompt over a full RAG pipeline?',  expectedArticleId: 'why-we-didn-t-use-rag-yet' },
  { question: 'What were the reasons for not implementing retrieval augmented generation at first?', expectedArticleId: 'why-we-didn-t-use-rag-yet' },

  // ── Article: processing-1-million-salesforce-records-with-outbound-api-callouts ───
  { question: 'How do you process one million Salesforce records?',                       expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'What are Salesforce governor limits for outbound API callouts?',           expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'How do you handle bulk data processing in Salesforce Apex?',               expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'What is the batch processing pattern in Salesforce for large datasets?',   expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'How do outbound API callouts work inside Salesforce Apex?',                expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'How do you avoid hitting Salesforce API limits when processing many records?', expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'What is Queueable Apex and when would you use it over Batch Apex?',       expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'How do you chain batch jobs in Salesforce to process large volumes?',      expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'What strategies exist for chunking large Salesforce SOQL queries?',       expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },
  { question: 'How do you track progress when a Salesforce batch job processes millions of records?', expectedArticleId: 'processing-1-million-salesforce-records-with-outbound-api-callouts' },

  // ── Article: system-design-hourly-package-delivery-status-synchronization ──
  { question: 'How do you design a package delivery status synchronisation system?',      expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'What is the architecture for a real-time delivery tracking platform?',    expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'How do you synchronise delivery status updates on an hourly schedule?',   expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'What database schema works best for package delivery status history?',    expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'How do you handle late or missing status updates in a logistics system?', expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'What is the polling versus push trade-off for delivery status updates?',  expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'Which message queue would you choose for delivery event notifications?',  expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'How do you scale a delivery tracking system to millions of simultaneous packages?', expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'What are the consistency requirements for a package status tracking system?', expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },
  { question: 'How would you design the hourly sync job for a courier delivery platform?', expectedArticleId: 'system-design-hourly-package-delivery-status-synchronization' },

  // ── Article: millions-of-records ─────────────────────────────────────────
  { question: 'How do you handle millions of records efficiently in a database?',         expectedArticleId: 'millions-of-records' },
  { question: 'What is the best pagination strategy for querying millions of rows?',      expectedArticleId: 'millions-of-records' },
  { question: 'How do you implement cursor-based pagination instead of offset pagination?', expectedArticleId: 'millions-of-records' },
  { question: 'What indexing strategies improve performance on large tables?',            expectedArticleId: 'millions-of-records' },
  { question: 'How do you archive old records when a table grows to millions of rows?',   expectedArticleId: 'millions-of-records' },
  { question: 'What is the difference between offset pagination and keyset pagination?',  expectedArticleId: 'millions-of-records' },
  { question: 'How do you batch process millions of database records without timeouts?',  expectedArticleId: 'millions-of-records' },
  { question: 'What are the performance trade-offs of full table scans on large datasets?', expectedArticleId: 'millions-of-records' },
  { question: 'How do you partition data horizontally when a table reaches millions of records?', expectedArticleId: 'millions-of-records' },
  { question: 'What caching strategy reduces database load when serving millions of records?', expectedArticleId: 'millions-of-records' },

  // ── Article: salesforce-mulesoft-authentication ───────────────────────────
  { question: 'How does authentication work between Salesforce and MuleSoft?',            expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'Which OAuth flow is used for Salesforce to MuleSoft API integration?',    expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'How do you configure a Salesforce connected app for MuleSoft?',           expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'What is the JWT bearer token flow in Salesforce and when do you use it?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'How do you secure outbound API calls from Salesforce to an external system?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'What is the difference between OAuth 2.0 user-agent flow and web server flow in Salesforce?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'How do you handle token expiry and refresh in a Salesforce MuleSoft integration?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'What are named credentials in Salesforce and how do they simplify authentication?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'How do you debug an authentication failure between MuleSoft and Salesforce?', expectedArticleId: 'salesforce-mulesoft-authentication' },
  { question: 'What is the client credentials OAuth flow and when is it appropriate for Salesforce integrations?', expectedArticleId: 'salesforce-mulesoft-authentication' },
];

module.exports = { GOLDEN_SET };
