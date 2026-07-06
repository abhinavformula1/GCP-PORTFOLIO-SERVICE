/**
 * Shared mutable state for the admin panel.
 *
 * All admin modules import this singleton and read/write its properties
 * directly.  Using a single object reference (rather than module-level lets)
 * keeps the import graph acyclic and avoids "live binding" surprises.
 *
 * S — each property belongs to exactly one domain; no business logic lives here.
 */

export const state = {
  // ── Auth ────────────────────────────────────────────────────────────────
  credential: '',

  // ── Articles ─────────────────────────────────────────────────────────────
  articles:             [],
  selectedId:           '',
  currentArticleFilter: 'all',
  currentArticleView:   localStorage.getItem('sd-article-view') || 'grid',
  currentThumbnailUrl:  '',
  autosaveTimer:        0,
  articleSections:      [],
  sectionSeq:           0,

  // ── Media ─────────────────────────────────────────────────────────────────
  mediaAuditState: null,
  mediaAuditView: {
    visibleCount: 0,
    batchSize:    30,
    observer:     null,
    query:        '',
    status:       'all',   // all | used | orphan
    article:      'all',   // all | <articleId>
    sort:         'newest',
  },
  /** @type {Map<string, Set<string>>} articleId → Set of 'media/<file>' names */
  mediaRefsByArticleId: new Map(),

  // ── Contact Policy ────────────────────────────────────────────────────────
  contactPolicyState: null,

  // ── Analytics / Subscriptions ─────────────────────────────────────────────
  analyticsState:      null,
  analyticsView:       { month: '' },
  subscriptionsState:  null,

  // ── Auth / Avatar ─────────────────────────────────────────────────────────
  adminAvatarObjectUrl: '',
};
