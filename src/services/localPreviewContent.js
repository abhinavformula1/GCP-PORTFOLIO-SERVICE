"use strict";

/**
 * Local preview content for UX work when Firestore isn't available.
 *
 * This is only used when ADMIN_LOCAL_PREVIEW=true (local dev) and the
 * Firestore read fails. It ensures the UI always has realistic data.
 */

function nowMs() {
  return Date.now();
}

function baseArticle(overrides) {
  const a = overrides || {};
  const id = String(a.id || "").trim();
  const title = String(a.title || "Untitled").trim();
  const subtitle = String(a.subtitle || "").trim();
  return {
    id,
    status: "Published",
    contentType: a.contentType || "architecture",
    tier: a.tier || "free",
    stub: false,
    icon: a.icon || "article",
    tags: Array.isArray(a.tags) ? a.tags : [],
    readMinutes: typeof a.readMinutes === "number" ? a.readMinutes : 6,
    order: typeof a.order === "number" ? a.order : 100,
    updatedAt: typeof a.updatedAt === "number" ? a.updatedAt : nowMs(),
    blocks: Array.isArray(a.blocks) ? a.blocks : [],
    en: {
      title,
      subtitle,
      body: String(a.body || "").trim(),
    },
  };
}

function getLocalPreviewArticles() {
  return [
    baseArticle({
      id: "why-we-didn-t-use-rag-yet",
      title: "Why We Didn't Use RAG (Yet)",
      subtitle: "Retrieval-Augmented Generation",
      contentType: "architecture",
      tier: "premium",
      tags: ["AI", "Platform Engineering", "Architecture Note"],
      readMinutes: 5,
      order: 10,
      body: [
        "<p>Atlas is the AI assistant embedded within this portfolio.</p>",
        "<p>This local preview article exists so you can iterate on UX without Firestore.</p>",
        "<h3>Key decisions</h3>",
        "<ul><li>Prompt-first architecture</li><li>Deterministic context via APIs</li><li>Progressive enhancement</li></ul>",
      ].join("\n"),
    }),
    baseArticle({
      id: "processing-1-million-salesforce-records-with-outbound-api-callouts",
      title: "System Design: Processing 1 Million Salesforce Records with Outbound API Callouts",
      subtitle: "High-volume integrations",
      contentType: "system-design",
      tier: "free",
      tags: ["Integration", "Salesforce", "Scalability"],
      readMinutes: 6,
      order: 12,
      body: "<p>Local preview: end-to-end design for batching, retries, and backpressure.</p>",
    }),
    baseArticle({
      id: "hourly-package-delivery-status-synchronization",
      title: "System Design: Hourly Package Delivery Status Synchronization",
      subtitle: "Resilient sync jobs",
      contentType: "system-design",
      tier: "free",
      tags: ["Integration", "Event-Driven", "Performance"],
      readMinutes: 6,
      order: 13,
      body: "<p>Local preview: schedule design, idempotency keys, and partial failures.</p>",
    }),
    baseArticle({
      id: "engineering-salesforce-for-large-data-volumes",
      title: "Engineering Salesforce for Large Data Volumes",
      subtitle: "LDV patterns",
      contentType: "architecture",
      tier: "free",
      tags: ["LDV", "Salesforce", "Performance"],
      readMinutes: 7,
      order: 14,
      body: "<p>Local preview: indexing, selective queries, and async processing patterns.</p>",
    }),
    baseArticle({
      id: "salesforce-to-mulesoft-authentication",
      title: "Salesforce to MuleSoft Authentication",
      subtitle: "OAuth 2.0 patterns",
      contentType: "architecture",
      tier: "free",
      tags: ["Security", "MuleSoft", "OAuth 2.0"],
      readMinutes: 6,
      order: 15,
      body: "<p>Local preview: JWT bearer flow, rotation, and least-privilege scopes.</p>",
    }),
  ];
}

function getLocalPreviewArticle(id) {
  const key = String(id || "").trim();
  return getLocalPreviewArticles().find(function (a) { return a.id === key; }) || null;
}

module.exports = {
  getLocalPreviewArticles,
  getLocalPreviewArticle,
};

