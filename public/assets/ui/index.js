/**
 * UI Component Catalogue — barrel re-export for public/assets/ui/
 *
 * This is the single source of truth for every reusable component.
 * Import from here instead of hunting individual files:
 *
 *   import { renderDataTable, renderKpiCards } from '../assets/ui/index.js';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Categories
 * ─────────────────────────────────────────────────────────────────────────────
 *  Primitives   — small, stateless, configurable via options (like React props)
 *  Layout       — header, footer, nav, topbar — used across multiple pages
 *  Page widgets — self-contained feature widgets (contact, hire-me, welcome…)
 *  Blocks       — rich-content / editor building blocks used in the composer
 *  Page bundles — entire page/feature bundles (not reused across pages)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Primitives ────────────────────────────────────────────────────────────────

/**
 * Reusable modal dialog — createModal({ id, title, content, actions, width, onClose })
 * Returns { el, open(), close(), setContent(), setTitle() }
 */
export { createModal } from './modal.js';

/** Renders a structured table into a mount element. Options: columns, rows, emptyText, responsive, minWidth */
export { renderDataTable }       from './datatable.js';

/** Renders a row of KPI stat cards. Options: cards[{ title, value, icon, iconVariant, cardVariant, trend, kicker }] */
export { renderKpiCards }        from './kpi-cards.js';

/** Shows a toast notification. Args: message, { kind, duration } */
export { showToast }             from './toast.js';

/** DOM helpers: createEl, materialIcon, injectShadowStyle */
export { createEl, materialIcon, injectShadowStyle } from './dom.js';

/** Renders a spinner/loading state into a mount element. */
// loader.js has no named exports — used via <script> side-effect only

/** Renders toggle card groups. Options: groups[{ label, cards }] */
export { renderToggleCardGroups } from './toggle-cards.js';

/** Returns HTML string for icon cards. Args: items[], options */
export { iconCardsHtml }         from './iconcards.js';

// ── Layout ────────────────────────────────────────────────────────────────────

/** Renders the site-wide app header. Options: logoHref, links[], user */
export { renderAppHeader, setHeaderAdminVisible } from './app-header.js';

/** Renders the site footer. Options: cols[], copyright */
export { renderTechFooter }      from './footer.js';

/** Renders the primary header navigation into the topbar. Options: links[], activePath */
export { renderHeaderNavIntoTopbar } from './header-nav.js';

/** Renders the admin topbar. Options: title, user, actions[] */
export {
  renderTopbar,
  updateTopbarLanguage,
  updateTopbarUser,
  toggleUserMenu,
  closeUserMenu,
}                                from './topbar.js';

/** Renders the language picker widget. Args: ids (DOM IDs) */
export { renderLanguagePicker, updateLanguagePicker } from './language-picker.js';

// ── Page widgets ──────────────────────────────────────────────────────────────

/** Location popover (country/city display). No options — reads from window. */
export { initLocationPopover }   from './location.js';

/** Welcome overlay shown on first visit. Options: profile, flags */
export { showWelcomeOverlay, hideWelcomeOverlay, showWelcomeToast, closeWelcomeToast } from './welcome.js';

/** Contact info drawer. */
export { openContactInfo, closeContactInfo, initContactInfo } from './contact.js';

/** Sponsorship slot — async. Args: container, placement */
export { mountSponsorSlot }      from './sponsorship.js';

/** Hire-me drawer. */
export { openHireMe, closeHireMe, initHireMe } from './hireme.js';

/** Article card factory. Args: article, opts */
export { createArticleCard, contentTypeLabel } from './article-card.js';

/** Atlas AI chat shell. Args: target, handlers */
export { renderAtlasShell }      from './atlas-shell.js';

/** Component registry: list of all web components + enabledBlockTypes() */
export { COMPONENT_REGISTRY, enabledBlockTypes } from './component-registry.js';

// ── Blocks (editor building blocks — used inside composer) ───────────────────

export { createCardsBlock, createFlowBlock, createComparisonBlock, createSequenceBlock, createRisksBlock, createHeroBlock } from './rich-blocks.js';
export { cloneBlocks, blockToHtml, blocksToHtml, htmlToBlocks } from './sdblocks.js';
export { createImageBlock }      from './image-block.js';
export { createTableBlock }      from './table-block.js';
export { createCodeBlock }       from './code-block.js';

// ── Page bundles (entire features — not reused, but exported for dynamic import) ──

/** Software Architecture / System Design modal. */
export { openSystemDesign, closeSystemDesign, initSystemDesign } from './software-architecture.js';

/** Billing checkout modal. */
export { openBillingCheckoutModal, claimCheckoutSession, initBillingClaimFlow } from './billing-checkout.js';

/** Billing account dialog. */
export { openBillingAccountDialog } from './billing-account.js';
