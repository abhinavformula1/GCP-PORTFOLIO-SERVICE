import { GOOGLE_CLIENT_ID } from '../../assets/core/config.js';
import {
  STORAGE_CREDENTIAL,
  STORAGE_PROFILE,
  googleCredential,
  broadcastSignOut,
  onCrossTabSignOut,
  setGoogleCredential,
  setSiteProfile,
} from '../../assets/core/state.js';
import { initTheme } from '../../assets/core/theme.js';
import { hideWelcomeOverlay, showWelcomeOverlay } from '../../assets/ui/welcome.js';
import { renderAppHeader } from '../../assets/ui/app-header.js?v=2026-06-29-nav-align-1';
import { renderAtlasShell } from '../../assets/ui/atlas-shell.js';
import {
  closeAssistant,
  initChat,
  minimiseAssistant,
  openAssistant,
  restartAssistant,
  toggleChatTeaser,
} from '../../assets/chat/chat.js';
import {
  blocksToHtml,
  cloneBlocks,
  htmlToBlocks,
} from '../../assets/ui/sdblocks.js';
import { createComposer } from '../../assets/ui/composer.js';
import { COMPONENT_REGISTRY, enabledBlockTypes } from '../../assets/ui/component-registry.js';
import { renderDataTable } from '../../assets/ui/datatable.js';
import { createArticleCard, contentTypeLabel as cardContentTypeLabel } from '../../assets/ui/article-card.js';
import { renderKpiCards } from '../../assets/ui/kpi-cards.js';
import { renderToggleCardGroups } from '../../assets/ui/toggle-cards.js';
import { showToast } from '../../assets/ui/toast.js';
import '../../assets/ui/loader.js';

const ADMIN_HANDOFF_KEY = 'portfolio_admin_handoff';

let credential = readAdminHandoffCredential() || googleCredential || '';
let articles = [];
let selectedId = '';
let currentArticleFilter = 'all'; // all | drafts | published | archived
let currentArticleView = localStorage.getItem('sd-article-view') || 'grid'; // grid | list
let currentThumbnailUrl = '';
let contactPolicyState = null;
let adminAvatarObjectUrl = '';
let autosaveTimer = 0;
let articleSections = [];
let sectionSeq = 0;
let mediaAuditState = null;
let analyticsState = null;
let subscriptionsState = null;
const mediaAuditView = {
  visibleCount: 0,
  batchSize: 30,
  observer: null,
  query: '',
  status: 'all',   // all | used | orphan
  article: 'all',  // all | <articleId>
  sort: 'newest',  // newest | oldest | largest | smallest | name_asc | name_desc
};
const analyticsView = {
  month: '', // YYYY-MM
};

// Track media object references per article so "Replace image" doesn't leave
// orphaned GCS objects behind. After a successful save we diff and attempt a
// safe delete; backend re-checks orphan status before deleting (409 if used).
const mediaRefsByArticleId = new Map(); // articleId -> Set('media/<file>')
function extractMediaObjectNamesFromText(text) {
  const raw = String(text || '');
  const names = new Set();

  // Full public URLs: https://storage.googleapis.com/<bucket>/media/<file>
  const rePublic = /https?:\/\/storage\.googleapis\.com\/[^/"'\s]+\/(media\/[^"'\s?#]+)/gi;
  let m;
  while ((m = rePublic.exec(raw)) !== null) {
    const name = String(m[1] || '').split('?')[0].split('#')[0].trim();
    if (name.startsWith('media/')) names.add(name);
  }

  // Inline paths: /media/<file>
  const rePath = /(?:^|[("'\\s])\/?(media\/[a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp))(?:[)"'\\s?#]|$)/gi;
  while ((m = rePath.exec(raw)) !== null) {
    const name = String(m[1] || '').split('?')[0].split('#')[0].trim();
    if (name.startsWith('media/')) names.add(name);
  }
  return names;
}

function computeMediaRefsFromArticle(article) {
  const a = article || {};
  const en = a.en || {};
  const set = new Set();
  extractMediaObjectNamesFromText(en.body || '').forEach(function (n) { set.add(n); });
  extractMediaObjectNamesFromText(a.thumbnail || '').forEach(function (n) { set.add(n); });
  return set;
}

function diffRemovedMedia(prevSet, nextSet) {
  const removed = [];
  if (!prevSet || !prevSet.size) return removed;
  const next = nextSet || new Set();
  prevSet.forEach(function (name) {
    if (!next.has(name)) removed.push(name);
  });
  return removed;
}

function autoCleanupRemovedMedia(articleId, removedNames) {
  const id = String(articleId || '').trim();
  if (!id) return;
  const names = Array.isArray(removedNames) ? removedNames.filter(Boolean) : [];
  if (!names.length) return;
  Promise.allSettled(names.map(function (name) {
    return authedJson('/api/admin/media/object?name=' + encodeURIComponent(name), { method: 'DELETE' })
      .catch(function (err) {
        if (err && err.status === 409) return null; // still referenced
        return null;
      });
  })).catch(function () {});
}

// Public filtering uses contentType (content type pills) + tags (domains). Categories are
// intentionally removed to avoid a third, redundant taxonomy.

// contentTypeLabel is imported from /assets/ui/article-card.js
const contentTypeLabel = cardContentTypeLabel;

renderAppHeader('#sharedTopbar', {
  mode: 'admin',
  topbar: {
    className: 'topbar sd-admin-topbar',
    controlsClassName: 'sd-admin-auth',
    backHref: '/',
    backIcon: null,
    backText: 'Home',
    backAriaLabel: 'Home',
    signInId: 'adminTopbarSignInBtn',
    userId: 'adminTopbarUser',
    avatarBtnId: 'adminAvatarBtn',
    userPhotoId: 'adminUserPhoto',
    dropdownId: 'adminTopbarDropdown',
    userNameId: 'adminUserName',
    signOutId: 'adminSignOut',
    photoAlt: 'Signed-in admin profile photo',
  },
});

// Footer is intentionally omitted on the admin page — no brand attribution needed here.

const els = {
  topbarSignIn:    document.getElementById('adminTopbarSignInBtn'),
  topbarUser:      document.getElementById('adminTopbarUser'),
  avatarBtn:       document.getElementById('adminAvatarBtn'),
  userPhoto:       document.getElementById('adminUserPhoto'),
  userName:        document.getElementById('adminUserName'),
  dropdown:        document.getElementById('adminTopbarDropdown'),
  signOut:         document.getElementById('adminSignOut'),
  signInWallSlot:  document.getElementById('topbarSignInBtnWall'),
  welcomeGoogle:   document.getElementById('welcomeGoogleBtn'),
  welcomeClose:    document.getElementById('welcomeCloseBtn'),
  welcomeGuest:    document.getElementById('welcomeGuestBtn'),
  workspace:       document.getElementById('adminWorkspace'),
  authWall:        document.getElementById('adminAuthWall'),
  shell:           document.getElementById('adminShell'),
  modules:             document.getElementById('adminModules'),
  adminNav:            document.getElementById('adminNav'),
  sidebarScrim:        document.getElementById('sidebarScrim'),
  mobileSidebarBtn:    document.getElementById('mobileSidebarBtn'),
  policyWorkspace: document.getElementById('contactPolicyWorkspace'),
  articleSettingsWorkspace: document.getElementById('articleSettingsWorkspace'),
  articleSettingsList: document.getElementById('articleSettingsList'),
  articleSettingsStatus: document.getElementById('articleSettingsStatus'),
  autoFixArticleOrderBtn: document.getElementById('autoFixArticleOrderBtn'),
  saveArticleSettingsBtn: document.getElementById('saveArticleSettingsBtn'),
  mediaWorkspace: document.getElementById('mediaWorkspace'),
  mediaOrphansOnly: document.getElementById('mediaOrphansOnly'),
  refreshMediaAuditBtn: document.getElementById('refreshMediaAuditBtn'),
  mediaAuditStatus: document.getElementById('mediaAuditStatus'),
  mediaAuditPanel: document.getElementById('mediaAuditPanel'),
  tierSettingsWorkspace: document.getElementById('tierSettingsWorkspace'),
  tierSettingsPanel: document.getElementById('tierSettingsPanel'),
  tierSettingsStatus: document.getElementById('tierSettingsStatus'),
  saveTierSettingsBtn: document.getElementById('saveTierSettingsBtn'),
  metadataConfigWorkspace: document.getElementById('metadataConfigWorkspace'),
  metadataConfigPanel: document.getElementById('metadataConfigPanel'),
  metadataConfigStatus: document.getElementById('metadataConfigStatus'),
  saveMetadataConfigBtn: document.getElementById('saveMetadataConfigBtn'),
  sponsorshipsWorkspace: document.getElementById('sponsorshipsWorkspace'),
  sponsorshipsPanel: document.getElementById('sponsorshipsPanel'),
  sponsorshipsStatus: document.getElementById('sponsorshipsStatus'),
  addSponsorBtn: document.getElementById('addSponsorBtn'),
  sponsorDrawer: document.getElementById('sponsorDrawer'),
  sponsorDrawerTitle: document.getElementById('sponsorDrawerTitle'),
  sponsorDrawerStatus: document.getElementById('sponsorDrawerStatus'),
  closeSponsorDrawerBtn: document.getElementById('closeSponsorDrawerBtn'),
  saveSponsorBtn: document.getElementById('saveSponsorBtn'),
  deleteSponsorBtn: document.getElementById('deleteSponsorBtn'),
  seoConfigWorkspace: document.getElementById('seoConfigWorkspace'),
  seoConfigStatus: document.getElementById('seoConfigStatus'),
  saveSeoConfigBtn: document.getElementById('saveSeoConfigBtn'),
  atlasSettingsWorkspace: document.getElementById('atlasSettingsWorkspace'),
  atlasConfigStatus: document.getElementById('atlasConfigStatus'),
  saveAtlasConfigBtn: document.getElementById('saveAtlasConfigBtn'),
  atlasModelRows: document.getElementById('atlasModelRows'),
  atlasModelSelectorVisible: document.getElementById('atlasModelSelectorVisible'),
  atlasBudgetCapInr: document.getElementById('atlasBudgetCapInr'),
  atlasRagEnabled: document.getElementById('atlasRagEnabled'),
  atlasRagTopK: document.getElementById('atlasRagTopK'),
  atlasObservabilityWorkspace: document.getElementById('atlasObservabilityWorkspace'),
  atlasObservabilityStatus: document.getElementById('atlasObservabilityStatus'),
  runRagEvalBtn: document.getElementById('runRagEvalBtn'),
  analyticsWorkspace: document.getElementById('analyticsWorkspace'),
  analyticsMonth: document.getElementById('analyticsMonth'),
  refreshAnalyticsBtn: document.getElementById('refreshAnalyticsBtn'),
  analyticsStatus: document.getElementById('analyticsStatus'),
  analyticsPanel: document.getElementById('analyticsPanel'),
  subscriptionsWorkspace: document.getElementById('subscriptionsWorkspace'),
  refreshSubscriptionsBtn: document.getElementById('refreshSubscriptionsBtn'),
  subscriptionsStatus: document.getElementById('subscriptionsStatus'),
  subscriptionsPanel: document.getElementById('subscriptionsPanel'),
  seoSiteUrl: document.getElementById('seoSiteUrl'),
  seoSiteDescription: document.getElementById('seoSiteDescription'),
  seoOgImageUrl: document.getElementById('seoOgImageUrl'),
  seoJsonLd: document.getElementById('seoJsonLd'),
  seoSitemap: document.getElementById('seoSitemap'),
  seoHreflangFr: document.getElementById('seoHreflangFr'),
  seoRobotsNoindex: document.getElementById('seoRobotsNoindex'),
  seoDescCharCount: document.getElementById('seoDescCharCount'),
  seoAdsensePublisherId: document.getElementById('seoAdsensePublisherId'),
  seoLlmsTxtEnabled: document.getElementById('seoLlmsTxtEnabled'),
  seoAiCrawlersAllowed: document.getElementById('seoAiCrawlersAllowed'),
  seoEeatSignalsEnabled: document.getElementById('seoEeatSignalsEnabled'),
  seoSerpUrl: document.getElementById('seoSerpUrl'),
  seoSerpTitle: document.getElementById('seoSerpTitle'),
  seoSerpDesc: document.getElementById('seoSerpDesc'),
  togglePolicyInfoBtn: document.getElementById('toggleContactPolicyInfoBtn'),
  policyMeta:      document.getElementById('contactPolicyMeta'),
  privatePhone:   document.getElementById('contactPrivatePhone'),
  allowedDomains:  document.getElementById('contactAllowedDomains'),
  personalDomains: document.getElementById('contactPersonalDomains'),
  allowedEmails:   document.getElementById('contactAllowedEmails'),
  blockedDomains:  document.getElementById('contactBlockedDomains'),
  privatePhoneView: document.getElementById('contactPrivatePhoneView'),
  allowedDomainsView: document.getElementById('contactAllowedDomainsView'),
  personalDomainsView: document.getElementById('contactPersonalDomainsView'),
  allowedEmailsView: document.getElementById('contactAllowedEmailsView'),
  blockedDomainsView: document.getElementById('contactBlockedDomainsView'),
  testEmail:       document.getElementById('contactTestEmail'),
  policyTest:      document.getElementById('contactPolicyTestResult'),
  testPolicyBtn:   document.getElementById('testContactPolicyBtn'),
  savePolicyBtn:   document.getElementById('saveContactPolicyBtn'),
  list:            document.getElementById('articleList'),
  listMain:        document.getElementById('articleListMain'),
  toggleLibraryBtn: document.getElementById('toggleArticleLibraryBtn'),
  totalCount:      document.getElementById('articleTotalCount'),
  publishedCount:  document.getElementById('articlePublishedCount'),
  draftCount:      document.getElementById('articleDraftCount'),
  newBtn:          document.getElementById('newArticleBtn'),
  id:              document.getElementById('articleId'),
  statusField:     document.getElementById('articleStatus'),
  contentType:     document.getElementById('articleContentType'),
  icon:            document.getElementById('articleIcon'),
  readMinutes:     document.getElementById('articleReadMinutes'),
  order:           document.getElementById('articleOrder'),
  detailsTitle:    document.getElementById('articleDetailsTitle'),
  detailsSubtitle: document.getElementById('articleDetailsSubtitle'),
  detailsTags:     document.getElementById('articleDetailsTags'),
  detailsForm:     document.getElementById('articleDetailsForm'),
  detailsBanner:   document.getElementById('articleDetailsBanner'),
  detailsActionsBtn: document.getElementById('articleDetailsActionsBtn'),
  detailsActionsMenu: document.getElementById('articleDetailsActionsMenu'),
  detailsCard:     document.getElementById('articleDetailsCard'),
  detailsHead:     document.querySelector('.sd-article-details-head'),
  editorHead:      document.querySelector('.sd-admin-editor-head'),
  editDetailsBtn:  document.getElementById('editArticleDetailsBtn'),
  title:           document.getElementById('articleTitle'),
  subtitle:        document.getElementById('articleSubtitle'),
  tags:            document.getElementById('articleTags'),
  body:            document.getElementById('articleBody'),
  thumbInput:         document.getElementById('articleThumbInput'),
  thumbDropzone:      document.getElementById('articleThumbDropzone'),
  thumbPreviewWrap:   document.getElementById('articleThumbPreviewWrap'),
  thumbPreview:       document.getElementById('articleThumbPreview'),
  thumbRemoveBtn:     document.getElementById('articleThumbRemoveBtn'),
  thumbStatus:        document.getElementById('articleThumbStatus'),
  sections:             document.getElementById('articleSections'),
  sectionBuilder:       document.querySelector('.sd-section-builder'),
  addSectionBtn:        document.getElementById('addSectionBtn'),
  saveDetailsBtn:       document.getElementById('saveArticleDetailsBtn'),
  detailsSaveStatus:    document.getElementById('articleDetailsSaveStatus'),
  systemStatus:    document.getElementById('systemDesignStatus'),
  previewBtn:      document.getElementById('previewBtn'),
  publishBtn:      document.getElementById('publishBtn'),
  publishDialog:        document.getElementById('publishReviewDialog'),
  publishSuccessPanel:  document.getElementById('publishSuccessPanel'),
  publishSuccessTitle:  document.getElementById('publishSuccessTitle'),
  publishReviewHeading: document.getElementById('publishReviewTitle'),
  publishReviewDescription: document.getElementById('publishReviewDescription'),
  publishReviewTitle: document.getElementById('publishReviewArticleTitle'),
  publishReviewSubtitle: document.getElementById('publishReviewSubtitle'),
  publishReviewTags: document.getElementById('publishReviewTags'),
  publishReviewReadTime: document.getElementById('publishReviewReadTime'),
  publishReviewBody: document.getElementById('publishReviewBody'),
  publishPreviewPanel: document.getElementById('publishPreviewPanel'),
  publishSeoPanel: document.getElementById('publishSeoPanel'),
  publishSeoSlug: document.getElementById('publishSeoSlug'),
  publishSeoContentType: document.getElementById('publishSeoContentType'),
  publishSeoIcon: document.getElementById('publishSeoIcon'),
  publishSeoReadMinutes: document.getElementById('publishSeoReadMinutes'),
  publishSeoOrder: document.getElementById('publishSeoOrder'),
  publishOrderWarning: document.getElementById('publishOrderWarning'),
  publishOrderWarningText: document.getElementById('publishOrderWarningText'),
  useNextOrderBtn: document.getElementById('useNextOrderBtn'),
  closePublishReviewBtn: document.getElementById('closePublishReviewBtn'),
  continueEditingBtn: document.getElementById('continueEditingBtn'),
  confirmPublishBtn: document.getElementById('confirmPublishBtn'),
  publishActionLabel: document.getElementById('publishActionLabel'),
};


// Mobile drawer helpers — reuses the same narrow rail + sub-panel as desktop
function openMobileNav() {
  if (!els.adminNav || !els.sidebarScrim) return;
  els.adminNav.classList.add('sd-admin-nav--open');
  document.body.classList.add('sd-mobile-nav-open');
  els.sidebarScrim.classList.add('sd-nav-scrim--visible');
  if (els.mobileSidebarBtn) els.mobileSidebarBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMobileNav() {
  if (!els.adminNav || !els.sidebarScrim) return;
  els.adminNav.classList.remove('sd-admin-nav--open');
  document.body.classList.remove('sd-mobile-nav-open');
  els.sidebarScrim.classList.remove('sd-nav-scrim--visible');
  if (els.mobileSidebarBtn) els.mobileSidebarBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

function isMobileNavMode() {
  return window.matchMedia('(max-width: 600px)').matches;
}

function setStatus(message, kind) {
  let status = document.getElementById('adminStatus');
  if (!message) {
    if (status) status.remove();
    return;
  }
  if (!status) {
    status = document.createElement('output');
    status.id = 'adminStatus';
    status.className = 'sd-admin-status';
    els.workspace.before(status);
  }
  const resolvedKind = kind || 'info';
  status.dataset.kind = resolvedKind;

  if (resolvedKind === 'info') {
    status.innerHTML = '';
    const loader = document.createElement('sd-loader');
    loader.setAttribute('size', 'sm');
    loader.setAttribute('label', message);
    status.appendChild(loader);
  } else {
    status.textContent = message;
  }
}

function setSectionStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || '';
  if (message) el.dataset.kind = kind || 'info';
  else delete el.dataset.kind;
}

function makeIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1] || '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (_) {
    return {};
  }
}

function profileFromCredential(token) {
  const payload = decodeJwtPayload(token);
  return {
    sub:     payload.sub,
    name:    payload.name,
    email:   payload.email,
    picture: payload.picture,
  };
}

function readAdminHandoffCredential() {
  try {
    const raw = localStorage.getItem(ADMIN_HANDOFF_KEY);
    if (!raw) return '';
    localStorage.removeItem(ADMIN_HANDOFF_KEY);
    const handoff = JSON.parse(raw);
    if (!handoff || Number(handoff.expiresAt || 0) < Date.now()) return '';
    if (handoff.credential) {
      setGoogleCredential(handoff.credential);
      return handoff.credential;
    }
  } catch (_) {}
  return '';
}

function saveSharedSession(token) {
  const profile = profileFromCredential(token);
  setGoogleCredential(token);
  setSiteProfile({
    sub:   profile.sub,
    name:  profile.name,
    email: profile.email,
  });
  return profile;
}

function isTrustedGoogleProfilePhoto(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('googleusercontent.com');
  } catch (_) {
    return false;
  }
}

function clearAdminAvatarPhoto() {
  if (adminAvatarObjectUrl) {
    URL.revokeObjectURL(adminAvatarObjectUrl);
    adminAvatarObjectUrl = '';
  }
  els.userPhoto.removeAttribute('src');
  delete els.avatarBtn.dataset.hasPhoto;
}

async function loadAdminAvatarPhoto(photoUrl) {
  if (!isTrustedGoogleProfilePhoto(photoUrl)) return;
  const resp = await fetch(photoUrl, { referrerPolicy: 'no-referrer' });
  if (!resp.ok) return;
  const type = resp.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return;
  const blob = await resp.blob();
  clearAdminAvatarPhoto();
  adminAvatarObjectUrl = URL.createObjectURL(blob);
  els.userPhoto.src = adminAvatarObjectUrl;
  els.avatarBtn.dataset.hasPhoto = 'true';
}

async function verifySharedSession(token) {
  const resp = await fetch('/api/session/start', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ credential: token }),
  });
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || data.success === false) {
    throw new Error(data.error || data.message || 'Session verification failed.');
  }
  const verifiedProfile = {
    sub:      data.sub,
    name:     data.name,
    email:    data.email,
    picture:  isTrustedGoogleProfilePhoto(data.picture) ? data.picture : '',
    verified: true,
  };
  setSiteProfile(verifiedProfile);
  return verifiedProfile;
}

function safeDisplayName(profile) {
  const raw = String(profile?.name || profile?.email || 'Admin').trim();
  return raw.replace(/[<>]/g, '').slice(0, 80) || 'Admin';
}

function initialsFor(profile) {
  const display = safeDisplayName(profile);
  const parts = display.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] || 'A';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase().slice(0, 2);
}

function updateAdminChrome(profile) {
  const signedIn = !!profile;
  els.topbarSignIn.hidden = signedIn;
  els.topbarUser.hidden = !signedIn;
  els.signOut.hidden = !signedIn;
  if (!signedIn) {
    els.userName.textContent = '';
    delete els.avatarBtn.dataset.initials;
    clearAdminAvatarPhoto();
    els.userPhoto.alt = 'Signed-in admin profile photo';
    return;
  }
  const displayName = safeDisplayName(profile);
  els.userName.textContent = displayName;
  els.avatarBtn.dataset.initials = initialsFor(profile);
  if (!profile.verified) clearAdminAvatarPhoto();
  els.userPhoto.alt = displayName + ' profile';
}

function syncAdminCredentialToWindow() {
  window.__adminCredential = credential;
}

function resetAdminSession() {
  credential = '';
  syncAdminCredentialToWindow();
  setGoogleCredential(null);
  setSiteProfile(null);
  sessionStorage.removeItem(STORAGE_CREDENTIAL);
  sessionStorage.removeItem(STORAGE_PROFILE);
  els.workspace.hidden = true;
  els.modules.hidden = true;
  els.policyWorkspace.hidden = true;
  els.articleSettingsWorkspace.hidden = true;
  els.tierSettingsWorkspace.hidden = true;
  els.metadataConfigWorkspace.hidden = true;
  els.sponsorshipsWorkspace.hidden = true;
  els.dropdown.hidden = true;
  updateAdminChrome(null);
}

function signOutAdmin(opts) {
  resetAdminSession();
  setStatus('', 'info');
  if ((opts || {}).broadcast !== false) broadcastSignOut();
}

async function startAdminSession(token) {
  credential = token || '';
  syncAdminCredentialToWindow();
  saveSharedSession(credential);
  updateAdminChrome(profileFromCredential(credential));
  try {
    const verifiedProfile = await verifySharedSession(credential);
    updateAdminChrome(verifiedProfile);
    await loadAdminAvatarPhoto(verifiedProfile.picture);
  } catch (_err) {
    setStatus('Verified profile photo is unavailable. Using initials.', 'info');
  }
  await loadArticles();
}

async function startLocalAdminPreview() {
  const resp = await fetch('/api/local-preview');
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || !data.enabled) return false;
  credential = 'local-admin-preview';
  syncAdminCredentialToWindow();
  const profile = {
    sub: 'local-admin-preview',
    name: 'Local Admin Preview',
    email: 'local-admin@localhost',
  };
  setGoogleCredential(credential);
  setSiteProfile(profile);
  updateAdminChrome(profile);
  await loadArticles();
  return true;
}

function slugify(value) {
  const source = String(value || '').toLowerCase();
  let slug = '';
  let pendingDash = false;
  for (const ch of source) {
    const isSafe = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (isSafe) {
      if (pendingDash && slug) slug += '-';
      slug += ch;
      pendingDash = false;
    } else {
      pendingDash = true;
    }
    if (slug.length >= 80) break;
  }
  return slug;
}

function articleDisplayName(article) {
  const en = article && article.en ? article.en : {};
  return en.title || (article && article.id) || 'Untitled article';
}

function currentArticleIds() {
  const ids = [];
  if (selectedId) ids.push(selectedId);
  const currentId = slugify(els.id.value || els.title.value);
  if (currentId && !ids.includes(currentId)) ids.push(currentId);
  return ids;
}

function findOrderConflict(order, excludedIds) {
  const numericOrder = Number(order);
  if (!numericOrder) return null;
  const excluded = excludedIds || [];
  return articles.find(function (article) {
    return Number(article.order || 0) === numericOrder && !excluded.includes(article.id);
  }) || null;
}

function nextAvailableOrder(excludedIds) {
  const excluded = excludedIds || [];
  const usedOrders = new Set(articles
    .filter(function (article) { return !excluded.includes(article.id); })
    .map(function (article) { return Number(article.order || 0); })
    .filter(function (order) { return order > 0; }));
  let order = 10;
  while (usedOrders.has(order)) order += 10;
  return order;
}

function authHeaders() {
  return {
    Authorization: 'Bearer ' + credential,
    'Content-Type': 'application/json',
  };
}

async function authedJson(url, options) {
  const extraHeaders = options?.headers || {};
  const resp = await fetch(url, {
    ...(options || {}),
    headers: { ...authHeaders(), ...extraHeaders },
  });
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || data.success === false) {
    const err = new Error(data.error || data.message || 'Request failed.');
    err.status = resp.status;
    throw err;
  }
  return data;
}

async function composerAiAssist(text, mode) {
  const data = await authedJson('/api/admin/system-design/writing-assist', {
    method: 'POST',
    body:   JSON.stringify({
      articleTitle:    els.title.value.trim(),
      articleSubtitle: els.subtitle.value.trim(),
      sectionType:     'paragraph',
      sectionLabel:    'Paragraph',
      sectionBody:     text,
      mode:            mode || 'improve',
    }),
  });
  const suggestion = String(data.suggestion || '').trim();
  if (!suggestion) throw new Error('AI returned an empty suggestion.');
  return suggestion;
}

function handleAdminLoadError(err) {
  els.workspace.hidden = true;
  els.modules.hidden = true;
  els.policyWorkspace.hidden = true;
  els.articleSettingsWorkspace.hidden = true;
  if (els.mediaWorkspace) els.mediaWorkspace.hidden = true;
  els.tierSettingsWorkspace.hidden = true;
  els.metadataConfigWorkspace.hidden = true;
  els.sponsorshipsWorkspace.hidden = true;
  if (err?.status === 401 || err?.status === 403) {
    const attempted = (function () {
      try {
        const p = profileFromCredential(credential || '');
        return String(p && p.email || '').trim();
      } catch (_) {
        return '';
      }
    })();
    resetAdminSession();
    if (err?.status === 403) {
      setStatus(
        (attempted
          ? ('Signed in as ' + attempted + ', but this account is not allowed to access the admin CMS. Sign in with the email configured in ADMIN_ALLOWED_EMAILS.')
          : 'This account is not allowed to access the admin CMS. Sign in with the email configured in ADMIN_ALLOWED_EMAILS.'),
        'error'
      );
    } else {
      setStatus('Your session expired. Please sign in again.', 'warning');
    }
    if (els.authWall) els.authWall.hidden = false;
    return;
  }
  setStatus(err.message, 'error');
}

function parseListInput(el) {
  return el.value
    .split(/\n|,/)
    .map(function (value) { return value.trim().toLowerCase(); })
    .filter(Boolean);
}

function domainFromEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '';
  return value.slice(at + 1);
}

function renderPolicyValues(target, values, emptyText) {
  target.textContent = '';
  if (!values.length) {
    const empty = document.createElement('span');
    empty.className = 'sd-policy-empty';
    empty.textContent = emptyText;
    target.appendChild(empty);
    return;
  }
  values.forEach(function (value) {
    const chip = document.createElement('span');
    chip.className = 'sd-admin-chip sd-admin-chip-muted';
    chip.textContent = value;
    target.appendChild(chip);
  });
}

function renderPolicyRuleCards() {
  renderPolicyValues(els.privatePhoneView, [formatPrivatePhonePreview(els.privatePhone?.value)], 'No private phone configured.');
  renderPolicyValues(els.personalDomainsView, parseListInput(els.personalDomains), 'No personal domains configured.');
  renderPolicyValues(els.allowedEmailsView, parseListInput(els.allowedEmails), 'No email exceptions configured.');
  renderPolicyValues(els.blockedDomainsView, parseListInput(els.blockedDomains), 'No blocked company domains.');
  renderPolicyValues(els.allowedDomainsView, parseListInput(els.allowedDomains), 'No strategic domains configured.');
}

function formatPrivatePhonePreview(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 4) return raw;
  return '•••• ••• ' + digits.slice(-4);
}

function closePolicyRuleMenus() {
  document.querySelectorAll('.sd-policy-rule-menu').forEach(function (menu) {
    menu.hidden = true;
  });
  document.querySelectorAll('.sd-policy-rule-action-btn[aria-expanded="true"]').forEach(function (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

function renderContactPolicy(policy) {
  contactPolicyState = policy || {};
  els.privatePhone.value = String(contactPolicyState.privatePhone || '').trim();
  const allowedDomains = Array.isArray(contactPolicyState.allowedDomains) ? contactPolicyState.allowedDomains : [];
  const personalDomains = Array.isArray(contactPolicyState.personalDomains) ? contactPolicyState.personalDomains : [];
  const allowedEmails = Array.isArray(contactPolicyState.allowedEmails) ? contactPolicyState.allowedEmails : [];
  const blockedDomains = Array.isArray(contactPolicyState.blockedDomains) ? contactPolicyState.blockedDomains : [];
  els.allowedDomains.value = allowedDomains.join('\n');
  els.personalDomains.value = personalDomains.join('\n');
  els.allowedEmails.value = allowedEmails.join('\n');
  els.blockedDomains.value = blockedDomains.join('\n');
  renderPolicyRuleCards();
  const source = contactPolicyState.source === 'firestore' ? 'Firestore override' : 'Environment defaults';
  const updated = contactPolicyState.updatedAt
    ? new Date(contactPolicyState.updatedAt).toLocaleString()
    : 'Not edited yet';
  const phoneConfigured = contactPolicyState.privatePhoneConfigured ? 'private phone set' : 'private phone missing';
  els.policyMeta.textContent = source + ' · ' + phoneConfigured + ' · ' + personalDomains.length + ' personal domains blocked · ' + allowedEmails.length + ' email exceptions · Updated: ' + updated;
  setSectionStatus(els.policyTest, '', 'info');
}

function setActiveModule(moduleName) {
  const isPolicy   = moduleName === 'contact-policy';
  const isSettings = moduleName === 'article-settings';
  const isMedia    = moduleName === 'media-library';
  const isTier     = moduleName === 'tier-settings';
  const isMeta     = moduleName === 'metadata-config';
  const isSponsor  = moduleName === 'sponsorships';
  const isSeo      = moduleName === 'seo-config';
  const isAtlas         = moduleName === 'atlas-settings';
  const isObservability = moduleName === 'atlas-observability';
  const isAnalytics     = moduleName === 'analytics';
  const isSubs          = moduleName === 'subscriptions';
  els.workspace.hidden = isPolicy || isSettings || isMedia || isTier || isMeta || isSponsor || isSeo || isAtlas || isObservability || isAnalytics || isSubs;
  els.policyWorkspace.hidden = !isPolicy;
  els.articleSettingsWorkspace.hidden = !isSettings;
  if (els.mediaWorkspace) els.mediaWorkspace.hidden = !isMedia;
  els.tierSettingsWorkspace.hidden = !isTier;
  els.metadataConfigWorkspace.hidden = !isMeta;
  els.sponsorshipsWorkspace.hidden = !isSponsor;
  els.seoConfigWorkspace.hidden = !isSeo;
  els.atlasSettingsWorkspace.hidden = !isAtlas;
  if (els.atlasObservabilityWorkspace) els.atlasObservabilityWorkspace.hidden = !isObservability;
  if (els.analyticsWorkspace) els.analyticsWorkspace.hidden = !isAnalytics;
  if (els.subscriptionsWorkspace) els.subscriptionsWorkspace.hidden = !isSubs;
  if (isSettings)     renderArticleSettings();
  if (isMedia)        renderMediaLibrary();
  if (isTier)         renderTierSettings();
  if (isMeta)         renderMetadataConfig();
  if (isSponsor)      renderSponsorships();
  if (isSeo)          renderSeoConfig();
  if (isAtlas)        renderAtlasConfig();
  if (isAnalytics)    renderAnalytics();
  if (isSubs)         renderSubscriptions();
  // atlas-observability is a sub-module of atlas-settings; keep atlas-settings nav item highlighted.
  const moduleKey = moduleName === 'atlas-observability' ? 'atlas-settings' : moduleName;
  els.modules.querySelectorAll('.sd-admin-module').forEach(function (btn) {
    btn.classList.toggle('sd-admin-module-active', btn.dataset.module === moduleKey);
  });

  // Sub-panel: activate matching pane.
  // Only open sub-panel on desktop (> 980px); on mobile it is hidden and
  // navigation happens through the hamburger drawer.
  const subpanel = document.getElementById('adminSubpanel');
  if (subpanel) {
    // atlas-observability shares the atlas-settings sub-panel pane.
    const subpanelKey = moduleName === 'atlas-observability' ? 'atlas-settings' : moduleName;
    subpanel.querySelectorAll('.sd-subpanel-pane').forEach(function (pane) {
      pane.classList.toggle('sd-subpanel-pane-active', pane.dataset.subpanel === subpanelKey);
    });
    // Highlight the correct atlas sub-panel nav item.
    if (moduleName === 'atlas-settings' || moduleName === 'atlas-observability') {
      const atlasPane = subpanel.querySelector('.sd-subpanel-pane[data-subpanel="atlas-settings"]');
      if (atlasPane) {
        atlasPane.querySelectorAll('.sd-subpanel-item').forEach(function (item) {
          const action = item.dataset.subpanelAction;
          const active = moduleName === 'atlas-observability'
            ? action === 'observability'
            : action === 'config';
          item.classList.toggle('sd-subpanel-item-active', active);
        });
      }
    }
    if (window.innerWidth > 600) {
      // Desktop: push content right, sub-panel always visible
      document.body.classList.add('sd-subpanel-open');
    }
    // Mobile: sub-panel visibility is controlled by sd-mobile-nav-open (set in openMobileNav).
    // Pane activation above already ensures the right content shows when rail is open.
  }
}

function setArticleLibraryCollapsed(collapsed) {
  els.workspace.classList.toggle('sd-admin-workspace-library-collapsed', collapsed);
  if (!els.toggleLibraryBtn) return;
  els.toggleLibraryBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  els.toggleLibraryBtn.setAttribute('aria-label', collapsed ? 'Expand article library' : 'Collapse article library');
  els.toggleLibraryBtn.title = collapsed ? 'Expand article library' : 'Collapse article library';
  const icon = els.toggleLibraryBtn.querySelector('.material-symbols-outlined');
  const label = els.toggleLibraryBtn.querySelector('.sd-admin-collapse-label');
  if (icon) icon.textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
  if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
}

function setContactPolicyInfoCollapsed(collapsed) {
  if (!els.togglePolicyInfoBtn) return;
  els.policyWorkspace.classList.toggle('sd-admin-policy-info-collapsed', collapsed);
  els.togglePolicyInfoBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  els.togglePolicyInfoBtn.setAttribute('aria-label', collapsed ? 'Expand policy info' : 'Collapse policy info');
  els.togglePolicyInfoBtn.title = collapsed ? 'Expand policy info' : 'Collapse policy info';
  const icon = els.togglePolicyInfoBtn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
}

async function loadContactPolicy() {
  const data = await authedJson('/api/admin/contact-policy');
  renderContactPolicy(data.policy || {});
}

async function saveContactPolicy() {
  const privatePhone = String(els.privatePhone.value || '').trim();
  const allowedDomains = parseListInput(els.allowedDomains);
  const personalDomains = parseListInput(els.personalDomains);
  const allowedEmails = parseListInput(els.allowedEmails);
  const blockedDomains = parseListInput(els.blockedDomains);
  setSectionStatus(els.policyTest, 'Saving contact policy...', 'info');
  const data = await authedJson('/api/admin/contact-policy', {
    method: 'PUT',
    body:   JSON.stringify({ privatePhone, allowedDomains, personalDomains, allowedEmails, blockedDomains }),
  });
  renderContactPolicy(data.policy || {});
  setSectionStatus(els.policyTest, 'Contact policy saved.', 'success');
}

function testContactPolicy() {
  const email = String(els.testEmail.value || '').trim().toLowerCase();
  const domain = domainFromEmail(els.testEmail.value);
  const allowedDomains = parseListInput(els.allowedDomains);
  const personalDomains = parseListInput(els.personalDomains);
  const allowedEmails = parseListInput(els.allowedEmails);
  const blockedDomains = parseListInput(els.blockedDomains);
  const blocked = blockedDomains.find(function (blockedDomain) {
    return domain === blockedDomain || domain.endsWith('.' + blockedDomain);
  });
  const personal = personalDomains.find(function (personalDomain) {
    return domain === personalDomain || domain.endsWith('.' + personalDomain);
  });
  const alwaysAllowed = allowedDomains.find(function (allowed) {
    return domain === allowed || domain.endsWith('.' + allowed);
  });
  if (!domain) {
    setSectionStatus(els.policyTest, 'Enter a valid email to test.', 'error');
    return;
  }
  if (allowedEmails.includes(email)) {
    setSectionStatus(els.policyTest, 'Allowed. ' + email + ' is an approved email exception.', 'success');
    return;
  }
  if (blocked) {
    setSectionStatus(els.policyTest, 'Blocked. ' + domain + ' is in blocked company domains.', 'error');
    return;
  }
  if (personal) {
    setSectionStatus(els.policyTest, 'Blocked. ' + domain + ' is a personal email domain.', 'error');
    return;
  }
  if (alwaysAllowed) {
    setSectionStatus(els.policyTest, 'Allowed. ' + domain + ' is an always-allowed company domain.', 'success');
    return;
  }
  setSectionStatus(els.policyTest, 'Allowed. ' + domain + ' looks like a company domain.', 'success');
}

// Section titles are free-text for stability. (Preset options caused edge cases
// around blur/commit and increased complexity for little benefit.)

function nextSectionId() {
  sectionSeq += 1;
  return 'section-' + Date.now().toString(36) + '-' + sectionSeq;
}

// Pull the latest blocks out of each section's composer into the model.
function syncSectionBlocks() {
  articleSections.forEach(function (section) {
    if (section.composer) section.blocks = section.composer.getBlocks();
  });
}

// Sections → flat blocks: each section is a heading (its type) + its body.
function sectionsToBlocks() {
  const blocks = [];
  articleSections.forEach(function (section) {
    const body = section.composer ? section.composer.getBlocks() : (section.blocks || []);
    const type = (section.type || '').trim();
    // Mark section-title headings explicitly so we never confuse them with
    // in-body headings (e.g. "1. Stable Product Identity") on reload.
    if (type) blocks.push({ type: 'heading', text: type, scope: 'section' });
    body.forEach(function (block) { blocks.push(block); });
  });
  return blocks;
}

function isExplicitSectionHeading(block) {
  return !!(block && block.type === 'heading' && (
    block.scope === 'section' ||
    block.role === 'section' ||
    block.section === true ||
    block.isSection === true
  ));
}

function looksLikeNumberedHeading(text) {
  // e.g. "1. Foo", "2) Bar", "3.1 Baz"
  return /^\s*\d+(?:\.\d+)*[.)]?\s+/.test(String(text || ''));
}

// Flat blocks → sections: section-title headings start new sections.
function blocksToSections(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const sections = [];
  let current = null;
  const hasExplicitSectionHeadings = list.some(isExplicitSectionHeading);
  list.forEach(function (block) {
    if (block && block.type === 'heading') {
      const text = String(block.text || '').trim();
      const isDelimiter = hasExplicitSectionHeadings
        ? isExplicitSectionHeading(block)
        : (isExplicitSectionHeading(block) || (!!text && !looksLikeNumberedHeading(text)));

      if (isDelimiter) {
        current = { id: nextSectionId(), type: text, blocks: [], composer: null };
        sections.push(current);
        return;
      }
    }
    if (!current) {
      current = { id: nextSectionId(), type: '', blocks: [], composer: null };
      sections.push(current);
    }
    current.blocks.push(block);
  });
  if (!sections.length) sections.push({ id: nextSectionId(), type: '', blocks: [], composer: null });
  return sections;
}

async function saveArticleFromComposer() {
  const article = articleFromForm();
  if (!article.id || !article.en.title) {
    throw new Error('Add a title before saving.');
  }
  if (!article.en.body) {
    throw new Error('Add some content before saving.');
  }
  clearDraftAutosave();
  // Never silently republish from inside the section composer. If the current
  // article is Published, we switch to Draft on first edit and save a draft.
  const status = els.statusField.value === 'Published' ? 'Draft' : 'Draft';
  if (els.statusField.value === 'Published') {
    els.statusField.value = 'Draft';
    updateWorkflowChrome('Draft');
    renderPreview();
  }
  await saveArticleWithStatus(status, { silent: true });
  return 'Draft saved to Firestore.';
}

function articleFromForm() {
  const id = slugify(els.id.value || els.title.value);
  const blocks = sectionsToBlocks();
  const bodyHtml = blocksToHtml(blocks);
  return {
    id,
    status:      els.statusField.value,
    contentType: (els.contentType && els.contentType.value) ? els.contentType.value : '',
    icon:        els.icon.value.trim() || 'article',
    readMinutes: els.readMinutes.value ? Number(els.readMinutes.value) : null,
    order:       Number(els.order.value || 100),
    tags:        els.tags.value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean),
    stub:        els.statusField.value === 'Coming soon',
    thumbnail:   currentThumbnailUrl || '',
    blocks:      cloneBlocks(blocks),
    en: {
      title:    els.title.value.trim(),
      subtitle: els.subtitle.value.trim(),
      body:     bodyHtml,
    },
    fr: {
      title:    els.title.value.trim(),
      subtitle: els.subtitle.value.trim(),
      body:     bodyHtml,
    },
  };
}

function buildSectionTitleInput(section) {
  const wrap = document.createElement('span');
  wrap.className = 'sd-section-type-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  // Reuse the existing class so CSS + composer lock behavior keep working.
  input.className = 'sd-section-type-custom-input';
  input.placeholder = 'Section title (optional)…';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.value = (section.type || '');
  section._typeInput = input;

  function sync() {
    // If empty, we intentionally store '' so sectionsToBlocks() omits the heading.
    section.type = String(input.value || '').trim();
    renderPreview();
  }

  input.addEventListener('input', function () {
    sync();
    // Don't mark dirty on every keystroke; keep it lightweight.
  });
  input.addEventListener('blur', function () {
    sync();
    markDirty();
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });

  wrap.appendChild(input);
  return wrap;
}

function buildSectionCard(section, index) {
  const card = document.createElement('section');
  card.className = 'sd-section-editor';
  card.dataset.sectionId = section.id;

  const ribbon = document.createElement('div');
  ribbon.className = 'sd-section-ribbon';

  const number = document.createElement('span');
  number.className = 'sd-section-ribbon-number';
  number.textContent = String(index + 1).padStart(2, '0');

  const select = buildSectionTitleInput(section);

  const controls = document.createElement('div');
  controls.className = 'sd-section-ribbon-controls';

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'sd-section-ribbon-btn';
  up.title = 'Move section up';
  up.setAttribute('aria-label', 'Move section up');
  up.appendChild(makeIcon('arrow_upward'));
  up.disabled = index === 0;
  up.addEventListener('click', function () { moveSection(section, -1); });

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'sd-section-ribbon-btn';
  down.title = 'Move section down';
  down.setAttribute('aria-label', 'Move section down');
  down.appendChild(makeIcon('arrow_downward'));
  down.disabled = index === articleSections.length - 1;
  down.addEventListener('click', function () { moveSection(section, 1); });

  // ⋮ actions menu — keeps the Delete action tucked away to prevent accidents.
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'sd-section-ribbon-btn sd-section-actions-trigger';
  moreBtn.title = 'Section actions';
  moreBtn.setAttribute('aria-label', 'Section actions');
  moreBtn.setAttribute('aria-haspopup', 'menu');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.appendChild(makeIcon('more_vert'));

  const actionsMenu = document.createElement('div');
  actionsMenu.className = 'sd-section-actions-menu';
  actionsMenu.hidden = true;
  actionsMenu.setAttribute('role', 'menu');

  const deleteItem = document.createElement('button');
  deleteItem.type = 'button';
  deleteItem.className = 'sd-section-action-item sd-section-action-delete';
  deleteItem.setAttribute('role', 'menuitem');
  deleteItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '<span>Delete</span>';
  deleteItem.addEventListener('click', function () {
    closeSectionActionMenus();
    const label = section.type ? '"' + section.type + '"' : 'this section';
    if (!confirm('Delete ' + label + '?\nThis cannot be undone.')) return;
    deleteSection(section);
  });

  actionsMenu.appendChild(deleteItem);

  moreBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    const isOpen = actionsMenu.hidden === false;
    closeSectionActionMenus();
    if (!isOpen) {
      actionsMenu.hidden = false;
      moreBtn.setAttribute('aria-expanded', 'true');
    }
  });

  const moreWrap = document.createElement('div');
  moreWrap.className = 'sd-section-actions-wrap';
  moreWrap.append(moreBtn, actionsMenu);

  controls.append(up, down, moreWrap);
  ribbon.append(number, select, controls);

  const composer = createComposer({
    tools: ['format', 'structure', 'insert', 'ai'],
    // Always show Edit / Cancel / Save so authors can explicitly lock/unlock
    // each section regardless of article status.
    editToggle: true,
    startEditing: section.startEditing === true,
    onBeginEdit: function () {
      section._baselineType = section.type || '';
    },
    onCancel: function () {
      if (section._baselineType == null) return;
      section.type = String(section._baselineType || '').trim();
      if (section._typeInput) section._typeInput.value = section.type;
      renderPreview();
    },
    ariaLabel: section.type + ' section',
    placeholder: '',
    aiAssist: composerAiAssist,
    onSave: saveArticleFromComposer,
    enabledTypes: function () { return enabledBlockTypes(_metaEnabledMap); },
    value: section.blocks,
    onChange: function (blocks) {
      section.blocks = blocks;
      renderPreview();
      markDirty();
    },
  });
  section.composer = composer;

  // If someone explicitly clicks "Edit" on a Published article, switch the
  // workflow to Draft first (so changes don't silently republish).
  const editBtn = composer.element.querySelector('.composer-tool-edit');
  if (editBtn) {
    editBtn.addEventListener('click', function () {
      // Let the composer toggle run first, then reconcile workflow state.
      setTimeout(function () {
        if (!composer.isEditable()) return;
        if (!els.statusField || els.statusField.value !== 'Published') return;
        els.statusField.value = 'Draft';
        updateWorkflowChrome('Draft');
        renderPreview();
        setSectionStatus(els.systemStatus, 'Switched to Draft (Published articles require explicit republish).', 'info');
      }, 0);
    });
  }

  card.append(ribbon, composer.element);

  // IMPORTANT: apply the lock AFTER the composer is inside the section card so
  // setEditable() can find and disable the ribbon picklist / controls.
  composer.setEditable(composer.isEditable());

  // Published articles should open in a clearly read-only mode. Editing must be
  // explicit via the "Edit" toggle.
  if (els.statusField && els.statusField.value === 'Published') {
    composer.setEditable(false);
  }

  // Pull the status ribbon out of the composer's flex container and place it
  // above the card so messages appear above the section, not inside it.
  const slot = document.createElement('div');
  slot.className = 'sd-section-slot';
  const statusEl = composer.element.querySelector('.composer-status');
  if (statusEl) composer.element.removeChild(statusEl);
  if (statusEl) slot.appendChild(statusEl);
  slot.appendChild(card);
  return slot;
}

function renderSectionEditors() {
  els.sections.replaceChildren();
  articleSections.forEach(function (section) { section.composer = null; });
  articleSections.forEach(function (section, index) {
    els.sections.appendChild(buildSectionCard(section, index));
  });
  updateWordCount();
}

function addSection(type) {
  syncSectionBlocks();
  const section = { id: nextSectionId(), type: String(type || '').trim(), blocks: [], composer: null, startEditing: true };
  articleSections.push(section);
  renderSectionEditors();
  const card = els.sections.lastElementChild;
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (section.composer) section.composer.focus();
  renderPreview();
  markDirty();
}

function moveSection(section, delta) {
  syncSectionBlocks();
  const index = articleSections.findIndex(function (item) { return item.id === section.id; });
  if (index === -1) return;
  const target = index + delta;
  if (target < 0 || target >= articleSections.length) return;
  const moved = articleSections.splice(index, 1)[0];
  articleSections.splice(target, 0, moved);
  renderSectionEditors();
  renderPreview();
  markDirty();
}

function deleteSection(section) {
  syncSectionBlocks();
  articleSections = articleSections.filter(function (item) { return item.id !== section.id; });
  if (!articleSections.length) {
    articleSections.push({ id: nextSectionId(), type: 'Overview', blocks: [], composer: null });
  }
  renderSectionEditors();
  renderPreview();
  markDirty();
}

function renderArticleDetails() {
  const title = els.title.value.trim();
  const subtitle = els.subtitle.value.trim();
  const tags = els.tags.value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean);
  els.detailsTitle.textContent = title || 'Untitled article';
  els.detailsSubtitle.textContent = subtitle || 'No subtitle yet.';
  els.detailsTags.textContent = '';
  tags.forEach(function (tag) {
    const chip = document.createElement('span');
    chip.className = 'sd-admin-chip sd-admin-chip-muted';
    chip.textContent = tag;
    els.detailsTags.appendChild(chip);
  });
  // Show thumbnail in card header when one exists
  const cardThumb = document.getElementById('articleCardThumb');
  if (cardThumb) {
    if (currentThumbnailUrl) {
      cardThumb.src = currentThumbnailUrl;
      cardThumb.hidden = false;
    } else {
      cardThumb.src = '';
      cardThumb.hidden = true;
    }
  }
}

function updateWordCount() {
  const el = document.getElementById('articleWordCount');
  if (!el) return;
  let text = '';
  articleSections.forEach(function (s) {
    if (s.blocks) {
      s.blocks.forEach(function (b) {
        text += ' ' + String(b.html || b.text || '').replace(/<[^>]+>/g, ' ');
      });
    }
    text += ' ' + String(s.html || s.text || '').replace(/<[^>]+>/g, ' ');
  });
  const count = text.trim().split(/\s+/).filter(Boolean).length;
  el.textContent = count > 0 ? count + ' words' : '';
}

function setFooterSaveStatus(message, kind) {
  const el = document.getElementById('articleSaveStatusFooter');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind || '';
}

function closeSectionActionMenus() {
  document.querySelectorAll('.sd-section-actions-menu').forEach(function (menu) {
    menu.hidden = true;
  });
  document.querySelectorAll('.sd-section-actions-trigger[aria-expanded="true"]').forEach(function (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

function closeMediaActionMenus() {
  document.querySelectorAll('.sd-media-actions-menu').forEach(function (menu) {
    menu.hidden = true;
  });
  document.querySelectorAll('.sd-media-actions-trigger[aria-expanded="true"]').forEach(function (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  });
}

function closeArticleDetailsMenu() {
  els.detailsActionsMenu.hidden = true;
  els.detailsActionsBtn.setAttribute('aria-expanded', 'false');
}

function updateWorkflowChrome(status) {
  els.statusField.value = status || els.statusField.value || 'Draft';
}

function markDirty() {
  updateWorkflowChrome(els.statusField.value, '');
  updateWordCount();
  scheduleDraftAutosave();
}

function clearDraftAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = 0;
  }
}

function canAutosaveArticle(article) {
  return article.id
    && article.en.title.length >= 3
    && !!article.en.body;
}

function scheduleDraftAutosave() {
  clearDraftAutosave();
  const article = articleFromForm();
  // Avoid silently publishing. Published articles must go through the explicit
  // publish flow; drafts can autosave freely.
  if ((article.status || '').toLowerCase() === 'published') return;
  if (!canAutosaveArticle(article)) {
    setFooterSaveStatus('', '');
    return;
  }
  setFooterSaveStatus('Saving…', '');
  autosaveTimer = setTimeout(function () {
    autosaveTimer = 0;
    saveArticleWithStatus(article.status || 'Draft', { silent: true }).catch(function () {
      setSectionStatus(els.systemStatus, 'Autosave failed.', 'error');
    });
  }, 1200);
}

// Toggle details form and card-preview header as exclusive views.
function showDetailsForm(show) {
  els.detailsForm.hidden = !show;
  if (els.detailsHead) els.detailsHead.hidden = !!show;
}

function fillForm(article) {
  const item = article || {
    id: '',
    status: 'Draft',
    contentType: 'system-design',
    icon: 'article',
    readMinutes: null,
    order: nextAvailableOrder(),
    tags: [],
    en: { title: '', subtitle: '', body: '' },
  };
  const en = item.en || {};
  selectedId = item.id || '';
  els.id.value = item.id || '';
  els.statusField.value = item.status || 'Draft';
  if (els.contentType) {
    els.contentType.value = item.contentType || 'system-design';
  }
  els.icon.value = item.icon || 'article';
  els.readMinutes.value = item.readMinutes || '';
  els.order.value = item.order || 100;
  els.title.value = en.title || '';
  els.subtitle.value = en.subtitle || '';
  els.tags.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
  currentThumbnailUrl = item.thumbnail || '';
  setThumbPreview(currentThumbnailUrl);
  if (els.listMain) els.listMain.hidden = true;
  if (els.detailsCard) els.detailsCard.hidden = false;
  if (els.editorHead) els.editorHead.hidden = false;
  showDetailsForm(false);
  els.sectionBuilder.hidden = false;
  renderArticleDetails();
  let blocks = cloneBlocks(item.blocks);
  if (!blocks.length) blocks = htmlToBlocks(en.body || '');
  // New articles start with no sections — user adds them via "+ Add section".
  articleSections = article ? blocksToSections(blocks) : [];
  renderSectionEditors();
  renderPreview();
  updateWorkflowChrome(els.statusField.value, item.id ? 'Saved in Firestore' : 'New draft', item.id ? 'saved' : 'new');
  renderList();

  if (item.id) {
    mediaRefsByArticleId.set(item.id, computeMediaRefsFromArticle(item));
  }
}

function updateArticleStats() {
  const published = articles.filter(function (article) { return article.status === 'Published'; }).length;
  const drafts = articles.filter(function (article) { return article.status === 'Draft'; }).length;
  if (els.totalCount) els.totalCount.textContent = String(articles.length);
  if (els.publishedCount) els.publishedCount.textContent = String(published);
  if (els.draftCount) els.draftCount.textContent = String(drafts);
}

// createArticleCard is imported from /assets/ui/article-card.js (SOLID module).
// Admin-specific wrapper: binds the onClick to fillForm so call sites stay clean.
function articleCardForAdmin(article) {
  return createArticleCard(article, {
    isActive: article.id === selectedId,
    onClick:  function (a) { fillForm(a); },
  });
}

function renderList() {
  if (!els.list) return;
  els.list.textContent = '';
  updateArticleStats();

  // Apply status filter from sub-panel selection.
  const statusMap = { drafts: 'Draft', published: 'Published', archived: 'Archived' };
  const filterStatus = statusMap[currentArticleFilter] || null;
  const filtered = filterStatus
    ? articles.filter(function (a) { return (a.status || 'Draft') === filterStatus; })
    : articles;

  // Keep sub-panel active state in sync.
  document.querySelectorAll('.sd-subpanel-pane[data-subpanel="system-design"] .sd-subpanel-item').forEach(function (btn) {
    btn.classList.toggle('sd-subpanel-item-active', btn.dataset.subpanelAction === currentArticleFilter);
  });

  // Update article count label
  const countEl = document.getElementById('articleListCount');
  if (countEl) {
    countEl.textContent = filtered.length + ' article' + (filtered.length !== 1 ? 's' : '');
  }

  // Apply view class
  els.list.classList.toggle('sd-list-view', currentArticleView === 'list');

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    const title = document.createElement('strong');
    title.textContent = filterStatus ? 'No ' + filterStatus.toLowerCase() + ' articles.' : 'No articles yet.';
    const hint = document.createElement('span');
    hint.textContent = filterStatus ? 'Change the filter above to see other articles.' : 'Start with a new draft or import the seed articles.';
    empty.append(title, hint);
    els.list.appendChild(empty);
    return;
  }

  if (currentArticleView === 'list') {
    // ── List view: reusable DataTable component ───────────────────────
    const tableRows = filtered.map(function (article) {
      const en = article.en || {};
      const rawType = String(article.contentType || 'system-design').trim().toLowerCase();
      const normalizedType = (rawType === 'architecture' || rawType === 'case-study' || rawType === 'system-design')
        ? rawType : 'system-design';
      return Object.assign({}, article, {
        _id: article.id,
        _title: en.title || article.id,
        _status: article.status || 'Draft',
        _type: normalizedType,
        _typeLabel: contentTypeLabel(normalizedType),
        _meta: (article.readMinutes ? article.readMinutes + ' min read · ' : '') + 'Order ' + (article.order || 100),
        _active: article.id === selectedId,
      });
    });

    renderDataTable(els.list, {
      ariaLabel: 'Articles',
      tableClassName: 'sd-articles-table',
      responsive: true,
      emptyText: 'No articles match this filter.',
      rows: tableRows,
      columns: [
        {
          key: 'status',
          header: 'Status',
          width: 110,
          renderHtml: function (r) {
            return '<span class="sd-admin-chip" data-status="' + safeText(r._status) + '">' + safeText(r._status) + '</span>';
          },
        },
        {
          key: 'type',
          header: 'Type',
          width: 160,
          renderHtml: function (r) {
            return '<span class="sd-admin-chip sd-admin-chip-muted" data-type="' + safeText(r._type) + '">' + safeText(r._typeLabel) + '</span>';
          },
        },
        {
          key: 'title',
          header: 'Title',
          renderHtml: function (r) {
            return '<span class="sd-articles-table-title' + (r._active ? ' sd-articles-table-title-active' : '') + '">' + safeText(r._title) + '</span>';
          },
        },
        {
          key: 'meta',
          header: 'Read time / Order',
          align: 'right',
          renderText: function (r) { return r._meta; },
        },
      ],
    });

    // Add row-click delegation — open article editor on row click
    const tbody = els.list.querySelector('tbody');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        const tr = e.target.closest('tr');
        if (!tr) return;
        const idx = Array.from(tbody.querySelectorAll('tr')).indexOf(tr);
        if (idx >= 0 && tableRows[idx]) {
          fillForm(articles.find(function (a) { return a.id === tableRows[idx]._id; }));
        }
      });
    }
  } else {
    // ── Grid view: visual cards ───────────────────────────
    filtered.forEach(function (article) {
      els.list.appendChild(articleCardForAdmin(article));
    });
  }
}

function createArticleSettingsField(labelText, field, value, type) {
  const label = document.createElement('label');
  label.className = 'sd-article-settings-field';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = labelText;
  let input;
  if (field === 'tier') {
    input = document.createElement('select');
    input.className = 'sd-tier-select';
    [['free', 'Free'], ['premium', 'Premium']].forEach(function (pair) {
      const option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      input.appendChild(option);
    });
    input.value = value || 'free';
  } else if (field === 'contentType') {
    input = document.createElement('select');
    [['system-design', 'System Design'], ['architecture', 'Architecture Notes'], ['case-study', 'Case Studies']].forEach(function (pair) {
      const option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      input.appendChild(option);
    });
    input.value = value || 'system-design';
  } else if (field === 'status') {
    input = document.createElement('select');
    input.className = 'sd-status-select';
    ['Draft', 'Published', 'Coming soon', 'Retired'].forEach(function (s) {
      const option = document.createElement('option');
      option.value = s;
      option.textContent = s;
      input.appendChild(option);
    });
    input.value = value || 'Draft';
    // Reflect status visually on the chip in the card head whenever it changes.
    input.addEventListener('change', function () {
      const chip = input.closest('.sd-article-settings-card')
        ?.querySelector('.sd-admin-chip');
      if (chip) {
        chip.textContent = input.value;
        chip.dataset.status = input.value;
      }
    });
  } else {
    input = document.createElement('input');
    input.type = type || 'text';
    input.value = value || '';
    if (field === 'readMinutes') {
      input.min = '0';
      input.max = '60';
      input.placeholder = 'Optional';
    }
    if (field === 'order') {
      input.min = '1';
      input.max = '9999';
    }
  }
  input.dataset.field = field;
  label.append(labelSpan, input);
  return label;
}

function renderArticleSettingsWarnings() {
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  const orderMap = new Map();
  const slugMap = new Map();
  cards.forEach(function (card) {
    const orderInput = card.querySelector('[data-field="order"]');
    const slugInput = card.querySelector('[data-field="id"]');
    const order = Number(orderInput?.value || 0);
    const slug = slugify(slugInput?.value || '');
    if (!orderMap.has(order)) orderMap.set(order, []);
    if (order) orderMap.get(order).push(card);
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    if (slug) slugMap.get(slug).push(card);
  });

  let conflictCount = 0;
  cards.forEach(function (card) {
    const warning = card.querySelector('.sd-article-settings-warning');
    const order = Number(card.querySelector('[data-field="order"]')?.value || 0);
    const slug = slugify(card.querySelector('[data-field="id"]')?.value || '');
    const orderConflicts = orderMap.get(order) || [];
    const slugConflicts = slugMap.get(slug) || [];
    const messages = [];
    if (orderConflicts.length > 1) {
      const names = orderConflicts
        .filter(function (item) { return item !== card; })
        .map(function (item) { return item.dataset.title || item.dataset.id; })
        .join(', ');
      messages.push('Order ' + order + ' also used by ' + names + '.');
    }
    if (slugConflicts.length > 1) {
      messages.push('Slug "' + slug + '" is used by another article.');
    }
    if (messages.length) {
      warning.textContent = messages.join(' ');
      warning.hidden = false;
      conflictCount += 1;
    } else {
      warning.textContent = '';
      warning.hidden = true;
    }
  });

  if (conflictCount) {
    setSectionStatus(els.articleSettingsStatus, conflictCount + ' setting conflict' + (conflictCount === 1 ? '' : 's') + ' found. Use Auto-fix order or edit manually.', 'error');
  } else {
    setSectionStatus(els.articleSettingsStatus, '', 'info');
  }
  return conflictCount;
}

function renderArticleSettings() {
  els.articleSettingsList.textContent = '';
  if (!articles.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    const title = document.createElement('strong');
    title.textContent = 'No articles to configure yet.';
    const hint = document.createElement('span');
    hint.textContent = 'Create or import articles first, then manage their settings here.';
    empty.append(title, hint);
    els.articleSettingsList.appendChild(empty);
    return;
  }

  articles.forEach(function (article) {
    const card = document.createElement('article');
    const en = article.en || {};
    card.className = 'sd-article-settings-card';
    card.dataset.id = article.id;
    card.dataset.title = articleDisplayName(article);

    const head = document.createElement('div');
    head.className = 'sd-article-settings-card-head';
    const copy = document.createElement('div');
    const status = document.createElement('span');
    status.className = 'sd-admin-chip';
    status.dataset.status = article.status || 'Draft';
    status.textContent = article.status || 'Draft';
    const title = document.createElement('h3');
    title.textContent = articleDisplayName(article);
    const subtitle = document.createElement('p');
    subtitle.textContent = en.subtitle || article.id;
    copy.append(status, title, subtitle);
    head.appendChild(copy);

    const grid = document.createElement('div');
    grid.className = 'sd-article-settings-grid';
    grid.append(
      createArticleSettingsField('Slug', 'id', article.id),
      createArticleSettingsField('Icon', 'icon', article.icon || 'article'),
      createArticleSettingsField('Read time', 'readMinutes', article.readMinutes ? String(article.readMinutes) : '', 'number'),
      createArticleSettingsField('Order', 'order', String(article.order || 100), 'number'),
      createArticleSettingsField('Tier', 'tier', article.tier || 'free'),
      createArticleSettingsField('Status', 'status', article.status || 'Draft')
    );

    const warning = document.createElement('div');
    warning.className = 'sd-article-settings-warning';
    warning.hidden = true;
    card.append(head, grid, warning);
    card.querySelectorAll('input, select').forEach(function (input) {
      input.addEventListener('input', renderArticleSettingsWarnings);
      input.addEventListener('change', renderArticleSettingsWarnings);
    });
    els.articleSettingsList.appendChild(card);
  });
  renderArticleSettingsWarnings();
}

function formatBytes(n) {
  const bytes = Number(n || 0);
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024;
    i += 1;
  }
  const fixed = i === 0 ? 0 : (v >= 10 ? 1 : 2);
  return v.toFixed(fixed) + ' ' + units[i];
}

function formatWhen(ts) {
  const t = Number(ts || 0);
  if (!t) return '';
  try { return new Date(t).toLocaleString(); } catch (_) { return ''; }
}

function safeText(s) {
  return String(s == null ? '' : s);
}

function pct(num, den) {
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d) return '0%';
  const v = Math.max(0, Math.min(1, n / d)) * 100;
  return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%';
}

function computeMediaMetrics(objects) {
  const items = Array.isArray(objects) ? objects : [];
  const totalBytes = items.reduce(function (sum, o) { return sum + Number(o.size || 0); }, 0);
  const used = items.filter(function (o) { return Array.isArray(o.referencedBy) && o.referencedBy.length; });
  const orphan = items.filter(function (o) { return !Array.isArray(o.referencedBy) || o.referencedBy.length === 0; });
  const usedBytes = used.reduce(function (sum, o) { return sum + Number(o.size || 0); }, 0);
  const orphanBytes = orphan.reduce(function (sum, o) { return sum + Number(o.size || 0); }, 0);
  return {
    total: { count: items.length, bytes: totalBytes },
    used: { count: used.length, bytes: usedBytes },
    orphan: { count: orphan.length, bytes: orphanBytes },
  };
}

async function renderMediaLibrary() {
  if (!els.mediaAuditPanel) return;
  // Avoid spamming the API on repeated tab toggles.
  if (mediaAuditState && Array.isArray(mediaAuditState.objects)) {
    paintMediaAudit();
    return;
  }
  await refreshMediaAudit();
}

function monthIdNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

function ensureAnalyticsMonth() {
  if (!els.analyticsMonth) return monthIdNow();
  const current = String(els.analyticsMonth.value || '').trim();
  if (current) return current;
  const v = monthIdNow();
  els.analyticsMonth.value = v;
  return v;
}

async function renderAnalytics() {
  if (!els.analyticsPanel) return;
  const month = ensureAnalyticsMonth();
  if (analyticsState && analyticsView.month === month) {
    paintAnalytics();
    return;
  }
  await refreshAnalytics();
}

async function refreshAnalytics() {
  if (!els.analyticsPanel) return;
  const month = ensureAnalyticsMonth();
  analyticsView.month = month;
  setSectionStatus(els.analyticsStatus, 'Loading analytics…', 'info');
  els.analyticsPanel.textContent = '';
  try {
    const results = await Promise.all([
      authedJson('/api/admin/analytics/overview?month=' + encodeURIComponent(month)),
      authedJson('/api/admin/analytics/today'),
    ]);
    const data = results[0] || {};
    const today = results[1] || {};
    analyticsState = Object.assign({}, data, { today });
    paintAnalytics();
    setSectionStatus(els.analyticsStatus, 'Analytics updated.', 'success');
  } catch (err) {
    setSectionStatus(els.analyticsStatus, err.message || 'Failed to load analytics.', 'error');
  }
}

function paintAnalytics() {
  if (!els.analyticsPanel) return;
  els.analyticsPanel.textContent = '';

  const state = analyticsState || {};
  const totals = state.totals || {};
  const series = Array.isArray(state.series) ? state.series : [];
  const topPages = Array.isArray(state.topPages) ? state.topPages : [];
  const topReferrers = Array.isArray(state.topReferrers) ? state.topReferrers : [];
  const topCampaigns = Array.isArray(state.topCampaigns) ? state.topCampaigns : [];
  const recentUsers = Array.isArray(state.recentUsers) ? state.recentUsers : [];
  const today = state.today && typeof state.today === 'object' ? state.today : null;
  const todayUsers = today && Array.isArray(today.users) ? today.users : [];

  function utmLabel(utm, key) {
    const u = utm && typeof utm === 'object' ? utm : null;
    if (u && (u.source || u.medium || u.campaign)) {
      const parts = [];
      if (u.source) parts.push(u.source);
      if (u.medium) parts.push(u.medium);
      if (u.campaign) parts.push(u.campaign);
      return parts.join(' · ');
    }
    return String(key || '').split('|').slice(0, 3).filter(Boolean).join(' · ') || 'Campaign';
  }

  function formatMs(ms) {
    const n = Math.max(0, Number(ms || 0));
    if (!n) return '0m';
    const mins = Math.round(n / 60000);
    if (mins < 60) return mins + 'm';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h + 'h ' + m + 'm';
  }

  function shortPathLabel(path) {
    const raw = String(path || '');
    if (!raw) return { label: '', chips: [] };
    try {
      const u = new URL(raw, 'https://x.local');
      const chips = [];
      const source = (u.searchParams.get('utm_source') || '').trim();
      const medium = (u.searchParams.get('utm_medium') || '').trim();
      const campaign = (u.searchParams.get('utm_campaign') || '').trim();
      if (source) chips.push(source);
      if (medium) chips.push(medium);
      if (campaign) chips.push(campaign);
      const label = (u.pathname && u.pathname !== '/') ? u.pathname : 'Home';
      return { label, chips };
    } catch (_) {
      const base = raw.split('?')[0] || raw;
      return { label: base === '/' ? 'Home' : base, chips: [] };
    }
  }

  function sparklineSvg(values, opts) {
    const options = opts || {};
    const w = 720;
    const h = 108;
    const pad = 10;
    const list = Array.isArray(values) ? values.map((v) => Number(v || 0)) : [];
    if (!list.length) return '';
    const max = Math.max.apply(Math, list.concat([1]));
    const step = (w - pad * 2) / Math.max(1, list.length - 1);
    function pt(i, v) {
      const x = pad + step * i;
      const y = pad + (h - pad * 2) * (1 - (v / max));
      return [x, y];
    }
    const pts = list.map((v, i) => pt(i, v));
    const d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
    const area = `M ${pad} ${h - pad} ` + pts.map((p) => `L ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ` L ${w - pad} ${h - pad} Z`;
    const stroke = options.stroke || '#2f6fed';
    const fill = options.fill || 'rgba(47,111,237,0.10)';
    return `
      <svg class="sd-analytics-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${area}" fill="${fill}"></path>
        <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>`;
  }

  const viewsSeries = series.map((d) => Number(d.pageViews || 0));
  const visitorsSeries = series.map((d) => Number(d.uniqueVisitors || 0));
  const last14Views = viewsSeries.reduce((s, v) => s + v, 0);
  const last14Visitors = visitorsSeries.reduce((s, v) => s + v, 0);

  const recentVisitorChips = recentUsers.slice(0, 6).map(function (u) {
    const label = u && u.kind === 'signed'
      ? (u.name || 'Signed-in')
      : (u && u.label ? u.label : 'Anonymous');
    const region = u && u.region ? String(u.region) : '';
    return `<span class="sd-analytics-chip" title="${safeText(region ? (label + ' · ' + region) : label)}">${safeText(label)}</span>`;
  }).join('');

  const signedCount = todayUsers.filter((u) => u && u.kind === 'signed').length;
  const anonCount = todayUsers.length - signedCount;
  const todayReadMs = todayUsers.reduce((s, u) => s + Number(u.readMs || 0), 0);
  const todayPdf = todayUsers.reduce((s, u) => s + Number(u.pdfDownloads || 0), 0);

  const todayRows = todayUsers.slice(0, 50).map(function (u) {
    const name = u.kind === 'signed'
      ? (u.name || 'Signed-in user')
      : 'Anonymous';
    const city = u.geoCity ? String(u.geoCity) : '—';
    const country = u.geoCountry ? String(u.geoCountry) : (u.region ? String(u.region) : '—');
    const pages = Array.isArray(u.pages) ? u.pages : [];
    const pageLines = pages.slice(0, 3).map(function (p) {
      const path = String(p.path || '');
      const parsed = shortPathLabel(path);
      const pv = Number(p.pageViews || 0);
      const rm = Number(p.readMs || 0);
      const chips = parsed.chips.map((c) => `<span class="sd-analytics-chip">${safeText(c)}</span>`).join('');
      return `<div class="sd-analytics-user-page"><span class="sd-analytics-user-page-name">${safeText(parsed.label)}</span><span class="sd-analytics-user-page-meta">${pv} · ${formatMs(rm)}</span>${chips ? `<span class="sd-analytics-user-page-chips">${chips}</span>` : ''}</div>`;
    }).join('');
    return `
      <tr>
        <td>
          <div class="sd-analytics-user">
            <span class="sd-analytics-avatar" aria-hidden="true">${safeText((name || 'A').slice(0, 1).toUpperCase())}</span>
            <span class="sd-analytics-user-meta">
              <span class="sd-analytics-user-name">${safeText(name)}</span>
              <span class="sd-analytics-user-sub">${safeText(u.kind === 'signed' ? 'Signed-in' : 'Anonymous')}${u.device ? ' · ' + safeText(u.device) : ''}${u.tz ? ' · ' + safeText(u.tz) : ''}</span>
            </span>
          </div>
        </td>
        <td>${safeText(city)}</td>
        <td>${safeText(country)}</td>
        <td class="sd-analytics-num">${Number(u.pageViews || 0).toLocaleString()}</td>
        <td class="sd-analytics-num">${formatMs(u.readMs || 0)}</td>
        <td class="sd-analytics-num">${Number(u.pdfDownloads || 0).toLocaleString()}</td>
        <td>
          ${pageLines || '<div class="sd-analytics-empty">No pages captured yet.</div>'}
        </td>
      </tr>`;
  }).join('');

  function rankedRows(items, getLabel, getValue) {
    const list = Array.isArray(items) ? items.slice(0, 10) : [];
    const max = list.reduce((m, it) => Math.max(m, Number(getValue(it) || 0)), 0) || 1;
    if (!list.length) return '';
    return list.map(function (it, i) {
      const v = Number(getValue(it) || 0);
      const w = Math.max(3, Math.round((v / max) * 100));
      const label = getLabel(it);
      return `<div class="sd-analytics-rank-row">
        <span class="sd-analytics-rank">${i + 1}</span>
        <span class="sd-analytics-rank-label" title="${safeText(label)}">${safeText(label)}</span>
        <span class="sd-analytics-rank-bar" aria-hidden="true"><i style="width:${w}%"></i></span>
        <span class="sd-analytics-rank-val">${v.toLocaleString()}</span>
      </div>`;
    }).join('');
  }

  els.analyticsPanel.innerHTML = `
    <div class="sd-analytics-grid">
      <div id="analyticsKpiMount"></div>

      <div class="sd-analytics-trendcard" role="region" aria-label="Last 14 days trend">
        <div class="sd-analytics-trend-head">
          <strong>Last 14 days</strong>
          <span class="sd-analytics-legend">
            <span class="sd-analytics-legend-item"><i data-kind="views"></i>Views</span>
            <span class="sd-analytics-legend-item"><i data-kind="visitors"></i>Visitors</span>
          </span>
        </div>
        <div class="sd-analytics-sparks">
          <div class="sd-analytics-spark-wrap">
            ${sparklineSvg(viewsSeries, { stroke: 'color-mix(in srgb, var(--md-sys-color-primary) 86%, #111)', fill: 'color-mix(in srgb, var(--md-sys-color-primary) 16%, transparent)' })}
          </div>
          <div class="sd-analytics-spark-wrap">
            ${sparklineSvg(visitorsSeries, { stroke: 'color-mix(in srgb, var(--success) 72%, #111)', fill: 'color-mix(in srgb, var(--success) 12%, transparent)' })}
          </div>
        </div>
        <div class="sd-analytics-trend-foot">
          <div><strong>${last14Views.toLocaleString()}</strong><span>views</span></div>
          <div><strong>${last14Visitors.toLocaleString()}</strong><span>visitors</span></div>
        </div>
        <details class="sd-analytics-breakdown">
          <summary>Daily breakdown</summary>
          <div class="sd-analytics-breakdown-rows">
            ${series.map(function (d) {
              return `<div class="sd-analytics-break-row"><span>${safeText(d.date)}</span><span>${Number(d.pageViews || 0).toLocaleString()} views</span><span>${Number(d.uniqueVisitors || 0).toLocaleString()} visitors</span></div>`;
            }).join('')}
          </div>
        </details>
      </div>

      <div class="sd-analytics-insights" role="region" aria-label="Top insights">
        <div class="sd-analytics-insight">
          <div class="sd-analytics-insight-head">
            <strong>Top pages</strong>
            <span class="sd-analytics-trend-sub">This month</span>
          </div>
          ${topPages.length ? rankedRows(topPages, function (it) {
            const parsed = shortPathLabel(it && it.path ? it.path : '');
            return parsed.label;
          }, function (it) { return it && it.pageViews; }) : '<div class="sd-analytics-empty">No page data yet.</div>'}
        </div>

        <div class="sd-analytics-insight">
          <div class="sd-analytics-insight-head">
            <strong>Top referrers</strong>
            <span class="sd-analytics-trend-sub">Domain only</span>
          </div>
          ${topReferrers.length ? rankedRows(topReferrers, function (it) {
            const name = String(it && it.referrer ? it.referrer : '');
            return name === 'direct' ? 'Direct' : (name === 'internal' ? 'Internal' : name);
          }, function (it) { return it && it.pageViews; }) : '<div class="sd-analytics-empty">No referrer data yet.</div>'}
        </div>

        <div class="sd-analytics-insight">
          <div class="sd-analytics-insight-head">
            <strong>Top campaigns</strong>
            <span class="sd-analytics-trend-sub">UTM attribution</span>
          </div>
          ${topCampaigns.length ? rankedRows(topCampaigns, function (it) {
            return utmLabel(it && it.utm ? it.utm : null, it && it.key ? it.key : '');
          }, function (it) { return it && it.pageViews; }) : '<div class="sd-analytics-empty">No UTM campaigns yet.</div>'}
        </div>
      </div>

      <div class="sd-analytics-today" role="region" aria-label="Today users">
        <div class="sd-analytics-trend-head">
          <strong>Today</strong>
          <span class="sd-analytics-trend-sub">${safeText(today && today.day ? today.day : '')} · ${todayUsers.length} users</span>
        </div>
        <div class="sd-analytics-today-kpis">
          <div><strong>${signedCount}</strong><span>signed-in</span></div>
          <div><strong>${anonCount}</strong><span>anonymous</span></div>
          <div><strong>${formatMs(todayReadMs)}</strong><span>read time</span></div>
          <div><strong>${todayPdf}</strong><span>PDFs</span></div>
        </div>
        <div class="sd-analytics-table-wrap">
          <table class="sd-analytics-table">
            <thead>
              <tr>
                <th>User</th>
                <th>City</th>
                <th>Country</th>
                <th class="sd-analytics-num">Views</th>
                <th class="sd-analytics-num">Read</th>
                <th class="sd-analytics-num">PDFs</th>
                <th>Top pages</th>
              </tr>
            </thead>
            <tbody>
              ${todayRows || '<tr><td colspan="7" class="sd-analytics-empty">No users yet today. Open the public site to generate traffic.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Analytics KPI cards (reusable component)
  try {
    const mount = document.getElementById('analyticsKpiMount');
    if (mount) {
      renderKpiCards(mount, {
        ariaLabel: 'Analytics KPIs',
        cards: [
          { title: 'Monthly Visitors', value: Number(totals.uniqueVisitors || 0).toLocaleString(), icon: 'group', iconVariant: 'users', trend: 'vs last 30 days' },
          { title: 'Monthly Page Views', value: Number(totals.pageViews || 0).toLocaleString(), icon: 'bar_chart', iconVariant: 'mrr', trend: 'vs last 30 days' },
          { title: 'Monthly PDF Downloads', value: Number(state && state.totals && state.totals.pdfDownloads ? state.totals.pdfDownloads : 0).toLocaleString(), icon: 'picture_as_pdf', iconVariant: 'arr', trend: 'vs last 30 days' },
        ],
      });
      // Add the “recent visitor chips” detail below cards (keeps the cards clean).
      if (recentVisitorChips) {
        const note = document.createElement('div');
        note.className = 'sd-analytics-kpi-note';
        note.innerHTML = 'Recent visitors · ' + recentVisitorChips;
        mount.appendChild(note);
      }
    }
  } catch (_) {}
}

async function renderSubscriptions() {
  if (!els.subscriptionsPanel) return;
  if (subscriptionsState && Array.isArray(subscriptionsState.subscriptions)) {
    paintSubscriptions();
    return;
  }
  await refreshSubscriptions();
}

async function refreshSubscriptions() {
  if (!els.subscriptionsPanel) return;
  setSectionStatus(els.subscriptionsStatus, 'Loading subscriptions…', 'info');
  els.subscriptionsPanel.textContent = '';
  try {
    const data = await authedJson('/api/admin/subscriptions/overview');
    subscriptionsState = data;
    paintSubscriptions();
    setSectionStatus(els.subscriptionsStatus, '', '');
    try { showToast('Subscriptions updated.', { kind: 'success' }); } catch (_) {}
  } catch (err) {
    setSectionStatus(els.subscriptionsStatus, err.message || 'Failed to load subscriptions.', 'error');
  }
}

function paintSubscriptions() {
  if (!els.subscriptionsPanel) return;
  els.subscriptionsPanel.textContent = '';
  const state = subscriptionsState || {};
  const kpis = state.kpis || {};
  const rows = Array.isArray(state.subscriptions) ? state.subscriptions : [];
  const stripeMode = String(state.stripeMode || 'unknown');

  function money(cents, currency) {
    const cur = String(currency || 'USD');
    const val = Number(cents || 0) / 100;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(val);
    } catch (_) {
      return cur + ' ' + val.toFixed(2);
    }
  }

  function dashBase() {
    if (stripeMode === 'test') return 'https://dashboard.stripe.com/test';
    return 'https://dashboard.stripe.com';
  }

  function intervalLabel(r) {
    const i = String(r && r.interval || '');
    const c = Number(r && r.intervalCount || 1) || 1;
    if (!i) return '—';
    return c === 1 ? (i === 'month' ? 'Monthly' : (i === 'year' ? 'Yearly' : i)) : (c + '× ' + i);
  }

  function fmtDate(ms) {
    const t = Number(ms || 0);
    if (!t) return '—';
    try { return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }); } catch (_) {}
    return new Date(t).toDateString();
  }

  function daysLeft(ms) {
    const t = Number(ms || 0);
    if (!t) return '';
    const d = Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000));
    if (!isFinite(d)) return '';
    if (d < 0) return 'expired';
    if (d === 0) return 'today';
    return d + ' days left';
  }

  const mrrEntries = kpis.mrrByCurrency && typeof kpis.mrrByCurrency === 'object' ? kpis.mrrByCurrency : {};
  const mrrText = Object.keys(mrrEntries).length
    ? Object.keys(mrrEntries).sort().map(function (cur) { return money(mrrEntries[cur], cur); }).join(' · ')
    : '—';
  const arrEntries = kpis.arrByCurrency && typeof kpis.arrByCurrency === 'object' ? kpis.arrByCurrency : {};
  const arrText = Object.keys(arrEntries).length
    ? Object.keys(arrEntries).sort().map(function (cur) { return money(arrEntries[cur], cur); }).join(' · ')
    : (Object.keys(mrrEntries).length ? (Object.keys(mrrEntries).sort().map(function (cur) { return money(mrrEntries[cur] * 12, cur); }).join(' · ')) : '—');

  // KPI cards (reusable component)
  els.subscriptionsPanel.innerHTML = `<div id="subsKpiMount"></div>`;
  const subsKpiMount = document.getElementById('subsKpiMount');
  if (subsKpiMount) {
    renderKpiCards(subsKpiMount, {
      ariaLabel: 'Subscription KPIs',
      cards: [
        { title: 'Active Subscriptions', value: Number(kpis.active || 0).toLocaleString(), icon: 'group', iconVariant: 'users', trend: '0% vs last 30 days' },
        { title: 'Total Subscribers', value: Number(kpis.total || 0).toLocaleString(), icon: 'person', iconVariant: 'ok', trend: '0% vs last 30 days' },
        { title: 'Monthly Recurring Revenue', value: safeText(mrrText), kicker: 'MRR', icon: 'payments', iconVariant: 'mrr', trend: '0% vs last 30 days' },
        { title: 'Annual Recurring Revenue', value: safeText(arrText), kicker: 'ARR', icon: 'monitoring', iconVariant: 'arr', trend: '0% vs last 30 days' },
      ],
    });
  }

  // Table (reusable DataTable)
  const tableMount = document.createElement('div');
  tableMount.className = 'sd-dt-mount';
  els.subscriptionsPanel.appendChild(tableMount);

  const tableRows = rows.slice(0, 200).map(function (r) {
    const status = String(r.status || 'unknown');
    const email = r.email ? String(r.email) : '';
    const name = r.name ? String(r.name) : '';
    const plan = r.planNickname || 'Premium plan';
    const interval = intervalLabel(r);
    const amount = (r.amount && r.currency) ? (money(r.amount, r.currency) + ' / ' + (String(r.interval || '') === 'year' ? 'year' : 'month')) : '—';
    const start = r.currentPeriodStart ? fmtDate(r.currentPeriodStart) : '—';
    const end = r.currentPeriodEnd ? fmtDate(r.currentPeriodEnd) : '—';
    const renew = r.currentPeriodEnd ? fmtDate(r.currentPeriodEnd) : '—';
    const left = r.currentPeriodEnd ? daysLeft(r.currentPeriodEnd) : '';
    const customerId = r.stripeCustomerId ? String(r.stripeCustomerId) : '';
    const subId = r.stripeSubscriptionId ? String(r.stripeSubscriptionId) : '';
    return Object.assign({}, r, {
      _status: status,
      _email: email,
      _name: name,
      _plan: plan,
      _intervalLabel: interval,
      _amountLabel: amount,
      _periodLabel: start + ' – ' + end,
      _daysLeft: left,
      _renewDate: renew,
      _renewMeta: r.cancelAtPeriodEnd ? 'Cancels at period end' : 'Renews automatically',
      _customerId: customerId,
      _subId: subId,
    });
  });

  renderDataTable(tableMount, {
    ariaLabel: 'Subscriptions',
    tableClassName: 'sd-subs-table',
    responsive: true,
    emptyText: 'No subscriptions yet.',
    rows: tableRows,
    columns: [
      {
        key: 'subscriber',
        header: 'Subscriber',
        renderHtml: function (r) {
          return '<strong class="sd-subs-name">' + safeText(r._name || r._email || r.uid || '—') + '</strong>' +
            '<div class="sd-subs-muted">' + safeText(r._email || '') + '</div>';
        },
      },
      {
        key: 'status',
        header: 'Status',
        renderHtml: function (r) {
          return '<span class="sd-subs-status sd-subs-status-' + safeText(r._status) + '">' + safeText(r._status) + '</span>';
        },
      },
      { key: 'plan',     header: 'Plan',             renderText: function (r) { return r._plan; } },
      { key: 'interval', header: 'Billing interval', renderText: function (r) { return r._intervalLabel; } },
      { key: 'amount',   header: 'Amount', align: 'right', renderText: function (r) { return r._amountLabel; } },
      {
        key: 'period',
        header: 'Current period',
        renderHtml: function (r) {
          return '<div>' + safeText(r._periodLabel) + '</div>' +
            (r._daysLeft ? '<div class="sd-subs-muted">' + safeText(r._daysLeft) + '</div>' : '');
        },
      },
      {
        key: 'renews',
        header: 'Renews on',
        renderHtml: function (r) {
          return '<div>' + safeText(r._renewDate || '—') + '</div>' +
            (r._renewMeta ? '<div class="sd-subs-muted">' + safeText(r._renewMeta) + '</div>' : '');
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        renderHtml: function (r) {
          return (
            '<button type="button" class="sd-subs-kebab" aria-label="Actions"' +
              ' data-uid="' + safeText(r.uid || '') + '"' +
              ' data-email="' + safeText(r._email || '') + '"' +
              ' data-customer="' + safeText(r._customerId || '') + '"' +
              ' data-subscription="' + safeText(r._subId || '') + '"' +
            '><span class="material-symbols-outlined" aria-hidden="true">more_horiz</span></button>'
          );
        },
      },
    ],
  });

  // Actions: open Stripe dashboard / copy.
  els.subscriptionsPanel.querySelectorAll('.sd-subs-kebab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const customer = String(btn.dataset.customer || '');
      const sub = String(btn.dataset.subscription || '');
      const uid = String(btn.dataset.uid || '');
      const email = String(btn.dataset.email || '');
      const lines = [
        uid ? ('uid: ' + uid) : '',
        email ? ('email: ' + email) : '',
        customer ? ('stripeCustomerId: ' + customer) : '',
        sub ? ('stripeSubscriptionId: ' + sub) : '',
      ].filter(Boolean).join('\n');

      // Lightweight popover menu (admin UX).
      const existing = document.getElementById('sdSubsMenu');
      if (existing) existing.remove();
      const menu = document.createElement('div');
      menu.id = 'sdSubsMenu';
      menu.className = 'sd-subs-menu';
      menu.setAttribute('role', 'menu');

      function addItem(label, onClick, danger) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sd-subs-menu-item' + (danger ? ' sd-subs-menu-item--danger' : '');
        b.textContent = label;
        b.addEventListener('click', function () {
          try { menu.remove(); } catch (_) {}
          onClick();
        });
        menu.appendChild(b);
      }

      addItem('Copy details', function () {
        try {
          if (navigator.clipboard && lines) {
            navigator.clipboard.writeText(lines).then(function () {
              setSectionStatus(els.subscriptionsStatus, 'Copied subscription details.', 'success');
            }).catch(function () {});
          }
        } catch (_) {}
      });
      if (customer) addItem('Open Stripe customer', function () {
        try { window.open(dashBase() + '/customers/' + customer, '_blank', 'noopener'); } catch (_) {}
      });
      if (sub) addItem('Open Stripe subscription', function () {
        try { window.open(dashBase() + '/subscriptions/' + sub, '_blank', 'noopener'); } catch (_) {}
      });
      if (sub) addItem('Cancel subscription (period end)', function () {
        if (!confirm('Cancel this subscription at period end?')) return;
        authedJson('/api/admin/subscriptions/cancel', {
          method: 'POST',
          body: JSON.stringify({ subscriptionId: sub, cancelAtPeriodEnd: true }),
        }).then(function () {
          subscriptionsState = null;
          refreshSubscriptions();
        }).catch(function (err) {
          setSectionStatus(els.subscriptionsStatus, err.message || 'Cancel failed.', 'error');
        });
      }, true);

      document.body.appendChild(menu);
      try {
        const r = btn.getBoundingClientRect();
        menu.style.top = Math.round(r.bottom + 8 + window.scrollY) + 'px';
        menu.style.left = Math.min(window.innerWidth - 220, Math.round(r.right - 200 + window.scrollX)) + 'px';
      } catch (_) {}
      setTimeout(function () {
        document.addEventListener('click', function onDoc(e) {
          const t = e && e.target;
          if (t && (menu.contains(t) || btn.contains(t))) return;
          try { menu.remove(); } catch (_) {}
        }, { once: true });
      }, 0);
    });
  });
}


async function refreshMediaAudit() {
  if (!els.mediaAuditPanel) return;
  setSectionStatus(els.mediaAuditStatus, 'Loading media inventory…', 'info');
  els.mediaAuditPanel.textContent = '';
  try {
    const data = await authedJson('/api/admin/media/audit');
    mediaAuditState = data;
    mediaAuditView.visibleCount = 0;
    paintMediaAudit();
    setSectionStatus(els.mediaAuditStatus, 'Media inventory updated.', 'success');
  } catch (err) {
    setSectionStatus(els.mediaAuditStatus, err.message || 'Failed to load media inventory.', 'error');
  }
}

function paintMediaAudit() {
  if (!els.mediaAuditPanel) return;
  els.mediaAuditPanel.textContent = '';
  const state = mediaAuditState || {};
  const objects = Array.isArray(state.objects) ? state.objects.slice() : [];
  const orphanOnly = !!els.mediaOrphansOnly?.checked;

  // Build article list for filter dropdown.
  const refArticles = new Map(); // articleId -> title
  objects.forEach(function (o) {
    const refs = Array.isArray(o.referencedBy) ? o.referencedBy : [];
    refs.forEach(function (r) {
      if (!r || !r.articleId) return;
      refArticles.set(r.articleId, r.title || r.articleId);
    });
  });
  const articleOptions = Array.from(refArticles.entries())
    .sort(function (a, b) { return String(a[1]).localeCompare(String(b[1])); })
    .map(function (pair) { return { id: pair[0], title: pair[1] }; });

  function isUsed(o) {
    return Array.isArray(o.referencedBy) && o.referencedBy.length > 0;
  }

  // Apply filters
  let filtered = objects.slice();
  if (orphanOnly) filtered = filtered.filter(function (o) { return !!o.isOrphan; });
  if (mediaAuditView.status === 'used') filtered = filtered.filter(isUsed);
  if (mediaAuditView.status === 'orphan') filtered = filtered.filter(function (o) { return !isUsed(o); });
  if (mediaAuditView.article !== 'all') {
    filtered = filtered.filter(function (o) {
      const refs = Array.isArray(o.referencedBy) ? o.referencedBy : [];
      return refs.some(function (r) { return r.articleId === mediaAuditView.article; });
    });
  }
  const q = String(mediaAuditView.query || '').trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(function (o) {
      const name = String(o.name || '').toLowerCase();
      if (name.includes(q)) return true;
      const refs = Array.isArray(o.referencedBy) ? o.referencedBy : [];
      return refs.some(function (r) {
        return String(r.title || r.articleId || '').toLowerCase().includes(q);
      });
    });
  }

  // Apply sort
  filtered.sort(function (a, b) {
    const aName = String(a.name || '');
    const bName = String(b.name || '');
    if (mediaAuditView.sort === 'oldest') return Number(a.updatedAt || 0) - Number(b.updatedAt || 0);
    if (mediaAuditView.sort === 'largest') return Number(b.size || 0) - Number(a.size || 0);
    if (mediaAuditView.sort === 'smallest') return Number(a.size || 0) - Number(b.size || 0);
    if (mediaAuditView.sort === 'name_asc') return aName.localeCompare(bName);
    if (mediaAuditView.sort === 'name_desc') return bName.localeCompare(aName);
    return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  });

  // Reset lazy-loading window if needed.
  if (!mediaAuditView.visibleCount) {
    mediaAuditView.visibleCount = Math.min(mediaAuditView.batchSize, filtered.length);
  } else if (mediaAuditView.visibleCount > filtered.length) {
    mediaAuditView.visibleCount = filtered.length;
  }

  // KPI cards
  const kpis = document.createElement('div');
  kpis.className = 'sd-media-kpis';
  const metrics = computeMediaMetrics(objects);
  const BUDGET_BYTES = 5 * 1024 * 1024 * 1024; // UI-only reference budget
  kpis.innerHTML = ''
    + '<div class="sd-media-kpi sd-media-kpi--total"><div class="sd-media-kpi-ico material-symbols-outlined" aria-hidden="true">folder</div><div><div class="sd-media-kpi-num">'
    + metrics.total.count + '</div><div class="sd-media-kpi-lbl">Total files</div><div class="sd-media-kpi-sub">' + formatBytes(metrics.total.bytes) + '</div></div></div>'
    + '<div class="sd-media-kpi sd-media-kpi--used"><div class="sd-media-kpi-ico material-symbols-outlined" aria-hidden="true">description</div><div><div class="sd-media-kpi-num">'
    + metrics.used.count + '</div><div class="sd-media-kpi-lbl">Used in articles</div><div class="sd-media-kpi-sub">' + formatBytes(metrics.used.bytes) + ' (' + pct(metrics.used.bytes, metrics.total.bytes) + ')</div></div></div>'
    + '<div class="sd-media-kpi sd-media-kpi--orphan"><div class="sd-media-kpi-ico material-symbols-outlined" aria-hidden="true">delete</div><div><div class="sd-media-kpi-num">'
    + metrics.orphan.count + '</div><div class="sd-media-kpi-lbl">Orphaned files</div><div class="sd-media-kpi-sub">' + formatBytes(metrics.orphan.bytes) + ' (' + pct(metrics.orphan.bytes, metrics.total.bytes) + ')</div></div></div>'
    + '<div class="sd-media-kpi sd-media-kpi--storage"><div class="sd-media-kpi-ico material-symbols-outlined" aria-hidden="true">pie_chart</div><div><div class="sd-media-kpi-num">'
    + pct(metrics.total.bytes, BUDGET_BYTES) + '</div><div class="sd-media-kpi-lbl">Storage used</div><div class="sd-media-kpi-sub">of 5 GB</div></div></div>';
  els.mediaAuditPanel.appendChild(kpis);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'sd-media-toolbar';
  toolbar.innerHTML = ''
    + '<div class="sd-media-search-wrap">'
    + '  <span class="material-symbols-outlined" aria-hidden="true">search</span>'
    + '  <input class="sd-media-search" type="search" placeholder="Search by file name or article…" />'
    + '</div>'
    + '<select class="sd-media-select" data-field="status" aria-label="Status filter">'
    + '  <option value="all">All status</option>'
    + '  <option value="used">Used</option>'
    + '  <option value="orphan">Orphan</option>'
    + '</select>'
    + '<select class="sd-media-select" data-field="article" aria-label="Article filter">'
    + '  <option value="all">All articles</option>'
    + '</select>'
    + '<select class="sd-media-select" data-field="sort" aria-label="Sort">'
    + '  <option value="newest">Sort: newest</option>'
    + '  <option value="oldest">Sort: oldest</option>'
    + '  <option value="largest">Sort: largest</option>'
    + '  <option value="smallest">Sort: smallest</option>'
    + '  <option value="name_asc">Sort: name A→Z</option>'
    + '  <option value="name_desc">Sort: name Z→A</option>'
    + '</select>';
  els.mediaAuditPanel.appendChild(toolbar);

  const searchInput = toolbar.querySelector('.sd-media-search');
  const statusSel = toolbar.querySelector('select[data-field="status"]');
  const articleSel = toolbar.querySelector('select[data-field="article"]');
  const sortSel = toolbar.querySelector('select[data-field="sort"]');

  if (searchInput) searchInput.value = safeText(mediaAuditView.query);
  if (statusSel) statusSel.value = mediaAuditView.status;
  if (sortSel) sortSel.value = mediaAuditView.sort;
  if (articleSel) {
    articleOptions.forEach(function (opt) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.title;
      articleSel.appendChild(o);
    });
    articleSel.value = mediaAuditView.article;
  }

  function bindFilterEvents() {
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        mediaAuditView.query = searchInput.value || '';
        mediaAuditView.visibleCount = 0;
        paintMediaAudit();
      });
    }
    if (statusSel) {
      statusSel.addEventListener('change', function () {
        mediaAuditView.status = statusSel.value || 'all';
        mediaAuditView.visibleCount = 0;
        paintMediaAudit();
      });
    }
    if (articleSel) {
      articleSel.addEventListener('change', function () {
        mediaAuditView.article = articleSel.value || 'all';
        mediaAuditView.visibleCount = 0;
        paintMediaAudit();
      });
    }
    if (sortSel) {
      sortSel.addEventListener('change', function () {
        mediaAuditView.sort = sortSel.value || 'newest';
        mediaAuditView.visibleCount = 0;
        paintMediaAudit();
      });
    }
  }
  bindFilterEvents();

  // Compact summary bar
  const summary = document.createElement('div');
  summary.className = 'sd-media-summary';
  summary.innerHTML = '<div><strong>' + (state.bucket || 'media') + '</strong> · '
    + String(state.prefix || 'media/') + '</div>'
    + '<div>'
    + String(filtered.length) + ' results'
    + '</div>';
  els.mediaAuditPanel.appendChild(summary);

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-media-empty';
    empty.textContent = orphanOnly ? 'No orphaned images found.' : 'No media objects found.';
    els.mediaAuditPanel.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'sd-media-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>'
    + '<th class="sd-media-col-preview">Preview</th>'
    + '<th>File</th>'
    + '<th>Article</th>'
    + '<th>Status</th>'
    + '<th class="sd-media-col-size">Size</th>'
    + '<th class="sd-media-col-uploaded">Uploaded</th>'
    + '<th class="sd-media-col-actions">Actions</th>'
    + '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  filtered.slice(0, mediaAuditView.visibleCount).forEach(function (o) {
    const tr = document.createElement('tr');
    if (o.isOrphan) tr.className = 'sd-media-row-orphan';

    const refs = Array.isArray(o.referencedBy) ? o.referencedBy : [];

    // Preview
    const previewTd = document.createElement('td');
    previewTd.className = 'sd-media-col-preview';
    const img = document.createElement('img');
    img.className = 'sd-media-thumb sd-media-thumb--sm';
    img.loading = 'lazy';
    img.alt = '';
    img.src = o.url;
    previewTd.appendChild(img);

    // File
    const fileTd = document.createElement('td');
    const fileName = document.createElement('a');
    fileName.className = 'sd-media-name';
    fileName.href = o.url;
    fileName.target = '_blank';
    fileName.rel = 'noopener noreferrer';
    fileName.textContent = String(o.name || '').replace(/^media\//, '');
    const fileMeta = document.createElement('div');
    fileMeta.className = 'sd-media-meta';
    fileMeta.textContent = (o.contentType ? o.contentType : '') + (o.contentType ? ' · ' : '') + formatBytes(o.size || 0);
    fileTd.appendChild(fileName);
    fileTd.appendChild(fileMeta);

    // Article
    const articleTd = document.createElement('td');
    if (!refs.length) {
      const orphanText = document.createElement('div');
      orphanText.className = 'sd-media-meta';
      orphanText.textContent = '(No article)';
      articleTd.appendChild(orphanText);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'sd-media-refs';
      refs.slice(0, 2).forEach(function (r) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sd-media-ref';
        btn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">article</span><span></span>';
        const label = btn.querySelector('span:last-child');
        label.textContent = r.title || r.articleId || 'Article';
        btn.addEventListener('click', function () {
          const article = articles.find(function (a) { return a.id === r.articleId; });
          setActiveModule('system-design');
          if (article) fillForm(article);
        });
        wrap.appendChild(btn);
      });
      if (refs.length > 2) {
        const more = document.createElement('div');
        more.className = 'sd-media-meta';
        more.textContent = '+' + (refs.length - 2) + ' more';
        wrap.appendChild(more);
      }
      articleTd.appendChild(wrap);
    }

    // Status
    const statusTd = document.createElement('td');
    const chip = document.createElement('span');
    chip.className = 'sd-media-status ' + (refs.length ? 'sd-media-status--used' : 'sd-media-status--orphan');
    chip.innerHTML = refs.length
      ? '<span class="material-symbols-outlined" aria-hidden="true">check</span><span>Used</span>'
      : '<span class="material-symbols-outlined" aria-hidden="true">delete</span><span>Orphan</span>';
    statusTd.appendChild(chip);

    // Size
    const sizeTd = document.createElement('td');
    sizeTd.className = 'sd-media-col-size';
    sizeTd.textContent = formatBytes(o.size || 0);

    // Uploaded
    const uploadedTd = document.createElement('td');
    uploadedTd.className = 'sd-media-col-uploaded';
    uploadedTd.textContent = o.updatedAt ? formatWhen(o.updatedAt) : '';

    // Actions
    const actionsTd = document.createElement('td');
    actionsTd.className = 'sd-media-col-actions';
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'reco-actions sd-media-actions';

    const actionsBtn = document.createElement('button');
    actionsBtn.type = 'button';
    actionsBtn.className = 'reco-actions-trigger sd-media-actions-trigger';
    actionsBtn.title = 'Row actions';
    actionsBtn.setAttribute('aria-label', 'Row actions');
    actionsBtn.setAttribute('aria-haspopup', 'menu');
    actionsBtn.setAttribute('aria-expanded', 'false');
    actionsBtn.appendChild(makeIcon('more_vert'));

    const menu = document.createElement('div');
    menu.className = 'reco-actions-menu sd-media-actions-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');

    const openItem = document.createElement('button');
    openItem.type = 'button';
    openItem.className = 'reco-action-item';
    openItem.setAttribute('role', 'menuitem');
    openItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">open_in_new</span><span>Open file</span>';
    openItem.addEventListener('click', function () {
      closeMediaActionMenus();
      window.open(o.url, '_blank', 'noopener,noreferrer');
    });

    const copyItem = document.createElement('button');
    copyItem.type = 'button';
    copyItem.className = 'reco-action-item';
    copyItem.setAttribute('role', 'menuitem');
    copyItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">content_copy</span><span>Copy URL</span>';
    copyItem.addEventListener('click', async function () {
      closeMediaActionMenus();
      try {
        await navigator.clipboard.writeText(o.url);
        setSectionStatus(els.mediaAuditStatus, 'Copied URL.', 'success');
      } catch (_) {
        prompt('Copy URL:', o.url);
      }
    });

    menu.append(openItem, copyItem);

    if (refs.length) {
      const articleItem = document.createElement('button');
      articleItem.type = 'button';
      articleItem.className = 'reco-action-item';
      articleItem.setAttribute('role', 'menuitem');
      articleItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">article</span><span>Open article</span>';
      articleItem.addEventListener('click', function () {
        closeMediaActionMenus();
        const r = refs[0];
        const article = articles.find(function (a) { return a.id === r.articleId; });
        setActiveModule('system-design');
        if (article) fillForm(article);
      });
      menu.appendChild(articleItem);
    }

    if (!refs.length) {
      const delItem = document.createElement('button');
      delItem.type = 'button';
      delItem.className = 'reco-action-item reco-action-item-destructive';
      delItem.setAttribute('role', 'menuitem');
      delItem.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">delete</span><span>Delete</span>';
      delItem.addEventListener('click', async function () {
        closeMediaActionMenus();
        const filename = String(o.name || '').replace(/^media\//, '');
        if (!confirm('Delete this orphaned image?\n\n' + filename + '\n\nThis cannot be undone.')) return;
        delItem.disabled = true;
        setSectionStatus(els.mediaAuditStatus, 'Deleting ' + filename + '…', 'info');
        try {
          await authedJson('/api/admin/media/object?name=' + encodeURIComponent(o.name), { method: 'DELETE' });
          setSectionStatus(els.mediaAuditStatus, 'Deleted ' + filename + '.', 'success');
          mediaAuditState = null;
          await refreshMediaAudit();
        } catch (err) {
          setSectionStatus(els.mediaAuditStatus, err.message || 'Delete failed.', 'error');
        } finally {
          delItem.disabled = false;
        }
      });
      menu.appendChild(delItem);
    }

    actionsBtn.addEventListener('click', function (event) {
      event.stopPropagation();
      const willOpen = menu.hidden;
      closeMediaActionMenus();
      closeSectionActionMenus();
      closeArticleDetailsMenu();
      closePolicyRuleMenus();
      menu.hidden = !willOpen;
      actionsBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    menu.addEventListener('click', function (event) { event.stopPropagation(); });

    actionsWrap.append(actionsBtn, menu);
    actionsTd.appendChild(actionsWrap);

    tr.appendChild(previewTd);
    tr.appendChild(fileTd);
    tr.appendChild(articleTd);
    tr.appendChild(statusTd);
    tr.appendChild(sizeTd);
    tr.appendChild(uploadedTd);
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const tableWrap = document.createElement('div');
  tableWrap.className = 'sd-media-table-wrap';
  tableWrap.appendChild(table);
  els.mediaAuditPanel.appendChild(tableWrap);

  // Lazy-load sentinel
  const footer = document.createElement('div');
  footer.className = 'sd-media-footer';
  const shown = Math.min(mediaAuditView.visibleCount, filtered.length);
  footer.innerHTML = '<span>Showing <strong>' + shown + '</strong> of <strong>' + filtered.length + '</strong></span>';
  els.mediaAuditPanel.appendChild(footer);

  if (shown < filtered.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'sd-media-sentinel';
    sentinel.textContent = 'Loading more…';
    els.mediaAuditPanel.appendChild(sentinel);

    if (mediaAuditView.observer) {
      try { mediaAuditView.observer.disconnect(); } catch (_) {}
    }
    mediaAuditView.observer = new IntersectionObserver(function (entries) {
      const hit = entries && entries[0] && entries[0].isIntersecting;
      if (!hit) return;
      mediaAuditView.visibleCount = Math.min(filtered.length, mediaAuditView.visibleCount + mediaAuditView.batchSize);
      paintMediaAudit();
    }, { root: null, rootMargin: '240px 0px', threshold: 0.01 });
    mediaAuditView.observer.observe(sentinel);
  } else if (mediaAuditView.observer) {
    try { mediaAuditView.observer.disconnect(); } catch (_) {}
    mediaAuditView.observer = null;
  }
}

function autoFixArticleSettingsOrder() {
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  cards
    .sort(function (a, b) {
      const aOrder = Number(a.querySelector('[data-field="order"]')?.value || 9999);
      const bOrder = Number(b.querySelector('[data-field="order"]')?.value || 9999);
      return aOrder - bOrder || String(a.dataset.title || '').localeCompare(String(b.dataset.title || ''));
    })
    .forEach(function (card, index) {
      const orderInput = card.querySelector('[data-field="order"]');
      orderInput.value = String((index + 1) * 10);
    });
  renderArticleSettingsWarnings();
  setSectionStatus(els.articleSettingsStatus, 'Order reset to clean 10, 20, 30 sequence. Save settings to publish the change.', 'success');
}

function articleSettingsPayloadFromCard(card) {
  const original = articles.find(function (article) { return article.id === card.dataset.id; });
  if (!original) return null;
  const input = function (field) {
    return card.querySelector('[data-field="' + field + '"]');
  };
  return {
    previousId: original.id,
    article: Object.assign({}, original, {
      id: slugify(input('id').value || original.id),
      icon: input('icon').value.trim() || 'article',
      readMinutes: input('readMinutes').value ? Number(input('readMinutes').value) : null,
      order: Number(input('order').value || 100),
      tier: input('tier').value || 'free',
      status: input('status').value || original.status || 'Draft',
      stub: input('status').value === 'Coming soon',
    }),
  };
}

async function saveArticleSettings() {
  if (renderArticleSettingsWarnings()) return;
  const cards = Array.from(els.articleSettingsList.querySelectorAll('.sd-article-settings-card'));
  if (!cards.length) return;
  setSectionStatus(els.articleSettingsStatus, 'Saving article settings...', 'info');
  const savedRecords = [];
  for (const card of cards) {
    const payload = articleSettingsPayloadFromCard(card);
    if (!payload || !payload.article.id) continue;
    const data = await authedJson('/api/admin/system-design/articles/' + payload.previousId, {
      method: 'PUT',
      body:   JSON.stringify(payload.article),
    });
    savedRecords.push({ previousId: payload.previousId, article: data.article });
  }
  savedRecords.forEach(function (record) {
    articles = articles.filter(function (article) {
      return article.id !== record.previousId && article.id !== record.article.id;
    }).concat(record.article);
  });
  articles = articles.sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  const selectedRecord = savedRecords.find(function (record) { return record.previousId === selectedId; });
  if (selectedRecord) selectedId = selectedRecord.article.id;
  const current = articles.find(function (article) { return article.id === selectedId; });
  if (current) fillForm(current);
  renderList();
  renderArticleSettings();
  setSectionStatus(els.articleSettingsStatus, 'Article settings saved.', 'success');
}

// ── Tier Settings ─────────────────────────────────────────────────────────────
let tierConfig = null;

async function loadTierConfig() {
  try {
    const data = await authedJson('/api/system-design/tier-config');
    tierConfig = data.config || { free: { items: [] }, premium: { items: [] } };
  } catch (_) {
    tierConfig = { free: { items: [] }, premium: { items: [] } };
  }
}

function buildTierList(tier) {
  const items = (tierConfig && tierConfig[tier] && tierConfig[tier].items) || [];
  const container = document.createElement('div');
  container.className = 'sd-tier-items-editor';
  container.dataset.tier = tier;

  items.forEach(function (item, idx) {
    container.appendChild(buildTierItemRow(item, idx));
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'sd-tier-add-btn';
  addBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">add</span> Add item';
  addBtn.addEventListener('click', function () {
    const newIdx = container.querySelectorAll('.sd-tier-item-row').length;
    container.insertBefore(buildTierItemRow({ icon: 'article', label: '' }, newIdx), addBtn);
  });
  container.appendChild(addBtn);
  return container;
}

function buildTierItemRow(item, _idx) {
  const row = document.createElement('div');
  row.className = 'sd-tier-item-row';
  row.innerHTML =
    '<input class="sd-tier-icon-input" type="text" placeholder="Material icon name" value="' + (item.icon || '') + '" aria-label="Icon name">' +
    '<input class="sd-tier-label-input" type="text" placeholder="Benefit label" value="' + (item.label || '') + '" aria-label="Benefit label">' +
    '<button type="button" class="sd-tier-remove-btn" aria-label="Remove item">' +
      '<span class="material-symbols-outlined" aria-hidden="true">delete</span>' +
    '</button>';
  row.querySelector('.sd-tier-remove-btn').addEventListener('click', function () {
    row.remove();
  });
  return row;
}

function tierItemsFromEditor(container) {
  return Array.from(container.querySelectorAll('.sd-tier-item-row')).map(function (row) {
    return {
      icon:  row.querySelector('.sd-tier-icon-input').value.trim() || 'article',
      label: row.querySelector('.sd-tier-label-input').value.trim(),
    };
  }).filter(function (item) { return item.label; });
}

async function renderTierSettings() {
  const panel = els.tierSettingsPanel;
  panel.innerHTML = '<p class="sd-article-settings-loading">Loading tier config…</p>';
  await loadTierConfig();
  panel.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'sd-tier-settings-grid';

  ['free', 'premium'].forEach(function (tier) {
    const card = document.createElement('div');
    card.className = 'sd-tier-settings-card';
    const head = document.createElement('div');
    head.className = 'sd-tier-settings-card-head';
    const icon = tier === 'free' ? 'lock_open' : 'workspace_premium';
    const title = tier === 'free' ? 'Free Tier' : 'Premium Tier';
    head.innerHTML =
      '<span class="material-symbols-outlined" aria-hidden="true">' + icon + '</span>' +
      '<h3>' + title + '</h3>' +
      '<p>Benefit items shown in the tier gate card</p>';
    card.appendChild(head);
    card.appendChild(buildTierList(tier));
    grid.appendChild(card);
  });

  panel.appendChild(grid);
}

async function saveTierSettings() {
  setSectionStatus(els.tierSettingsStatus, 'Saving tier settings…', 'info');
  const freeItems    = tierItemsFromEditor(els.tierSettingsPanel.querySelector('[data-tier="free"]'));
  const premItems    = tierItemsFromEditor(els.tierSettingsPanel.querySelector('[data-tier="premium"]'));
  await authedJson('/api/admin/system-design/tier-config', {
    method: 'PUT',
    body:   JSON.stringify({ free: { items: freeItems }, premium: { items: premItems } }),
  });
  tierConfig = { free: { items: freeItems }, premium: { items: premItems } };
  setSectionStatus(els.tierSettingsStatus, 'Tier settings saved.', 'success');
}

// ── Metadata Configuration ────────────────────────────────────────────────────
let _metaEnabledMap = null;

async function renderMetadataConfig() {
  const panel = els.metadataConfigPanel;
  panel.innerHTML = '<p class="sd-article-settings-loading">Loading configuration…</p>';
  try {
    const data = await authedJson('/api/system-design/component-registry');
    _metaEnabledMap = data.enabled || {};
  } catch (_) {
    _metaEnabledMap = {};
  }

  // Group components by their group label and render via reusable Toggle Cards.
  const byGroup = {};
  COMPONENT_REGISTRY.forEach(function (comp) {
    if (!byGroup[comp.group]) byGroup[comp.group] = [];
    byGroup[comp.group].push(comp);
  });

  const groups = Object.entries(byGroup).map(function ([groupName, comps]) {
    return {
      title: groupName,
      items: comps.map(function (comp) {
        return {
          id: comp.id,
          label: comp.label,
          hint: comp.hint,
          icon: comp.icon,
          enabled: _metaEnabledMap[comp.id] !== false, // default ON
        };
      }),
    };
  });

  renderToggleCardGroups(panel, {
    ariaLabel: 'Metadata configuration',
    idPrefix: 'meta-toggle-',
    groups,
    onToggle: function (item, enabled) {
      // Keep in-memory state in sync so other admin modules can reuse the map.
      if (!_metaEnabledMap) _metaEnabledMap = {};
      _metaEnabledMap[item.id] = enabled;
    },
  });
}

async function saveMetadataConfig() {
  setSectionStatus(els.metadataConfigStatus, 'Saving configuration…', 'info');
  const enabled = {};
  els.metadataConfigPanel.querySelectorAll('input[data-comp-id]').forEach(function (input) {
    enabled[input.dataset.compId] = input.checked;
  });
  await authedJson('/api/admin/system-design/component-registry', {
    method: 'PUT',
    body:   JSON.stringify({ enabled }),
  });
  _metaEnabledMap = enabled;
  setSectionStatus(els.metadataConfigStatus, 'Configuration saved.', 'success');
}

// ── Sponsorships ──────────────────────────────────────────────────────────────
let _sponsors = [];
let _editingSponsorId = null;

const PLACEMENT_LABELS = {
  'article-footer':  'Article Footer',
  'homepage':        'Homepage — Right Column',
  'homepage-left':   'Homepage — Left Column',
  'sticky-corner':   'Sticky Corner (above chat agent)',
  'sidebar':         'System Design Sidebar',
};

async function renderSponsorships() {
  const panel = els.sponsorshipsPanel;
  panel.innerHTML = '<p class="sd-article-settings-loading">Loading sponsors…</p>';
  closeSponsorDrawer();
  try {
    const data = await authedJson('/api/admin/sponsorships');
    _sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
  } catch (_) {
    _sponsors = [];
  }
  panel.innerHTML = '';
  if (!_sponsors.length) {
    panel.innerHTML = '<p class="sd-article-settings-loading">No sponsors yet. Click "New sponsor" to add one.</p>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'sd-sponsor-grid';
  _sponsors.forEach(function (s) {
    const card = document.createElement('div');
    card.className = 'sd-sponsor-card' + (s.active ? ' sd-sponsor-card--active' : '');
    card.innerHTML =
      '<div class="sd-sponsor-card-top">' +
        (s.logoUrl ? '<img src="' + s.logoUrl + '" alt="' + s.company + '" class="sd-sponsor-logo">' : '<div class="sd-sponsor-logo-placeholder"><span class="material-symbols-outlined">business</span></div>') +
        '<div class="sd-sponsor-badge ' + (s.active ? 'sd-sponsor-badge--active' : 'sd-sponsor-badge--inactive') + '">' + (s.active ? 'Active' : 'Inactive') + '</div>' +
      '</div>' +
      '<div class="sd-sponsor-card-body">' +
        '<strong>' + escHtml(s.company) + '</strong>' +
        '<span>' + escHtml(s.headline) + '</span>' +
        '<div class="sd-sponsor-meta">' +
          '<span class="material-symbols-outlined">location_on</span>' +
          (PLACEMENT_LABELS[s.placement] || s.placement) +
          (s.expiresAt ? ' · Expires ' + new Date(s.expiresAt).toLocaleDateString() : '') +
        '</div>' +
      '</div>' +
      '<button type="button" class="sd-sponsor-edit-btn" aria-label="Edit sponsor">Edit</button>';
    card.querySelector('.sd-sponsor-edit-btn').addEventListener('click', function () {
      openSponsorDrawer(s);
    });
    grid.appendChild(card);
  });
  panel.appendChild(grid);
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openSponsorDrawer(sponsor) {
  _editingSponsorId = sponsor ? sponsor.id : null;
  els.sponsorDrawerTitle.textContent = sponsor ? 'Edit Sponsor' : 'New Sponsor';
  els.sponsorDrawer.hidden = false;
  els.deleteSponsorBtn.hidden = !sponsor;
  setSectionStatus(els.sponsorDrawerStatus, '', 'info');

  document.getElementById('sponsorCompany').value    = sponsor ? sponsor.company    : '';
  document.getElementById('sponsorHeadline').value   = sponsor ? sponsor.headline   : '';
  document.getElementById('sponsorCta').value        = sponsor ? sponsor.cta        : 'Learn More';
  document.getElementById('sponsorCtaUrl').value     = sponsor ? sponsor.ctaUrl     : '';
  document.getElementById('sponsorLogoUrl').value    = sponsor ? sponsor.logoUrl    : '';
  document.getElementById('sponsorPlacement').value  = sponsor ? sponsor.placement  : 'article-footer';
  document.getElementById('sponsorAdsenseSlot').value = sponsor ? sponsor.adsenseSlot : '';
  document.getElementById('sponsorActive').checked   = sponsor ? sponsor.active     : true;
  document.getElementById('sponsorStartsAt').value   = sponsor && sponsor.startsAt  ? new Date(sponsor.startsAt).toISOString().split('T')[0]  : '';
  document.getElementById('sponsorExpiresAt').value  = sponsor && sponsor.expiresAt ? new Date(sponsor.expiresAt).toISOString().split('T')[0] : '';
}

function closeSponsorDrawer() {
  els.sponsorDrawer.hidden = true;
  _editingSponsorId = null;
}

async function saveSponsor() {
  if (els.saveSponsorBtn.disabled) return;
  els.saveSponsorBtn.disabled = true;
  setSectionStatus(els.sponsorDrawerStatus, 'Saving…', 'info');
  try {
    const payload = {
      company:     document.getElementById('sponsorCompany').value.trim(),
      headline:    document.getElementById('sponsorHeadline').value.trim(),
      cta:         document.getElementById('sponsorCta').value.trim() || 'Learn More',
      ctaUrl:      document.getElementById('sponsorCtaUrl').value.trim(),
      logoUrl:     document.getElementById('sponsorLogoUrl').value.trim(),
      placement:   document.getElementById('sponsorPlacement').value,
      adsenseSlot: document.getElementById('sponsorAdsenseSlot').value.trim(),
      active:      document.getElementById('sponsorActive').checked,
      startsAt:    document.getElementById('sponsorStartsAt').value  || null,
      expiresAt:   document.getElementById('sponsorExpiresAt').value || null,
    };
    const url    = _editingSponsorId ? '/api/admin/sponsorships/' + _editingSponsorId : '/api/admin/sponsorships';
    const method = _editingSponsorId ? 'PUT' : 'POST';
    await authedJson(url, { method, body: JSON.stringify(payload) });
    setSectionStatus(els.sponsorDrawerStatus, 'Saved!', 'success');
    setTimeout(function () { closeSponsorDrawer(); renderSponsorships(); }, 800);
  } finally {
    els.saveSponsorBtn.disabled = false;
  }
}

async function deleteSponsor() {
  if (!_editingSponsorId) return;
  if (!confirm('Delete this sponsor? This cannot be undone.')) return;
  await authedJson('/api/admin/sponsorships/' + _editingSponsorId, { method: 'DELETE' });
  closeSponsorDrawer();
  renderSponsorships();
}

// ── SEO & AEO configuration ────────────────────────────────────────────────────

let _seoConfig = null;

function updateSerpPreview() {
  const url   = (els.seoSiteUrl.value || '').replace(/\/$/, '');
  const desc  = els.seoSiteDescription.value || '';
  if (els.seoSerpUrl)   els.seoSerpUrl.textContent   = url || 'https://your-domain.com';
  if (els.seoSerpTitle) els.seoSerpTitle.textContent = 'Abhinav Kumar — Senior Salesforce Application Engineer';
  if (els.seoSerpDesc)  els.seoSerpDesc.textContent  = desc.slice(0, 160) || 'Meta description will appear here…';
  const count = desc.length;
  if (els.seoDescCharCount) {
    els.seoDescCharCount.textContent = count + ' / 160';
    els.seoDescCharCount.style.color = count > 160 ? 'var(--md-sys-color-error)' : '';
  }
}

async function renderSeoConfig() {
  setSectionStatus(els.seoConfigStatus, 'Loading…', 'info');
  try {
    const data = await authedJson('/api/system-design/seo-config');
    _seoConfig = data.config || {};
    els.seoSiteUrl.value              = _seoConfig.siteUrl           || '';
    els.seoSiteDescription.value      = _seoConfig.siteDescription   || '';
    els.seoOgImageUrl.value           = _seoConfig.ogImageUrl         || '';
    els.seoAdsensePublisherId.value   = _seoConfig.adsensePublisherId || '';
    els.seoJsonLd.checked             = _seoConfig.jsonLdEnabled      !== false;
    els.seoSitemap.checked            = _seoConfig.sitemapEnabled     !== false;
    els.seoHreflangFr.checked         = !!_seoConfig.hreflangFrEnabled;
    els.seoRobotsNoindex.checked      = !!_seoConfig.robotsNoindex;
    els.seoLlmsTxtEnabled.checked     = !!_seoConfig.llmsTxtEnabled;
    els.seoAiCrawlersAllowed.checked  = _seoConfig.aiCrawlersAllowed !== false;
    els.seoEeatSignalsEnabled.checked = _seoConfig.eeatSignalsEnabled !== false;
    updateSerpPreview();
    setSectionStatus(els.seoConfigStatus, '', '');
  } catch (err) {
    setSectionStatus(els.seoConfigStatus, 'Failed to load SEO config: ' + err.message, 'error');
  }
}

async function saveSeoConfig() {
  setSectionStatus(els.seoConfigStatus, 'Saving…', 'info');
  els.saveSeoConfigBtn.disabled = true;
  try {
    const payload = {
      siteUrl:             els.seoSiteUrl.value.trim(),
      siteDescription:     els.seoSiteDescription.value.trim(),
      ogImageUrl:          els.seoOgImageUrl.value.trim(),
      adsensePublisherId:  els.seoAdsensePublisherId.value.trim(),
      jsonLdEnabled:       els.seoJsonLd.checked,
      sitemapEnabled:      els.seoSitemap.checked,
      hreflangFrEnabled:   els.seoHreflangFr.checked,
      robotsNoindex:       els.seoRobotsNoindex.checked,
      llmsTxtEnabled:      els.seoLlmsTxtEnabled.checked,
      aiCrawlersAllowed:   els.seoAiCrawlersAllowed.checked,
      eeatSignalsEnabled:  els.seoEeatSignalsEnabled.checked,
    };
    await authedJson('/api/admin/system-design/seo-config', { method: 'PUT', body: JSON.stringify(payload) });
    _seoConfig = payload;
    setSectionStatus(els.seoConfigStatus, 'SEO settings saved.', 'success');
  } catch (err) {
    setSectionStatus(els.seoConfigStatus, 'Save failed: ' + err.message, 'error');
  } finally {
    els.saveSeoConfigBtn.disabled = false;
  }
}

// ── Atlas AI config ───────────────────────────────────────────────────────────
// All model keys and their display labels — single source of truth for the UI.
const ATLAS_ALL_MODELS = {
  'flash-lite': { label: 'Gemini 2.5 Flash-Lite', detail: 'Fast & economical · Default' },
  'flash':      { label: 'Gemini 2.5 Flash',      detail: 'More detailed · Higher cost'  },
};
let _atlasConfig = null;

async function renderAtlasConfig() {
  setSectionStatus(els.atlasConfigStatus, 'Loading…', 'info');
  try {
    const data = await authedJson('/api/admin/atlas/config');
    _atlasConfig = data.config || {};
    const enabled = Array.isArray(_atlasConfig.enabledModels) ? _atlasConfig.enabledModels : ['flash-lite', 'flash'];
    const defaultModel = _atlasConfig.defaultModel || 'flash-lite';

    // Build model toggle rows
    els.atlasModelRows.innerHTML = '';
    Object.keys(ATLAS_ALL_MODELS).forEach(function (key) {
      const meta   = ATLAS_ALL_MODELS[key];
      const isOn   = enabled.includes(key);
      const isDef  = defaultModel === key;
      const row = document.createElement('div');
      row.className = 'sd-atlas-model-row';
      row.innerHTML = [
        '<div class="sd-atlas-model-info">',
        '  <strong>' + meta.label + '</strong>',
        '  <span>' + meta.detail + '</span>',
        '</div>',
        '<div class="sd-atlas-model-controls">',
        '  <label class="sd-atlas-default-label" title="Set as default">',
        '    <input type="radio" name="atlasDefaultModel" value="' + key + '"' + (isDef ? ' checked' : '') + '>',
        '    <span>Default</span>',
        '  </label>',
        '  <label class="sd-toggle-switch" aria-label="Enable ' + meta.label + '">',
        '    <input type="checkbox" class="sd-atlas-model-toggle" data-key="' + key + '"' + (isOn ? ' checked' : '') + '>',
        '    <span class="sd-toggle-slider"></span>',
        '  </label>',
        '</div>',
      ].join('');
      els.atlasModelRows.appendChild(row);
    });

    els.atlasModelSelectorVisible.checked = _atlasConfig.modelSelectorVisible !== false;
    els.atlasBudgetCapInr.value = typeof _atlasConfig.budgetCapInr === 'number' ? _atlasConfig.budgetCapInr : 100;
    els.atlasRagEnabled.checked = _atlasConfig.ragEnabled === true;
    els.atlasRagTopK.value = typeof _atlasConfig.ragTopK === 'number' ? _atlasConfig.ragTopK : 5;
    setSectionStatus(els.atlasConfigStatus, '', '');
  } catch (err) {
    setSectionStatus(els.atlasConfigStatus, 'Failed to load Atlas config: ' + err.message, 'error');
  }
}

async function saveAtlasConfig() {
  setSectionStatus(els.atlasConfigStatus, 'Saving…', 'info');
  els.saveAtlasConfigBtn.disabled = true;
  try {
    const toggles = els.atlasModelRows.querySelectorAll('.sd-atlas-model-toggle');
    const enabledModels = Array.from(toggles)
      .filter(function (cb) { return cb.checked; })
      .map(function (cb) { return cb.dataset.key; });
    if (enabledModels.length === 0) {
      setSectionStatus(els.atlasConfigStatus, 'At least one model must be enabled.', 'error');
      return;
    }
    const defaultRadio = els.atlasModelRows.querySelector('input[name="atlasDefaultModel"]:checked');
    const defaultModel = defaultRadio ? defaultRadio.value : enabledModels[0];
    const payload = {
      enabledModels,
      defaultModel,
      budgetCapInr:         Number(els.atlasBudgetCapInr.value) || 0,
      modelSelectorVisible: els.atlasModelSelectorVisible.checked,
      ragEnabled:           els.atlasRagEnabled.checked,
      ragTopK:              Number(els.atlasRagTopK.value) || 5,
    };
    await authedJson('/api/admin/atlas/config', { method: 'PUT', body: JSON.stringify(payload) });
    _atlasConfig = payload;
    setSectionStatus(els.atlasConfigStatus, 'Atlas settings saved.', 'success');
  } catch (err) {
    setSectionStatus(els.atlasConfigStatus, 'Save failed: ' + err.message, 'error');
  } finally {
    els.saveAtlasConfigBtn.disabled = false;
  }
}

// ── AI Observability ─────────────────────────────────────────────────────────

let _ragEvalSource = null; // active EventSource

function _setObsElement(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el[prop] = val;
}

function _showObsSection(id, show) {
  const el = document.getElementById(id);
  if (el) el.hidden = !show;
}

function renderObservabilityMetrics(metrics) {
  _setObsElement('ragRecallValue',    'textContent', (metrics.recallAtK    * 100).toFixed(1) + ' %');
  _setObsElement('ragPrecisionValue', 'textContent', (metrics.precisionAtK * 100).toFixed(1) + ' %');
  _setObsElement('ragMrrValue',       'textContent', metrics.mrr.toFixed(3));
  _setObsElement('ragTotalValue',     'textContent', String(metrics.total));
  _setObsElement('ragRecallSub',      'textContent', 'target ≥ 80 %');
  _setObsElement('ragPrecisionSub',   'textContent', 'of all retrieved slots');
  _setObsElement('ragMrrSub',         'textContent', 'target ≥ 0.70');
  _setObsElement('ragHitsSub',        'textContent', metrics.hits + ' hits');

  const badge = document.getElementById('ragGateBadge');
  if (badge) {
    const pass = metrics.recallAtK >= 0.80 && metrics.mrr >= 0.70;
    badge.textContent = pass
      ? '✓ PASS — Recall@K ≥ 80 % and MRR ≥ 0.70. RAG is ready to enable in AI Config.'
      : '✗ NOT YET — Recall@K or MRR below threshold. Index more content or tune chunking before enabling.';
    badge.className = 'sd-observability-gate sd-observability-gate--' + (pass ? 'pass' : 'fail');
    badge.hidden = false;
  }

  _showObsSection('ragMetricsRow', true);
}

function renderObservabilityDetail(details) {
  const tbody = document.getElementById('ragDetailBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  details.forEach(function (row) {
    const tr = document.createElement('tr');
    tr.className = row.hit ? 'sd-obs-row-hit' : 'sd-obs-row-miss';
    tr.innerHTML = [
      '<td>' + row.index + '</td>',
      '<td class="sd-obs-question">' + escapeHtml(row.question) + '</td>',
      '<td class="sd-obs-article">' + escapeHtml(row.expectedArticleId) + '</td>',
      '<td>' + (row.hit ? '<span class="sd-obs-badge sd-obs-badge--hit">Hit</span>' : '<span class="sd-obs-badge sd-obs-badge--miss">Miss</span>') + '</td>',
      '<td>' + (row.rank != null ? String(row.rank) : '—') + '</td>',
    ].join('');
    tbody.appendChild(tr);
  });
  _showObsSection('ragDetailWrap', true);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function startRagEval() {
  if (_ragEvalSource) {
    _ragEvalSource.close();
    _ragEvalSource = null;
  }

  setSectionStatus(els.atlasObservabilityStatus, '', '');
  _showObsSection('ragProgressWrap', true);
  _showObsSection('ragMetricsRow', false);
  _showObsSection('ragGateBadge', false);
  _showObsSection('ragDetailWrap', false);
  _setObsElement('ragProgressBar',  'style', 'width:0%');
  _setObsElement('ragProgressLabel', 'textContent', 'Connecting to evaluation service…');
  els.runRagEvalBtn.disabled = true;

  const url = '/api/admin/atlas/rag-eval?token=' + encodeURIComponent(credential || '');
  const source = new EventSource(url);
  _ragEvalSource = source;

  source.addEventListener('progress', function (evt) {
    try {
      const data = JSON.parse(evt.data);
      const pct  = Math.round((data.index / data.total) * 100);
      _setObsElement('ragProgressBar',  'style',       'width:' + pct + '%');
      _setObsElement('ragProgressLabel', 'textContent',
        'Question ' + data.index + ' / ' + data.total + ': ' +
        (data.hit ? '✓' : '✗') + ' ' + data.question.slice(0, 80));
    } catch (_) {}
  });

  source.addEventListener('result', function (evt) {
    try {
      const data = JSON.parse(evt.data);
      renderObservabilityMetrics(data.metrics);
      if (data.details) renderObservabilityDetail(data.details);
      _setObsElement('ragProgressBar', 'style', 'width:100%');
      _setObsElement('ragProgressLabel', 'textContent', 'Evaluation complete.');
    } catch (_) {}
  });

  source.addEventListener('error', function (evt) {
    let msg = 'Evaluation failed.';
    try { msg = JSON.parse(evt.data).message || msg; } catch (_) {}
    setSectionStatus(els.atlasObservabilityStatus, msg, 'error');
    _setObsElement('ragProgressLabel', 'textContent', 'Error — see status above.');
  });

  source.onopen = function () {
    _setObsElement('ragProgressLabel', 'textContent', 'Starting evaluation…');
  };

  source.onerror = function () {
    if (source.readyState === EventSource.CLOSED) {
      source.close();
      _ragEvalSource = null;
      els.runRagEvalBtn.disabled = false;
    }
  };

  // Fallback: close source when stream ends naturally.
  source.addEventListener('done', function () {
    source.close();
    _ragEvalSource = null;
    els.runRagEvalBtn.disabled = false;
    _showObsSection('ragProgressWrap', false);
  });
}

// Exposed globally so atlas sub-panel nav items can call it.
window._setAtlasSubModule = function (moduleName) {
  setActiveModule(moduleName);
};

function renderPreview() {
  const article = articleFromForm();
  updateWorkflowChrome(article.status);
}

function renderPublishReview() {
  const article = articleFromForm();
  els.publishReviewTitle.textContent = article.en.title || 'Untitled article';
  els.publishReviewSubtitle.textContent = article.en.subtitle || '';
  els.publishReviewSubtitle.hidden = !article.en.subtitle;
  els.publishReviewTags.textContent = '';
  article.tags.forEach(function (tag) {
    const chip = document.createElement('span');
    chip.className = 'sd-tag';
    chip.textContent = tag;
    els.publishReviewTags.appendChild(chip);
  });
  els.publishReviewReadTime.lastElementChild.textContent = article.readMinutes + ' min';
  els.publishSeoSlug.value = article.id || '';
  if (els.publishSeoContentType) els.publishSeoContentType.value = article.contentType || 'system-design';
  els.publishSeoIcon.value = article.icon || 'article';
  els.publishSeoReadMinutes.value = String(article.readMinutes || 5);
  els.publishSeoOrder.value = String(article.order || 100);
  renderPublishOrderWarning();
  els.publishReviewBody.innerHTML = article.en.body || '<p class="sd-preview-empty">Nothing to preview yet. Add content to a section and it will appear here.</p>';
}

function publishSeoExcludedIds() {
  const ids = currentArticleIds();
  const modalId = slugify(els.publishSeoSlug.value || els.title.value);
  if (modalId && !ids.includes(modalId)) ids.push(modalId);
  return ids;
}

function renderPublishOrderWarning() {
  const order = Number(els.publishSeoOrder.value || 0);
  const conflict = findOrderConflict(order, publishSeoExcludedIds());
  if (!conflict) {
    els.publishOrderWarning.hidden = true;
    els.publishOrderWarningText.textContent = '';
    return null;
  }
  const nextOrder = nextAvailableOrder(publishSeoExcludedIds());
  els.publishOrderWarning.hidden = false;
  els.publishOrderWarningText.textContent = 'Order ' + order + ' is already used by "' + articleDisplayName(conflict) + '". Use order ' + nextOrder + ' to keep the library sequence clean.';
  return conflict;
}

function syncPublishSeoToForm() {
  els.id.value = slugify(els.publishSeoSlug.value || els.title.value);
  els.publishSeoSlug.value = els.id.value;
  if (els.contentType && els.publishSeoContentType) {
    els.contentType.value = els.publishSeoContentType.value || els.contentType.value || 'system-design';
  }
  els.icon.value = els.publishSeoIcon.value.trim() || 'article';
  els.readMinutes.value = els.publishSeoReadMinutes.value || '';
  els.order.value = els.publishSeoOrder.value || '100';
  renderArticleDetails();
  renderPreview();
  markDirty();
}

function setPublishReviewStep(step) {
  const isSeoStep = step === 'seo';
  els.publishDialog.dataset.publishStep = isSeoStep ? 'seo' : 'preview';
  els.publishPreviewPanel.hidden = isSeoStep;
  els.publishSeoPanel.hidden = !isSeoStep;
  els.publishReviewHeading.textContent = '';
  if (els.publishReviewDescription) {
    els.publishReviewDescription.textContent = isSeoStep
      ? 'Confirm SEO and ordering before this article goes live.'
      : '';
  }
  els.continueEditingBtn.textContent = isSeoStep ? 'Back to preview' : 'Continue editing';
  if (els.publishActionLabel) els.publishActionLabel.textContent = isSeoStep ? 'Publish now' : 'Publish';
}

async function loadArticles() {
  setStatus('Loading articles...', 'info');
  const [data] = await Promise.all([
    authedJson('/api/admin/system-design/articles'),
    authedJson('/api/system-design/component-registry').then(function (r) {
      _metaEnabledMap = r.enabled || {};
    }).catch(function () {}),
  ]);
  articles = Array.isArray(data.articles) ? data.articles : [];
  els.modules.hidden = false;
  els.workspace.hidden = false;
  els.signOut.hidden = false;
  if (els.authWall) els.authWall.hidden = true;
  setStatus('', 'info');
  renderList();
  await loadContactPolicy();
  setActiveModule('system-design');
  // Apply saved view preference to toggle buttons before rendering the list.
  window._setArticleView(currentArticleView);
  // Set default view last so nothing overrides it.
  // With articles: show the list. Without: start new-article state.
  if (articles.length > 0) {
    window._setArticleFilter('all');
  } else {
    fillForm(null);
  }
}

async function saveArticleWithStatus(status, opts) {
  const options = opts || {};
  const beforeId = selectedId || slugify(els.id.value || els.title.value);
  const prevRefs = beforeId ? (mediaRefsByArticleId.get(beforeId) || new Set()) : new Set();
  const article = articleFromForm();
  article.status = status;
  article.stub = status === 'Coming soon';
  if (!article.id || !article.en.title || !article.en.body) {
    if (options.silent) return;
    setSectionStatus(els.systemStatus, 'Slug, title, and body are required.', 'error');
    return;
  }
  const action = status === 'Published' ? 'Publishing...' : 'Saving ' + status.toLowerCase() + '...';
  if (!options.silent) setSectionStatus(els.systemStatus, action, 'info');
  const routeId = selectedId || article.id;
  const data = await authedJson('/api/admin/system-design/articles/' + routeId, {
    method: 'PUT',
    body:   JSON.stringify(article),
  });
  const saved = data.article;

  // Auto-cleanup: if the save removed any media objects (e.g. Replace image),
  // try deleting them now. Safe: backend checks "still orphan?" at delete time.
  const nextRefs = computeMediaRefsFromArticle(saved);
  const removed = diffRemovedMedia(prevRefs, nextRefs);
  autoCleanupRemovedMedia(saved.id, removed);
  mediaRefsByArticleId.set(saved.id, nextRefs);

  articles = articles.filter(function (item) { return item.id !== saved.id; }).concat(saved)
    .sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  if (options.silent) {
    selectedId = saved.id;
    renderList();
  } else {
    fillForm(saved);
    showDetailsForm(false);
  }
  const done = status === 'Published'
    ? 'Published version ' + data.version + '.'
    : status + ' saved to Firestore.';
  updateWorkflowChrome(saved.status, options.silent ? 'Auto-saved to Firestore' : (status === 'Published' ? 'Published just now' : 'Saved just now'), 'saved');
  setFooterSaveStatus(status === 'Published' ? 'Published just now ✓' : 'Saved just now ✓', 'saved');
  if (!options.silent) setSectionStatus(els.systemStatus, done, 'success');
}

function publishArticle() {
  clearDraftAutosave();
  els.statusField.value = 'Published';
  renderPreview();
  return saveArticleWithStatus('Published');
}

function openPublishReview() {
  renderPreview();
  renderPublishReview();
  setPublishReviewStep('preview');
  if (typeof els.publishDialog.show === 'function') {
    els.publishDialog.show();
    return;
  }
  customElements.whenDefined('md-dialog').then(function () {
    els.publishDialog.show();
  });
}

function closePublishReview() {
  els.publishDialog.close();
  // Reset for next open
  if (els.publishSuccessPanel) els.publishSuccessPanel.hidden = true;
  if (els.confirmPublishBtn) {
    els.confirmPublishBtn.disabled = false;
    els.confirmPublishBtn.hidden = false;
  }
  if (els.continueEditingBtn) els.continueEditingBtn.hidden = false;
}

function showPublishSuccess(title) {
  // Hide all other panels
  els.publishPreviewPanel.hidden = true;
  els.publishSeoPanel.hidden = true;
  els.publishSuccessPanel.hidden = false;
  els.publishSuccessPanel.classList.remove('sd-publish-success-in');
  // Trigger animation
  requestAnimationFrame(function () {
    els.publishSuccessPanel.classList.add('sd-publish-success-in');
  });
  els.publishSuccessTitle.textContent = '\u201c' + title + '\u201d is live';
  // Hide action buttons — nothing more to do
  els.continueEditingBtn.hidden = true;
  els.confirmPublishBtn.hidden = true;
  els.publishReviewHeading.textContent = '';
  // Auto-close after 2.4 s
  setTimeout(closePublishReview, 2400);
}

function handlePublishDialogBack() {
  if (els.publishDialog.dataset.publishStep === 'seo') {
    syncPublishSeoToForm();
    renderPublishReview();
    setPublishReviewStep('preview');
    return;
  }
  closePublishReview();
}


function initGoogle() {
  if (!GOOGLE_CLIENT_ID) {
    setStatus('Google Sign-In is not configured.', 'error');
    return;
  }
  if (!globalThis.google?.accounts) {
    setTimeout(initGoogle, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: function (resp) {
      hideWelcomeOverlay();
      startAdminSession(resp.credential || '').catch(function (err) {
        handleAdminLoadError(err);
      });
    },
    ux_mode: 'popup',
    use_fedcm_for_prompt: true,
    use_fedcm_for_button: true,
  });
  if (els.welcomeGoogle && els.welcomeGoogle.childElementCount === 0) {
    google.accounts.id.renderButton(els.welcomeGoogle, {
      theme: 'filled_black',
      size:  'large',
      text:  'continue_with',
      shape: 'rectangular',
      width: 280,
    });
  }
  if (credential) {
    startAdminSession(credential).catch(function (err) {
      handleAdminLoadError(err);
    });
  } else {
    updateAdminChrome(null);
  }
}

els.topbarSignIn.addEventListener('click', function () {
  showWelcomeOverlay({
    onShown: function () {
      if (globalThis.google?.accounts) initGoogle();
    },
  });
  setStatus('', 'info');
});

// Make the auth-wall CTA behave identically to the topbar Sign in.
// (Users land here via direct URL / refresh, where the topbar button can be missed.)
try {
  if (els.signInWallSlot && els.signInWallSlot.childElementCount === 0) {
    const wrap = document.createElement('div');
    wrap.className = 'sd-admin-authwall-actions';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-admin-authwall-signin';
    btn.textContent = 'Sign in';
    btn.addEventListener('click', function () {
      try { els.topbarSignIn.click(); } catch (_) {}
    });
    wrap.appendChild(btn);

    // Localhost-only: allow admin UX work without Google auth setup.
    try {
      const h = String(location && location.hostname || '');
      const isLocal = h === 'localhost' || h === '127.0.0.1';
      if (isLocal) {
        const localBtn = document.createElement('button');
        localBtn.type = 'button';
        localBtn.className = 'sd-admin-authwall-local';
        localBtn.textContent = 'Continue locally';
        localBtn.addEventListener('click', function () {
          startAdminSession('local-admin-preview').catch(function (err) {
            handleAdminLoadError(err);
          });
        });
        wrap.appendChild(localBtn);
      }
    } catch (_) {}

    els.signInWallSlot.appendChild(wrap);
  }
} catch (_) {}

els.avatarBtn.addEventListener('click', function () {
  els.dropdown.toggleAttribute('hidden');
});

els.welcomeClose.addEventListener('click', hideWelcomeOverlay);
els.welcomeGuest.addEventListener('click', hideWelcomeOverlay);
els.modules.addEventListener('click', function (event) {
  const btn = event.target.closest('.sd-admin-module');
  if (!btn) return;
  setActiveModule(btn.dataset.module || 'system-design');
});
if (els.refreshMediaAuditBtn) {
  els.refreshMediaAuditBtn.addEventListener('click', function () {
    mediaAuditState = null;
    mediaAuditView.visibleCount = 0;
    refreshMediaAudit();
  });
}
if (els.mediaOrphansOnly) {
  els.mediaOrphansOnly.addEventListener('change', function () {
    mediaAuditView.visibleCount = 0;
    mediaAuditView.status = els.mediaOrphansOnly.checked ? 'orphan' : (mediaAuditView.status || 'all');
    paintMediaAudit();
  });
}
if (els.refreshAnalyticsBtn) {
  els.refreshAnalyticsBtn.addEventListener('click', function () {
    analyticsState = null;
    refreshAnalytics();
  });
}
if (els.analyticsMonth) {
  els.analyticsMonth.addEventListener('change', function () {
    analyticsState = null;
    refreshAnalytics();
  });
}
if (els.refreshSubscriptionsBtn) {
  els.refreshSubscriptionsBtn.addEventListener('click', function () {
    subscriptionsState = null;
    refreshSubscriptions();
  });
}
els.savePolicyBtn.addEventListener('click', function () {
  saveContactPolicy().catch(function (err) { setSectionStatus(els.policyTest, err.message, 'error'); });
});
els.testPolicyBtn.addEventListener('click', testContactPolicy);
els.autoFixArticleOrderBtn.addEventListener('click', autoFixArticleSettingsOrder);
els.saveArticleSettingsBtn.addEventListener('click', function () {
  saveArticleSettings().catch(function (err) { setSectionStatus(els.articleSettingsStatus, err.message, 'error'); });
});
els.saveTierSettingsBtn.addEventListener('click', function () {
  saveTierSettings().catch(function (err) { setSectionStatus(els.tierSettingsStatus, err.message, 'error'); });
});
els.saveMetadataConfigBtn.addEventListener('click', function () {
  saveMetadataConfig().catch(function (err) { setSectionStatus(els.metadataConfigStatus, err.message, 'error'); });
});
els.addSponsorBtn.addEventListener('click', function () { openSponsorDrawer(null); });
els.closeSponsorDrawerBtn.addEventListener('click', closeSponsorDrawer);
els.saveSponsorBtn.addEventListener('click', function () {
  saveSponsor().catch(function (err) { setSectionStatus(els.sponsorDrawerStatus, err.message, 'error'); });
});
els.deleteSponsorBtn.addEventListener('click', function () {
  deleteSponsor().catch(function (err) { setSectionStatus(els.sponsorDrawerStatus, err.message, 'error'); });
});
els.saveSeoConfigBtn.addEventListener('click', function () {
  saveSeoConfig().catch(function (err) { setSectionStatus(els.seoConfigStatus, err.message, 'error'); });
});
els.saveAtlasConfigBtn.addEventListener('click', function () {
  saveAtlasConfig().catch(function (err) { setSectionStatus(els.atlasConfigStatus, err.message, 'error'); });
});
if (els.runRagEvalBtn) {
  els.runRagEvalBtn.addEventListener('click', startRagEval);
}
els.seoSiteUrl.addEventListener('input', updateSerpPreview);
els.seoSiteDescription.addEventListener('input', updateSerpPreview);
document.addEventListener('click', function () {
  closeSectionActionMenus();
  closeArticleDetailsMenu();
  closePolicyRuleMenus();
  closeMediaActionMenus();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeSectionActionMenus();
    closeArticleDetailsMenu();
    closePolicyRuleMenus();
    closeMediaActionMenus();
  }
});
els.detailsActionsBtn.addEventListener('click', function (event) {
  event.stopPropagation();
  const willOpen = els.detailsActionsMenu.hidden;
  closeSectionActionMenus();
  closeArticleDetailsMenu();
  els.detailsActionsMenu.hidden = !willOpen;
  els.detailsActionsBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
});
els.detailsActionsMenu.addEventListener('click', function (event) { event.stopPropagation(); });
els.editDetailsBtn.addEventListener('click', function () {
  closeArticleDetailsMenu();
  showDetailsForm(true);
  setDetailsStatus('', '');
  els.title.focus();
});

function setDetailsStatus(msg, type) {
  const banner = els.detailsBanner;
  const el = els.detailsSaveStatus;
  const message = msg || '';

  // Always show details status in the same banner slot (like section cards),
  // so success appears where errors appear.
  if (banner) {
    banner.textContent = message;
    banner.hidden = !message;
    if (message && type) banner.dataset.kind = type;
    else delete banner.dataset.kind;
  }

  // Retire the inline status to avoid mixed placements/colors.
  if (el) {
    el.textContent = '';
    el.hidden = true;
    el.className = 'sd-details-save-status';
  }
}

// ── Thumbnail helpers ────────────────────────────────────────────────────────

function setThumbPreview(url) {
  if (url) {
    els.thumbPreview.src = url;
    els.thumbPreview.alt = 'Article thumbnail';
    els.thumbPreviewWrap.hidden = false;
    els.thumbDropzone.hidden = true;
  } else {
    els.thumbPreviewWrap.hidden = true;
    els.thumbDropzone.hidden = false;
  }
}

function setThumbStatus(msg, type) {
  els.thumbStatus.textContent = msg;
  els.thumbStatus.className = 'sd-thumb-status sd-thumb-status--' + (type || 'info');
  els.thumbStatus.hidden = !msg;
}

async function uploadThumbnail(file) {
  if (!file || !file.type.startsWith('image/')) {
    setThumbStatus('Only image files are allowed.', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    setThumbStatus('File too large. Maximum is 8 MB.', 'error');
    return;
  }
  setThumbStatus('Uploading…', 'info');
  try {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/media/upload?preset=thumb', { method: 'POST', headers: authHeaders(), body: form });
    const json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(json.message || json.error || 'Upload failed');
    currentThumbnailUrl = json.url;
    setThumbPreview(currentThumbnailUrl);
    setThumbStatus('', '');
  } catch (err) {
    setThumbStatus(err.message || 'Upload failed.', 'error');
  }
}

if (els.thumbInput) {
  els.thumbInput.addEventListener('change', function () {
    if (els.thumbInput.files && els.thumbInput.files[0]) uploadThumbnail(els.thumbInput.files[0]);
  });
}
if (els.thumbDropzone) {
  els.thumbDropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    els.thumbDropzone.classList.add('sd-thumb-dropzone--active');
  });
  els.thumbDropzone.addEventListener('dragleave', function () {
    els.thumbDropzone.classList.remove('sd-thumb-dropzone--active');
  });
  els.thumbDropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    els.thumbDropzone.classList.remove('sd-thumb-dropzone--active');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) uploadThumbnail(file);
  });
  els.thumbDropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.thumbInput.click(); }
  });
}
if (els.thumbRemoveBtn) {
  els.thumbRemoveBtn.addEventListener('click', function () {
    currentThumbnailUrl = '';
    setThumbPreview('');
    setThumbStatus('', '');
    if (els.thumbInput) els.thumbInput.value = '';
  });
}

// ────────────────────────────────────────────────────────────────────────────

els.saveDetailsBtn.addEventListener('click', async function () {
  const title = (els.title.value || '').trim();
  if (!title) {
    setDetailsStatus('Add a title before saving.', 'error');
    els.title.focus();
    return;
  }
  els.saveDetailsBtn.disabled = true;
  setDetailsStatus('Saving…', 'info');
  try {
    const article = articleFromForm();
    article.status = article.status || 'Draft';
    article.stub = false;
    // Ensure body is always a string so the server validator doesn't reject it.
    if (article.en) article.en.body = article.en.body || '';
    const routeId = selectedId || article.id;
    const data = await authedJson('/api/admin/system-design/articles/' + routeId, {
      method: 'PUT',
      body: JSON.stringify(article),
    });
    const saved = data.article;
    selectedId = saved.id;
    articles = articles.filter(function (a) { return a.id !== saved.id; }).concat(saved)
      .sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
    renderList();
    renderArticleDetails();
    setDetailsStatus((saved.status || 'Draft') + ' saved to Firestore.', 'success');
    setTimeout(function () {
      showDetailsForm(false);   // collapse form, restore card preview
      setDetailsStatus('', '');
    }, 1200);
  } catch (err) {
    setDetailsStatus(err.message || 'Save failed.', 'error');
  } finally {
    els.saveDetailsBtn.disabled = false;
  }
});
document.querySelectorAll('.sd-policy-rule-card').forEach(function (card) {
  const trigger = card.querySelector('.sd-policy-rule-action-btn');
  const menu = card.querySelector('.sd-policy-rule-menu');
  const edit = card.querySelector('.sd-policy-edit-btn');
  const form = card.querySelector('.sd-policy-rule-edit');
  const done = card.querySelector('.sd-policy-done-btn');
  if (!trigger || !menu || !edit || !form || !done) return;
  trigger.addEventListener('click', function (event) {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeSectionActionMenus();
    closeArticleDetailsMenu();
    closePolicyRuleMenus();
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  menu.addEventListener('click', function (event) { event.stopPropagation(); });
  edit.addEventListener('click', function () {
    closePolicyRuleMenus();
    form.hidden = false;
    const field = form.querySelector('textarea');
    if (field) field.focus();
  });
  done.addEventListener('click', function () {
    form.hidden = true;
    renderPolicyRuleCards();
  });
});
if (els.toggleLibraryBtn) {
  els.toggleLibraryBtn.addEventListener('click', function () {
    setArticleLibraryCollapsed(!els.workspace.classList.contains('sd-admin-workspace-library-collapsed'));
  });
}
// Rail is permanently narrow — no expand/collapse on desktop

if (els.mobileSidebarBtn) {
  els.mobileSidebarBtn.addEventListener('click', function () {
    if (els.adminNav && els.adminNav.classList.contains('sd-admin-nav--open')) {
      closeMobileNav();
    } else {
      openMobileNav();
    }
  });
}

// Close button inside the drawer
const mobileNavCloseBtn = document.getElementById('mobileNavCloseBtn');
if (mobileNavCloseBtn) {
  mobileNavCloseBtn.addEventListener('click', closeMobileNav);
}

if (els.sidebarScrim) {
  els.sidebarScrim.addEventListener('click', closeMobileNav);
}

// Close mobile drawer when a module is selected on mobile
els.modules.addEventListener('click', function () {
  if (isMobileNavMode()) closeMobileNav();
}, true);
if (els.togglePolicyInfoBtn) {
  els.togglePolicyInfoBtn.addEventListener('click', function () {
    setContactPolicyInfoCollapsed(!els.policyWorkspace.classList.contains('sd-admin-policy-info-collapsed'));
  });
}
els.addSectionBtn.addEventListener('click', function (event) {
  event.stopPropagation();
  addSection('');
});
els.title.addEventListener('input', function () {
  if (!selectedId) els.id.value = slugify(els.title.value);
  renderArticleDetails();
  renderPreview();
  markDirty();
});
[
  els.id, els.statusField, els.contentType, els.icon, els.readMinutes, els.order,
  els.subtitle, els.tags,
].forEach(function (el) {
  el.addEventListener('input', function () {
    renderArticleDetails();
    renderPreview();
    markDirty();
  });
  el.addEventListener('change', function () {
    renderArticleDetails();
    renderPreview();
    markDirty();
  });
});
if (els.previewBtn) els.previewBtn.addEventListener('click', function () {
  openPublishReview();
});
els.publishBtn.addEventListener('click', function () {
  openPublishReview();
});
els.closePublishReviewBtn.addEventListener('click', closePublishReview);
els.continueEditingBtn.addEventListener('click', handlePublishDialogBack);
[
  els.publishSeoSlug,
  els.publishSeoContentType,
  els.publishSeoIcon,
  els.publishSeoReadMinutes,
  els.publishSeoOrder,
].forEach(function (el) {
  el.addEventListener('input', renderPublishOrderWarning);
  el.addEventListener('change', renderPublishOrderWarning);
});
els.useNextOrderBtn.addEventListener('click', function () {
  els.publishSeoOrder.value = String(nextAvailableOrder(publishSeoExcludedIds()));
  renderPublishOrderWarning();
  els.publishSeoOrder.focus();
});
els.confirmPublishBtn.addEventListener('click', function () {
  if (els.publishDialog.dataset.publishStep !== 'seo') {
    renderPublishReview();
    setPublishReviewStep('seo');
    return;
  }
  if (renderPublishOrderWarning()) {
    els.publishSeoOrder.focus();
    return;
  }
  syncPublishSeoToForm();
  els.confirmPublishBtn.disabled = true;
  publishArticle()
    .then(function () {
      const title = els.publishReviewTitle.textContent || 'Your article';
      showPublishSuccess(title);
    })
    .catch(function (err) {
      els.confirmPublishBtn.disabled = false;
      setSectionStatus(els.systemStatus, err.message, 'error');
    });
});
// Sub-panel filter buttons: All Articles / Drafts / Published / Archived.
// Exposed globally so inline onclick attributes in HTML can call through to
// module-scoped state without crossing the module isolation boundary.
window._setArticleFilter = function (filter) {
  currentArticleFilter = filter || 'all';
  selectedId = '';
  if (els.listMain) els.listMain.hidden = false;
  // Hide all editing UI — list and editor are mutually exclusive
  if (els.detailsCard) els.detailsCard.hidden = true;
  if (els.editorHead) els.editorHead.hidden = true;
  els.detailsForm.hidden = true;
  if (els.detailsHead) els.detailsHead.hidden = true;
  if (els.sectionBuilder) els.sectionBuilder.hidden = true;
  // Sync inline filter tabs active state
  document.querySelectorAll('.sd-list-filter-tab').forEach(function (btn) {
    const active = btn.dataset.filter === currentArticleFilter;
    btn.classList.toggle('sd-list-filter-tab-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  renderList();
};

// Article view toggle: grid | list
window._setArticleView = function (view) {
  currentArticleView = view === 'list' ? 'list' : 'grid';
  localStorage.setItem('sd-article-view', currentArticleView);
  // Update toggle button states
  const gridBtn = document.getElementById('viewToggleGrid');
  const listBtn = document.getElementById('viewToggleList');
  if (gridBtn) {
    gridBtn.classList.toggle('sd-view-toggle-active', currentArticleView === 'grid');
    gridBtn.setAttribute('aria-pressed', String(currentArticleView === 'grid'));
  }
  if (listBtn) {
    listBtn.classList.toggle('sd-view-toggle-active', currentArticleView === 'list');
    listBtn.setAttribute('aria-pressed', String(currentArticleView === 'list'));
  }
  renderList();
};

window._newArticle = function () {
  selectedId = '';
  currentArticleFilter = 'all';
  fillForm(null);            // hides list, shows card preview, hides form
  setDetailsStatus('', '');
  renderList();
};
if (els.newBtn) {
  els.newBtn.addEventListener('click', window._newArticle);
}
els.signOut.addEventListener('click', function () {
  signOutAdmin();
});

initTheme();
onCrossTabSignOut(function () {
  signOutAdmin({ broadcast: false });
});
globalThis.toggleChatTeaser = toggleChatTeaser;
globalThis.openAssistant = openAssistant;
globalThis.closeAssistant = closeAssistant;
globalThis.minimiseAssistant = minimiseAssistant;
globalThis.restartAssistant = restartAssistant;
renderAtlasShell('#sharedAtlasShell', {
  toggleChatTeaser,
  openAssistant,
  closeAssistant,
  minimiseAssistant,
  restartAssistant,
});
initChat();
startLocalAdminPreview()
  .then(function (enabled) {
    if (!enabled) initGoogle();
  })
  .catch(function () {
    initGoogle();
  });
