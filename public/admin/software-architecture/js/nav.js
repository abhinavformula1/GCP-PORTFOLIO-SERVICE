/**
 * Navigation — workspace visibility, sub-panel routing, mobile drawer.
 *
 * S — only concerned with "which panel is visible" and "which nav item is
 *     highlighted". Business logic for each module lives in that module.
 *
 * O — new modules register themselves via `registerModuleRenderer()`; this
 *     file never needs to be edited to add a new admin section.
 *
 * The render callbacks are injected at startup (admin.js) so nav.js never
 * imports from feature modules — breaking the circular dependency that would
 * arise if both nav → module and module → nav.
 */

/** @type {Record<string, () => void>} */
const _renderers = {};

/**
 * Register the render/load callback for a given module name.
 * Called once per module during app init (admin.js).
 */
export function registerModuleRenderer(moduleName, fn) {
  _renderers[moduleName] = fn;
}

export const ATLAS_SUB_MODULES = [
  'atlas-ai-config', 'atlas-evaluation', 'atlas-observability', 'atlas-monitoring',
];

const WORKSPACE_IDS = {
  'system-design':     'adminWorkspace',
  'contact-policy':    'policyWorkspace',
  'article-settings':  'articleSettingsWorkspace',
  'media-library':     'mediaWorkspace',
  'tier-settings':     'tierSettingsWorkspace',
  'metadata-config':   'metadataConfigWorkspace',
  'sponsorships':      'sponsorshipsWorkspace',
  'seo-config':        'seoConfigWorkspace',
  'atlas-ai-config':   'atlasAiConfigWorkspace',
  'atlas-evaluation':  'atlasEvaluationWorkspace',
  'atlas-observability':'atlasObservabilityWorkspace',
  'atlas-monitoring':  'atlasMonitoringWorkspace',
  'analytics':         'analyticsWorkspace',
  'subscriptions':     'subscriptionsWorkspace',
};

export function setActiveModule(moduleName) {
  const isAtlasAny = ATLAS_SUB_MODULES.indexOf(moduleName) !== -1;

  // Show/hide every known workspace.
  Object.keys(WORKSPACE_IDS).forEach(function (mod) {
    const el = document.getElementById(WORKSPACE_IDS[mod]);
    if (el) el.hidden = mod !== moduleName;
  });
  // system-design workspace is the default editor — show it when no match.
  const sdWorkspace = document.getElementById('adminWorkspace');
  if (sdWorkspace) sdWorkspace.hidden = (moduleName !== 'system-design');

  // Call the registered renderer (load/render) for the active module.
  if (_renderers[moduleName]) _renderers[moduleName]();

  // Top-level module nav highlight.
  const moduleKey = isAtlasAny ? 'atlas-settings' : moduleName;
  const modulesEl = document.getElementById('adminModulesNav');
  if (modulesEl) {
    modulesEl.querySelectorAll('.sd-admin-module').forEach(function (btn) {
      btn.classList.toggle('sd-admin-module-active', btn.dataset.module === moduleKey);
    });
  }

  // Sub-panel pane activation + Atlas item highlight.
  const subpanel = document.getElementById('adminSubpanel');
  if (subpanel) {
    const subpanelKey = isAtlasAny ? 'atlas-settings' : moduleName;
    subpanel.querySelectorAll('.sd-subpanel-pane').forEach(function (pane) {
      pane.classList.toggle('sd-subpanel-pane-active', pane.dataset.subpanel === subpanelKey);
    });
    if (isAtlasAny) {
      const atlasPane = subpanel.querySelector('.sd-subpanel-pane[data-subpanel="atlas-settings"]');
      if (atlasPane) {
        const actionMap = {
          'atlas-ai-config':     'ai-config',
          'atlas-evaluation':    'evaluation',
          'atlas-observability': 'observability',
          'atlas-monitoring':    'monitoring',
        };
        const activeAction = actionMap[moduleName] || 'ai-config';
        atlasPane.querySelectorAll('.sd-subpanel-item').forEach(function (item) {
          item.classList.toggle('sd-subpanel-item-active', item.dataset.subpanelAction === activeAction);
        });
      }
    }
    if (window.innerWidth > 600) document.body.classList.add('sd-subpanel-open');
  }
}

export function openMobileNav() {
  const nav   = document.getElementById('adminNav');
  const scrim = document.getElementById('adminNavScrim');
  if (!nav || !scrim) return;
  nav.classList.add('sd-admin-nav--open');
  document.body.classList.add('sd-mobile-nav-open');
  scrim.classList.add('sd-nav-scrim--visible');
  const btn = document.getElementById('mobileSidebarBtn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

export function closeMobileNav() {
  const nav   = document.getElementById('adminNav');
  const scrim = document.getElementById('adminNavScrim');
  if (!nav || !scrim) return;
  nav.classList.remove('sd-admin-nav--open');
  document.body.classList.remove('sd-mobile-nav-open');
  scrim.classList.remove('sd-nav-scrim--visible');
  const btn = document.getElementById('mobileSidebarBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

export function isMobileNavMode() {
  return window.matchMedia('(max-width: 600px)').matches;
}

export function setArticleLibraryCollapsed(workspace, toggleBtn, collapsed) {
  workspace.classList.toggle('sd-admin-workspace-library-collapsed', collapsed);
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expand article library' : 'Collapse article library');
  toggleBtn.title = collapsed ? 'Expand article library' : 'Collapse article library';
  const icon  = toggleBtn.querySelector('.material-symbols-outlined');
  const label = toggleBtn.querySelector('.sd-admin-collapse-label');
  if (icon)  icon.textContent  = collapsed ? 'left_panel_open' : 'left_panel_close';
  if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
}

export function setContactPolicyInfoCollapsed(policyWorkspace, toggleBtn, collapsed) {
  if (!toggleBtn) return;
  policyWorkspace.classList.toggle('sd-admin-policy-info-collapsed', collapsed);
  toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggleBtn.setAttribute('aria-label', collapsed ? 'Expand policy info' : 'Collapse policy info');
  toggleBtn.title = collapsed ? 'Expand policy info' : 'Collapse policy info';
  const icon = toggleBtn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
}
