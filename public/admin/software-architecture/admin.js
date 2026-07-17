/**
 * admin.js — entry point / composition root.
 *
 * This file ONLY:
 *   1. Imports modules and wires their dependencies together (DIP).
 *   2. Registers navigation renderers (Open/Closed in nav.js).
 *   3. Attaches top-level event listeners.
 *   4. Bootstraps auth.
 *
 * It contains ZERO business logic.  All logic lives in ./js/modules/*.
 *
 * ~170 lines  (was ~4 550 lines in the monolith).
 */

// ── Shared assets ─────────────────────────────────────────────────────────────
import { initTheme }          from '../../assets/core/theme.js';
import { showWelcomeOverlay } from '../../assets/ui/welcome.js';
import { renderAppHeader }    from '../../assets/ui/app-header.js?v=2026-06-29-nav-align-1';
import { renderAtlasShell }   from '../../assets/ui/atlas-shell.js';
import { initCustomSelects }  from '../../assets/ui/select-menu.js';
import {
  closeAssistant, initChat, minimiseAssistant, openAssistant, restartAssistant, toggleChatTeaser,
} from '../../assets/chat/chat.js?v=2026-07-07-reuse-modal';
import { showToast }          from '../../assets/ui/toast.js';
import '../../assets/ui/loader.js';

// ── Core modules ──────────────────────────────────────────────────────────────
import { els, refreshTopbarEls } from './js/els.js';
import { state }              from './js/state.js';
import {
  registerModuleRenderer, setActiveModule,
  openMobileNav, closeMobileNav, isMobileNavMode,
  setArticleLibraryCollapsed, setContactPolicyInfoCollapsed,
} from './js/nav.js';
import {
  initAuth, startLocalAdminPreview,
  signOutAdmin, initGoogle, onCrossTabSignOut,
} from './js/auth.js';
import { authedJson } from './js/http.js';

// ── Feature modules ───────────────────────────────────────────────────────────
import {
  loadArticles, renderList, fillForm, renderPreview, renderArticleDetails,
  articleFromForm, publishArticle,
  openPublishReview, closePublishReview, handlePublishDialogBack,
  renderPublishOrderWarning, setDetailsStatus, markDirty,
  addSection, closeSectionActionMenus, closeArticleDetailsMenu,
  renderArticleSettings, saveArticleSettings,
  autoFixArticleSettingsOrder, nextAvailableOrder,
} from './js/modules/articles.js';
import { renderMediaLibrary, refreshMediaAudit, uploadThumbnail, removeThumbnail } from './js/modules/media.js';
import { loadContactPolicy, saveContactPolicy, testContactPolicy, closePolicyRuleMenus } from './js/modules/policy.js';
import { renderTierSettings, saveTierSettings } from './js/modules/tier.js';
import { renderMetadataConfig, saveMetadataConfig, getMetaEnabledMap } from './js/modules/metadata.js';
import { renderSponsorships, openSponsorDrawer, closeSponsorDrawer, saveSponsor, deleteSponsor } from './js/modules/sponsorships.js';
import { renderSeoConfig, saveSeoConfig, updateSerpPreview } from './js/modules/seo.js';
import { renderAnalytics, refreshAnalytics } from './js/modules/analytics.js';
import { renderSubscriptions, refreshSubscriptions } from './js/modules/subscriptions.js';
import { renderAtlasConfig, saveAtlasConfig } from './js/modules/atlas/config.js';
import { renderEvaluationPage, startRagEval, addGoldenRow, saveGoldenDataset, filterGoldenDataset, resetGoldenDataset } from './js/modules/atlas/evaluation.js';
import { renderObservabilityPage, loadObservabilityData, filterTraces, closeTraceDetail } from './js/modules/atlas/observability.js';
import { renderMonitoringPage }    from './js/modules/atlas/monitoring.js';

// ── Expose els to modules that use the lazy window.__adminEls accessor ────────
window.__adminEls = els;

// ── Expose metaEnabledMap for composer block-type gating ─────────────────────
Object.defineProperty(window, '__adminMetaEnabledMap', { get: getMetaEnabledMap, configurable: true });

// ── App header ────────────────────────────────────────────────────────────────
renderAppHeader('#sharedTopbar', {
  mode: 'admin',
  topbar: {
    className:         'topbar sd-admin-topbar',
    controlsClassName: 'sd-admin-auth',
    backHref:          '/', backIcon: null, backText: 'Home', backAriaLabel: 'Home',
    signInId:          'adminTopbarSignInBtn', userId: 'adminTopbarUser',
    avatarBtnId:       'adminAvatarBtn', userPhotoId: 'adminUserPhoto',
    dropdownId:        'adminTopbarDropdown', userNameId: 'adminUserName',
    signOutId:         'adminSignOut',
    photoAlt:          'Signed-in admin profile photo',
  },
});
// renderAppHeader() just built the sign-in/avatar/dropdown DOM into
// #sharedTopbar — els.js resolved those ids to null before this line ran
// (imports evaluate before this module's own code), so refresh them now
// that the real nodes exist. Must run before any listener below reads them.
refreshTopbarEls();
initCustomSelects(document);

// ── Auth init ─────────────────────────────────────────────────────────────────
initAuth({
  onSessionReady: loadArticles,
  onSessionReset: function () {
    if (els.workspace)                els.workspace.hidden                = true;
    if (els.modules)                  els.modules.hidden                  = true;
    if (els.policyWorkspace)          els.policyWorkspace.hidden          = true;
    if (els.articleSettingsWorkspace) els.articleSettingsWorkspace.hidden = true;
    if (els.tierSettingsWorkspace)    els.tierSettingsWorkspace.hidden    = true;
    if (els.metadataConfigWorkspace)  els.metadataConfigWorkspace.hidden  = true;
    if (els.sponsorshipsWorkspace)    els.sponsorshipsWorkspace.hidden    = true;
    if (els.dropdown)                 els.dropdown.hidden                 = true;
    // Show the auth wall (pricing gate) when logged out
    const authWall = document.getElementById('adminAuthWall');
    if (authWall) {
      authWall.hidden = false;
      document.body.dataset.authwall = '1';
    }
    // Re-initialize pricing gate cards (they might not exist if user was logged in initially)
    window.location.reload();
  },
});

// ── Nav renderer registration (Open/Closed: add new modules here only) ────────
registerModuleRenderer('article-settings',  function () { renderArticleSettings(); });
registerModuleRenderer('media-library',     function () { renderMediaLibrary(els); });
registerModuleRenderer('contact-policy',    function () { loadContactPolicy(els).catch(function () {}); });
registerModuleRenderer('tier-settings',     function () { renderTierSettings(els).catch(function () {}); });
registerModuleRenderer('metadata-config',   function () { renderMetadataConfig(els).catch(function () {}); });
registerModuleRenderer('sponsorships',      function () { renderSponsorships(els).catch(function () {}); });
registerModuleRenderer('seo-config',        function () { renderSeoConfig(els).catch(function () {}); });
registerModuleRenderer('atlas-ai-config',   function () { renderAtlasConfig(els).catch(function () {}); });
registerModuleRenderer('atlas-evaluation',  function () { renderEvaluationPage(els); });
registerModuleRenderer('atlas-observability',function () { renderObservabilityPage(els); });
registerModuleRenderer('atlas-monitoring',  function () { renderMonitoringPage(els).catch(function () {}); });
registerModuleRenderer('analytics',         function () { renderAnalytics(els).catch(function () {}); });
registerModuleRenderer('subscriptions',     function () { renderSubscriptions(els).catch(function () {}); });

// ── Global helpers used by inline HTML onclick attributes ─────────────────────
window._setArticleFilter = function (filter) {
  state.currentArticleFilter = filter || 'all';
  state.selectedId = '';
  if (els.listMain)      els.listMain.hidden      = false;
  if (els.detailsCard)   els.detailsCard.hidden   = true;
  if (els.editorHead)    els.editorHead.hidden     = true;
  if (els.detailsForm)   els.detailsForm.hidden    = true;
  if (els.detailsHead)   els.detailsHead.hidden    = true;
  if (els.sectionBuilder)els.sectionBuilder.hidden = true;
  document.querySelectorAll('.sd-list-filter-tab').forEach(function (btn) {
    const active = btn.dataset.filter === state.currentArticleFilter;
    btn.classList.toggle('sd-list-filter-tab-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  renderList();
};

window._setArticleView = function (view) {
  state.currentArticleView = view === 'list' ? 'list' : 'grid';
  localStorage.setItem('sd-article-view', state.currentArticleView);
  const gridBtn = document.getElementById('viewToggleGrid');
  const listBtn = document.getElementById('viewToggleList');
  if (gridBtn) { gridBtn.classList.toggle('sd-view-toggle-active', state.currentArticleView === 'grid'); gridBtn.setAttribute('aria-pressed', String(state.currentArticleView === 'grid')); }
  if (listBtn) { listBtn.classList.toggle('sd-view-toggle-active', state.currentArticleView === 'list'); listBtn.setAttribute('aria-pressed', String(state.currentArticleView === 'list')); }
  renderList();
};

window._newArticle = function () {
  state.selectedId = '';
  state.currentArticleFilter = 'all';
  fillForm(null);
  setDetailsStatus('', '');
  renderList();
};

// ── Event listeners ───────────────────────────────────────────────────────────

// Mobile nav
if (els.mobileSidebarBtn) els.mobileSidebarBtn.addEventListener('click', function () { els.adminNav && els.adminNav.classList.contains('sd-admin-nav--open') ? closeMobileNav() : openMobileNav(); });
const mobileNavCloseBtn = document.getElementById('mobileNavCloseBtn');
if (mobileNavCloseBtn)  mobileNavCloseBtn.addEventListener('click', closeMobileNav);
if (els.sidebarScrim)   els.sidebarScrim.addEventListener('click', closeMobileNav);
if (els.modules)        els.modules.addEventListener('click', function () { if (isMobileNavMode()) closeMobileNav(); }, true);

// Module navigation
if (els.modules) {
  els.modules.addEventListener('click', function (evt) {
    const btn = evt.target.closest('.sd-admin-module');
    if (!btn) return;
    const mod = btn.dataset.module || 'system-design';
    setActiveModule(mod === 'atlas-settings' ? 'atlas-ai-config' : mod);
  });
}

// Sub-panel actions
document.addEventListener('click', function (evt) {
  const item = evt.target.closest('[data-subpanel-action]');
  if (!item) return;
  const action = item.dataset.subpanelAction;
  const atlasPanelActions = { 'ai-config': 'atlas-ai-config', 'evaluation': 'atlas-evaluation', 'observability': 'atlas-observability', 'monitoring': 'atlas-monitoring' };
  if (atlasPanelActions[action]) { setActiveModule(atlasPanelActions[action]); return; }
  if (action === 'new-article') { window._newArticle(); return; }
  if (['all', 'drafts', 'published', 'archived'].includes(action)) { window._setArticleFilter(action); }
});

// Library collapse
if (els.toggleLibraryBtn) els.toggleLibraryBtn.addEventListener('click', function () { setArticleLibraryCollapsed(els.workspace, els.toggleLibraryBtn, !els.workspace.classList.contains('sd-admin-workspace-library-collapsed')); });
if (els.togglePolicyInfoBtn) els.togglePolicyInfoBtn.addEventListener('click', function () { setContactPolicyInfoCollapsed(els.policyWorkspace, els.togglePolicyInfoBtn, !els.policyWorkspace.classList.contains('sd-admin-policy-info-collapsed')); });

// New article
if (els.newBtn) els.newBtn.addEventListener('click', window._newArticle);

// Article editor
els.title.addEventListener('input', function () { if (!state.selectedId) els.id.value = (function slugify(v) { let s = '', p = false; for (const c of String(v || '').toLowerCase()) { const ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); if (ok) { if (p && s) s += '-'; s += c; p = false; } else p = true; if (s.length >= 80) break; } return s; })(els.title.value); renderArticleDetails(); renderPreview(); markDirty(); });
[els.id, els.statusField, els.contentType, els.icon, els.readMinutes, els.order, els.subtitle, els.tags].forEach(function (el) {
  if (!el) return;
  el.addEventListener('input',  function () { renderArticleDetails(); renderPreview(); markDirty(); });
  el.addEventListener('change', function () { renderArticleDetails(); renderPreview(); markDirty(); });
});
if (els.addSectionBtn)  els.addSectionBtn.addEventListener('click', function (e) { e.stopPropagation(); addSection(''); });
if (els.previewBtn)     els.previewBtn.addEventListener('click', openPublishReview);
if (els.publishBtn)     els.publishBtn.addEventListener('click', openPublishReview);
if (els.closePublishReviewBtn) els.closePublishReviewBtn.addEventListener('click', closePublishReview);
if (els.continueEditingBtn)    els.continueEditingBtn.addEventListener('click', handlePublishDialogBack);
[els.publishSeoSlug, els.publishSeoContentType, els.publishSeoIcon, els.publishSeoReadMinutes, els.publishSeoOrder].forEach(function (el) { if (!el) return; el.addEventListener('input', renderPublishOrderWarning); el.addEventListener('change', renderPublishOrderWarning); });
if (els.useNextOrderBtn) els.useNextOrderBtn.addEventListener('click', function () { els.publishSeoOrder.value = String(nextAvailableOrder()); renderPublishOrderWarning(); els.publishSeoOrder.focus(); });
if (els.confirmPublishBtn) {
  els.confirmPublishBtn.addEventListener('click', function () {
    if (els.publishDialog.dataset.publishStep !== 'seo') { openPublishReview(); return; }
    if (renderPublishOrderWarning()) { els.publishSeoOrder.focus(); return; }
    els.confirmPublishBtn.disabled = true;
    publishArticle()
      .then(function () { showToast('Published!', { kind: 'success' }); })
      .catch(function () { els.confirmPublishBtn.disabled = false; });
  });
}

// Save article details
if (els.saveDetailsBtn) {
  els.saveDetailsBtn.addEventListener('click', async function () {
    const title = (els.title.value || '').trim();
    if (!title) { setDetailsStatus('Add a title before saving.', 'error'); els.title.focus(); return; }
    els.saveDetailsBtn.disabled = true;
    setDetailsStatus('Saving…', 'info');
    try {
      const article = articleFromForm();
      article.status = article.status || 'Draft'; article.stub = false;
      if (article.en) article.en.body = article.en.body || '';
      const routeId = state.selectedId || article.id;
    const data = await authedJson('/api/admin/system-design/articles/' + routeId, { method: 'PUT', body: JSON.stringify(article) });
      const saved = data.article;
      state.selectedId = saved.id;
      state.articles = state.articles.filter(function (a) { return a.id !== saved.id; }).concat(saved).sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
      renderList(); renderArticleDetails();
      setDetailsStatus((saved.status || 'Draft') + ' saved to Firestore.', 'success');
      setTimeout(function () { setDetailsStatus('', ''); }, 1200);
    } catch (err) {
      setDetailsStatus(err.message || 'Save failed.', 'error');
    } finally {
      els.saveDetailsBtn.disabled = false;
    }
  });
}

// Edit details toggle
if (els.editDetailsBtn) els.editDetailsBtn.addEventListener('click', function () { els.detailsForm.hidden = !els.detailsForm.hidden; if (els.detailsHead) els.detailsHead.hidden = !els.detailsForm.hidden; });
if (els.detailsActionsBtn) {
  els.detailsActionsBtn.addEventListener('click', function (e) {
    e.stopPropagation(); const willOpen = els.detailsActionsMenu.hidden; closeSectionActionMenus(); els.detailsActionsMenu.hidden = !willOpen; els.detailsActionsBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
}
document.addEventListener('click', function () { if (els.detailsActionsMenu && !els.detailsActionsMenu.hidden) closeArticleDetailsMenu(); closeSectionActionMenus(); closePolicyRuleMenus(); });

// Article settings
if (els.saveArticleSettingsBtn)  els.saveArticleSettingsBtn.addEventListener('click',  function () { saveArticleSettings().catch(function (err) { showToast(err.message, { kind: 'error' }); }); });
if (els.autoFixArticleOrderBtn)  els.autoFixArticleOrderBtn.addEventListener('click',  autoFixArticleSettingsOrder);

// Thumbnail
if (els.thumbInput)     els.thumbInput.addEventListener('change', function () { if (els.thumbInput.files && els.thumbInput.files[0]) uploadThumbnail(els, els.thumbInput.files[0]); });
if (els.thumbDropzone)  {
  els.thumbDropzone.addEventListener('dragover',  function (e) { e.preventDefault(); els.thumbDropzone.classList.add('sd-thumb-dropzone--active'); });
  els.thumbDropzone.addEventListener('dragleave', function ()  { els.thumbDropzone.classList.remove('sd-thumb-dropzone--active'); });
  els.thumbDropzone.addEventListener('drop',      function (e) { e.preventDefault(); els.thumbDropzone.classList.remove('sd-thumb-dropzone--active'); const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (file) uploadThumbnail(els, file); });
  els.thumbDropzone.addEventListener('keydown',   function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.thumbInput.click(); } });
}
if (els.thumbRemoveBtn) els.thumbRemoveBtn.addEventListener('click', function () { removeThumbnail(els); });

// Media library
if (els.refreshMediaAuditBtn) els.refreshMediaAuditBtn.addEventListener('click', function () { refreshMediaAudit(els).catch(function () {}); });

// Contact policy
if (els.savePolicyBtn)  els.savePolicyBtn.addEventListener('click',  function () { saveContactPolicy(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });
if (els.testPolicyBtn)  els.testPolicyBtn.addEventListener('click',  function () { testContactPolicy(els); });
document.querySelectorAll('.sd-policy-rule-card').forEach(function (card) {
  const trigger = card.querySelector('.sd-policy-rule-action-btn');
  const menu    = card.querySelector('.sd-policy-rule-menu');
  const edit    = card.querySelector('.sd-policy-edit-btn');
  const form    = card.querySelector('.sd-policy-rule-edit');
  const done    = card.querySelector('.sd-policy-done-btn');
  if (!trigger || !menu || !edit || !form || !done) return;
  trigger.addEventListener('click', function (e) { e.stopPropagation(); const willOpen = menu.hidden; closeSectionActionMenus(); closeArticleDetailsMenu(); closePolicyRuleMenus(); menu.hidden = !willOpen; trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false'); });
  menu.addEventListener('click', function (e) { e.stopPropagation(); });
  edit.addEventListener('click', function () { closePolicyRuleMenus(); form.hidden = false; const field = form.querySelector('textarea'); if (field) field.focus(); });
  done.addEventListener('click', function () { form.hidden = true; });
});

// Tier settings
if (els.saveTierSettingsBtn) els.saveTierSettingsBtn.addEventListener('click', function () { saveTierSettings(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });

// Metadata config
if (els.saveMetadataConfigBtn) els.saveMetadataConfigBtn.addEventListener('click', function () { saveMetadataConfig(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });

// Sponsorships
if (els.addSponsorBtn)        els.addSponsorBtn.addEventListener('click',  function () { openSponsorDrawer(els, null); });
if (els.closeSponsorDrawerBtn)els.closeSponsorDrawerBtn.addEventListener('click', function () { closeSponsorDrawer(els); });
if (els.saveSponsorBtn)       els.saveSponsorBtn.addEventListener('click',  function () { saveSponsor(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });
if (els.deleteSponsorBtn)     els.deleteSponsorBtn.addEventListener('click', function () { deleteSponsor(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });

// SEO
if (els.saveSeoConfigBtn)       els.saveSeoConfigBtn.addEventListener('click', function () { saveSeoConfig(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });
if (els.seoSiteDescription)     els.seoSiteDescription.addEventListener('input', function () { updateSerpPreview(els); });
if (els.seoSiteUrl)             els.seoSiteUrl.addEventListener('input', function () { updateSerpPreview(els); });

// Atlas AI config
if (els.saveAtlasConfigBtn) els.saveAtlasConfigBtn.addEventListener('click', function () { saveAtlasConfig(els).catch(function (err) { showToast(err.message, { kind: 'error' }); }); });

// Atlas AI evaluation
if (els.runEvalBtn)           els.runEvalBtn.addEventListener('click',           function () { startRagEval(els, state.credential); });
if (els.addGoldenRowBtn)       els.addGoldenRowBtn.addEventListener('click',       function () { addGoldenRow(els); });
if (els.saveGoldenDatasetBtn)  els.saveGoldenDatasetBtn.addEventListener('click',  function () { saveGoldenDataset(els); });
if (els.resetGoldenDatasetBtn) els.resetGoldenDatasetBtn.addEventListener('click', function () { resetGoldenDataset(els); });
if (els.goldenDatasetSearch)   els.goldenDatasetSearch.addEventListener('input',   function () { filterGoldenDataset(els); });

// Observability
if (els.obsRefreshBtn)     els.obsRefreshBtn.addEventListener('click',   function () { loadObservabilityData(els); });
if (els.obsCloseTraceBtn)  els.obsCloseTraceBtn.addEventListener('click', function () { closeTraceDetail(els); });
if (els.obsTracesSearch)   els.obsTracesSearch.addEventListener('input',  function () { filterTraces(els); });
if (els.obsTracesFilter)   els.obsTracesFilter.addEventListener('change', function () { filterTraces(els); });

// System Monitoring
if (els.monRefreshBtn) els.monRefreshBtn.addEventListener('click', function () { renderMonitoringPage(els).catch(function () {}); });

// Analytics
if (els.refreshAnalyticsBtn) els.refreshAnalyticsBtn.addEventListener('click', function () { refreshAnalytics(els).catch(function () {}); });

// Subscriptions
if (els.refreshSubscriptionsBtn) els.refreshSubscriptionsBtn.addEventListener('click', function () { refreshSubscriptions(els).catch(function () {}); });

// Sign-out
if (els.signOut) els.signOut.addEventListener('click', function () { signOutAdmin(); });

// Sign-in wall
if (els.topbarSignIn) {
  els.topbarSignIn.addEventListener('click', function () {
    showWelcomeOverlay({ onShown: function () { if (globalThis.google?.accounts) initGoogle(els); } });
  });
}
if (els.signInWallSlot && els.signInWallSlot.childElementCount === 0) {
  const wrap = document.createElement('div');
  const wallBtn = document.createElement('button');
  wallBtn.type = 'button'; wallBtn.className = 'sd-wall-sign-in-btn';
  wallBtn.textContent = 'Sign in to manage content';
  wallBtn.addEventListener('click', function () { showWelcomeOverlay({ onShown: function () { if (globalThis.google?.accounts) initGoogle(els); } }); });
  wrap.appendChild(wallBtn); els.signInWallSlot.appendChild(wrap);
}

// ── Atlas shell / chat ────────────────────────────────────────────────────────
globalThis.toggleChatTeaser  = toggleChatTeaser;
globalThis.openAssistant     = openAssistant;
globalThis.closeAssistant    = closeAssistant;
globalThis.minimiseAssistant = minimiseAssistant;
globalThis.restartAssistant  = restartAssistant;
renderAtlasShell('#sharedAtlasShell', { toggleChatTeaser, openAssistant, closeAssistant, minimiseAssistant, restartAssistant });
initChat();

// ── Theme + cross-tab sign-out ────────────────────────────────────────────────
initTheme();
onCrossTabSignOut(function () { signOutAdmin({ broadcast: false }); });

// ── Bootstrap ─────────────────────────────────────────────────────────────────
startLocalAdminPreview().then(function (enabled) { if (!enabled) initGoogle(els); }).catch(function () { initGoogle(els); });
