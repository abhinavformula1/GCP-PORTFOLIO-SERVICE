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
import { renderTopbar }     from '../../assets/ui/topbar.js';
import { renderTechFooter } from '../../assets/ui/footer.js';
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
import '../../assets/ui/loader.js';

const ADMIN_HANDOFF_KEY = 'portfolio_admin_handoff';

let credential = readAdminHandoffCredential() || googleCredential || '';
let articles = [];
let selectedId = '';
let currentThumbnailUrl = '';
let contactPolicyState = null;
let adminAvatarObjectUrl = '';
let autosaveTimer = 0;
let articleSections = [];
let sectionSeq = 0;

// Public filtering uses contentType (content type pills) + tags (domains). Categories are
// intentionally removed to avoid a third, redundant taxonomy.

function contentTypeLabel(value) {
  const v = String(value || '').trim();
  if (v === 'architecture') return 'Architecture Notes';
  if (v === 'case-study') return 'Case Studies';
  return 'System Design';
}

renderTopbar('#sharedTopbar', {
  className: 'topbar sd-admin-topbar',
  controlsClassName: 'sd-admin-auth',
  backHref: '/',
  backText: 'Back to portfolio',
  signInId: 'adminTopbarSignInBtn',
  userId: 'adminTopbarUser',
  avatarBtnId: 'adminAvatarBtn',
  userPhotoId: 'adminUserPhoto',
  dropdownId: 'adminTopbarDropdown',
  userNameId: 'adminUserName',
  signOutId: 'adminSignOut',
  photoAlt: 'Signed-in admin profile photo',
});
renderTechFooter('#sharedFooter', {
  className: 'sponsors-footer sd-admin-footer',
  i18n: false,
});

const els = {
  topbarSignIn:    document.getElementById('adminTopbarSignInBtn'),
  topbarUser:      document.getElementById('adminTopbarUser'),
  avatarBtn:       document.getElementById('adminAvatarBtn'),
  userPhoto:       document.getElementById('adminUserPhoto'),
  userName:        document.getElementById('adminUserName'),
  dropdown:        document.getElementById('adminTopbarDropdown'),
  signOut:         document.getElementById('adminSignOut'),
  welcomeGoogle:   document.getElementById('welcomeGoogleBtn'),
  welcomeClose:    document.getElementById('welcomeCloseBtn'),
  welcomeGuest:    document.getElementById('welcomeGuestBtn'),
  workspace:       document.getElementById('adminWorkspace'),
  authWall:        document.getElementById('adminAuthWall'),
  modules:         document.getElementById('adminModules'),
  policyWorkspace: document.getElementById('contactPolicyWorkspace'),
  articleSettingsWorkspace: document.getElementById('articleSettingsWorkspace'),
  articleSettingsList: document.getElementById('articleSettingsList'),
  articleSettingsStatus: document.getElementById('articleSettingsStatus'),
  autoFixArticleOrderBtn: document.getElementById('autoFixArticleOrderBtn'),
  saveArticleSettingsBtn: document.getElementById('saveArticleSettingsBtn'),
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
  seoSiteUrl: document.getElementById('seoSiteUrl'),
  seoSiteDescription: document.getElementById('seoSiteDescription'),
  seoOgImageUrl: document.getElementById('seoOgImageUrl'),
  seoJsonLd: document.getElementById('seoJsonLd'),
  seoSitemap: document.getElementById('seoSitemap'),
  seoHreflangFr: document.getElementById('seoHreflangFr'),
  seoRobotsNoindex: document.getElementById('seoRobotsNoindex'),
  seoDescCharCount: document.getElementById('seoDescCharCount'),
  seoAdsensePublisherId: document.getElementById('seoAdsensePublisherId'),
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
  toggleLibraryBtn: document.getElementById('toggleArticleLibraryBtn'),
  totalCount:      document.getElementById('articleTotalCount'),
  publishedCount:  document.getElementById('articlePublishedCount'),
  draftCount:      document.getElementById('articleDraftCount'),
  seedBtn:         document.getElementById('seedArticlesBtn'),
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
  detailsActionsBtn: document.getElementById('articleDetailsActionsBtn'),
  detailsActionsMenu: document.getElementById('articleDetailsActionsMenu'),
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
  els.tierSettingsWorkspace.hidden = true;
  els.metadataConfigWorkspace.hidden = true;
  els.sponsorshipsWorkspace.hidden = true;
  if (err?.status === 401 || err?.status === 403) {
    resetAdminSession();
    setStatus(null);
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
  const isTier     = moduleName === 'tier-settings';
  const isMeta     = moduleName === 'metadata-config';
  const isSponsor  = moduleName === 'sponsorships';
  const isSeo      = moduleName === 'seo-config';
  const isAtlas    = moduleName === 'atlas-settings';
  els.workspace.hidden = isPolicy || isSettings || isTier || isMeta || isSponsor || isSeo || isAtlas;
  els.policyWorkspace.hidden = !isPolicy;
  els.articleSettingsWorkspace.hidden = !isSettings;
  els.tierSettingsWorkspace.hidden = !isTier;
  els.metadataConfigWorkspace.hidden = !isMeta;
  els.sponsorshipsWorkspace.hidden = !isSponsor;
  els.seoConfigWorkspace.hidden = !isSeo;
  els.atlasSettingsWorkspace.hidden = !isAtlas;
  if (isSettings) renderArticleSettings();
  if (isTier)     renderTierSettings();
  if (isMeta)     renderMetadataConfig();
  if (isSponsor)  renderSponsorships();
  if (isSeo)      renderSeoConfig();
  if (isAtlas)    renderAtlasConfig();
  els.modules.querySelectorAll('.sd-admin-module').forEach(function (btn) {
    btn.classList.toggle('sd-admin-module-active', btn.dataset.module === moduleName);
  });
}

function setArticleLibraryCollapsed(collapsed) {
  els.workspace.classList.toggle('sd-admin-workspace-library-collapsed', collapsed);
  els.toggleLibraryBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  els.toggleLibraryBtn.setAttribute('aria-label', collapsed ? 'Expand article library' : 'Collapse article library');
  els.toggleLibraryBtn.title = collapsed ? 'Expand article library' : 'Collapse article library';
  const icon = els.toggleLibraryBtn.querySelector('.material-symbols-outlined');
  const label = els.toggleLibraryBtn.querySelector('.sd-admin-collapse-label');
  if (icon) icon.textContent = collapsed ? 'left_panel_open' : 'left_panel_close';
  if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
}

function setContactPolicyInfoCollapsed(collapsed) {
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

const SECTION_TYPES = ['Overview', 'Problem Statement', 'Solution'];

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
    if (type) blocks.push({ type: 'heading', text: type });
    body.forEach(function (block) { blocks.push(block); });
  });
  return blocks;
}

// Flat blocks → sections: a heading starts a new section; its text is the type.
function blocksToSections(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const sections = [];
  let current = null;
  list.forEach(function (block) {
    if (block && block.type === 'heading') {
      current = { id: nextSectionId(), type: String(block.text || 'Overview'), blocks: [], composer: null };
      sections.push(current);
      return;
    }
    if (!current) {
      current = { id: nextSectionId(), type: 'Overview', blocks: [], composer: null };
      sections.push(current);
    }
    current.blocks.push(block);
  });
  if (!sections.length) sections.push({ id: nextSectionId(), type: 'Overview', blocks: [], composer: null });
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
  const status = els.statusField.value === 'Published' ? 'Published' : 'Draft';
  await saveArticleWithStatus(status, { silent: true });
  return status === 'Published' ? 'Published to Firestore.' : 'Draft saved to Firestore.';
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

function buildSectionTypeSelect(section) {
  const isPreset = SECTION_TYPES.includes(section.type);
  const wrap = document.createElement('span');
  wrap.className = 'sd-section-type-wrap';

  // --- Select (shown when a preset is active) ---
  const select = document.createElement('select');
  select.className = 'sd-section-type-select';
  SECTION_TYPES.forEach(function (type) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = type;
    select.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom…';
  select.appendChild(customOpt);
  select.value = isPreset ? section.type : '__custom__';
  select.hidden = !isPreset;

  // --- Custom input (shown INSTEAD of select when custom is active) ---
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'sd-section-type-custom-input';
  customInput.placeholder = 'Section name…';
  customInput.spellcheck = false;
  customInput.autocomplete = 'off';
  customInput.value = isPreset ? '' : (section.type || '');
  customInput.hidden = isPreset;

  function showSelect() {
    customInput.hidden = true;
    select.hidden = false;
    select.focus();
  }

  function showCustom() {
    select.hidden = true;
    customInput.hidden = false;
    customInput.focus();
    customInput.select();
  }

  function commitCustom() {
    const val = customInput.value.trim();
    if (!val) {
      // Nothing typed — revert to select
      showSelect();
      select.value = '__custom__';
      return;
    }
    section.type = val;
    renderPreview();
    markDirty();
  }

  select.addEventListener('change', function () {
    if (select.value === '__custom__') {
      customInput.value = '';
      showCustom();
    } else {
      section.type = select.value;
      renderPreview();
      markDirty();
    }
  });

  customInput.addEventListener('blur', commitCustom);
  customInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); commitCustom(); customInput.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); showSelect(); }
  });

  wrap.append(select, customInput);
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

  const select = buildSectionTypeSelect(section);

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

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'sd-section-ribbon-btn sd-section-ribbon-remove';
  remove.title = 'Delete section';
  remove.setAttribute('aria-label', 'Delete section');
  remove.appendChild(makeIcon('delete'));
  remove.addEventListener('click', function () { deleteSection(section); });

  controls.append(up, down, remove);
  ribbon.append(number, select, controls);

  const composer = createComposer({
    tools: ['format', 'structure', 'insert', 'ai'],
    toolbarMode: 'inline',
    editToggle: true,
    startEditing: section.startEditing === true,
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

  // Published articles should open in a clearly read-only mode. Editing must be
  // explicit via the "Edit" toggle.
  if (els.statusField && els.statusField.value === 'Published') {
    composer.setEditable(false);
  }

  card.append(ribbon, composer.element);

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
}

function addSection(type) {
  syncSectionBlocks();
  const section = { id: nextSectionId(), type: type || 'Problem Statement', blocks: [], composer: null, startEditing: true };
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
}

function closeSectionActionMenus() {
  document.querySelectorAll('.sd-section-actions-menu').forEach(function (menu) {
    menu.hidden = true;
  });
  document.querySelectorAll('.sd-section-actions-trigger[aria-expanded="true"]').forEach(function (trigger) {
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
  if (!canAutosaveArticle(article)) return;
  autosaveTimer = setTimeout(function () {
    autosaveTimer = 0;
    saveArticleWithStatus(article.status || 'Draft', { silent: true }).catch(function () {
      setSectionStatus(els.systemStatus, 'Autosave failed.', 'error');
    });
  }, 1200);
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
  els.detailsForm.hidden = true;
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
}

function updateArticleStats() {
  const published = articles.filter(function (article) { return article.status === 'Published'; }).length;
  const drafts = articles.filter(function (article) { return article.status === 'Draft'; }).length;
  els.totalCount.textContent = String(articles.length);
  els.publishedCount.textContent = String(published);
  els.draftCount.textContent = String(drafts);
}

function renderList() {
  els.list.textContent = '';
  updateArticleStats();
  if (!articles.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    const title = document.createElement('strong');
    title.textContent = 'No articles yet.';
    const hint = document.createElement('span');
    hint.textContent = 'Start with a new draft or import the seed articles.';
    empty.append(title, hint);
    els.list.appendChild(empty);
    return;
  }
  articles.forEach(function (article) {
    const en = article.en || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-admin-article';
    if (article.id === selectedId) btn.classList.add('sd-admin-article-active');
    btn.dataset.id = article.id;
    const top = document.createElement('span');
    top.className = 'sd-admin-article-top';
    const status = document.createElement('span');
    status.className = 'sd-admin-chip';
    status.dataset.status = article.status || 'Draft';
    status.textContent = article.status || 'Draft';
    const typeChip = document.createElement('span');
    typeChip.className = 'sd-admin-chip sd-admin-chip-muted';
    typeChip.textContent = contentTypeLabel(article.contentType || 'system-design');
    top.append(status, typeChip);
    const title = document.createElement('strong');
    title.textContent = en.title || article.id;
    const subtitle = document.createElement('small');
    subtitle.textContent = en.subtitle || article.id;
    const meta = document.createElement('span');
    meta.className = 'sd-admin-article-meta';
    meta.textContent = (article.readMinutes ? article.readMinutes + ' min read · ' : '') + 'Order ' + (article.order || 100);
    btn.append(top, title, subtitle, meta);
    btn.addEventListener('click', function () {
      const article = articles.find(function (item) { return item.id === btn.dataset.id; });
      fillForm(article);
    });
    els.list.appendChild(btn);
  });
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
    ['Draft', 'Published', 'Retired'].forEach(function (s) {
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
  panel.innerHTML = '';

  // Group components by their group label
  const groups = {};
  COMPONENT_REGISTRY.forEach(function (comp) {
    if (!groups[comp.group]) groups[comp.group] = [];
    groups[comp.group].push(comp);
  });

  Object.entries(groups).forEach(function ([groupName, components]) {
    const section = document.createElement('div');
    section.className = 'sd-meta-config-group';

    const heading = document.createElement('h3');
    heading.className = 'sd-meta-config-group-title';
    heading.textContent = groupName;
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'sd-meta-config-grid';

    components.forEach(function (comp) {
      const isEnabled = _metaEnabledMap[comp.id] !== false; // default ON
      const card = document.createElement('label');
      card.className = 'sd-meta-config-card' + (isEnabled ? ' sd-meta-config-card--on' : '');
      card.htmlFor = 'meta-toggle-' + comp.id;

      card.innerHTML =
        '<div class="sd-meta-config-card-left">' +
          '<div class="sd-meta-config-icon"><span class="material-symbols-outlined" aria-hidden="true">' + comp.icon + '</span></div>' +
          '<div class="sd-meta-config-info"><strong>' + comp.label + '</strong><span>' + comp.hint + '</span></div>' +
        '</div>' +
        '<div class="sd-meta-config-toggle">' +
          '<input type="checkbox" id="meta-toggle-' + comp.id + '" data-comp-id="' + comp.id + '"' + (isEnabled ? ' checked' : '') + '>' +
          '<span class="sd-meta-toggle-track"><span class="sd-meta-toggle-thumb"></span></span>' +
        '</div>';

      card.querySelector('input').addEventListener('change', function (e) {
        card.classList.toggle('sd-meta-config-card--on', e.target.checked);
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    panel.appendChild(section);
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
      siteUrl:            els.seoSiteUrl.value.trim(),
      siteDescription:    els.seoSiteDescription.value.trim(),
      ogImageUrl:         els.seoOgImageUrl.value.trim(),
      adsensePublisherId: els.seoAdsensePublisherId.value.trim(),
      jsonLdEnabled:      els.seoJsonLd.checked,
      sitemapEnabled:     els.seoSitemap.checked,
      hreflangFrEnabled:  els.seoHreflangFr.checked,
      robotsNoindex:      els.seoRobotsNoindex.checked,
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
  fillForm(articles[0] || null);
  await loadContactPolicy();
  setActiveModule('system-design');
}

async function saveArticleWithStatus(status, opts) {
  const options = opts || {};
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
  articles = articles.filter(function (item) { return item.id !== saved.id; }).concat(saved)
    .sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  if (options.silent) {
    selectedId = saved.id;
    renderList();
  } else {
    fillForm(saved);
    els.detailsForm.hidden = true;
  }
  const done = status === 'Published'
    ? 'Published version ' + data.version + '.'
    : status + ' saved to Firestore.';
  updateWorkflowChrome(saved.status, options.silent ? 'Auto-saved to Firestore' : (status === 'Published' ? 'Published just now' : 'Saved just now'), 'saved');
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

async function seedArticles() {
  setSectionStatus(els.systemStatus, 'Importing seed articles...', 'info');
  const data = await authedJson('/api/admin/system-design/seed', { method: 'POST' });
  setSectionStatus(els.systemStatus, 'Imported ' + data.imported + ' seed articles.', 'success');
  await loadArticles();
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
els.seoSiteUrl.addEventListener('input', updateSerpPreview);
els.seoSiteDescription.addEventListener('input', updateSerpPreview);
document.addEventListener('click', function () {
  closeSectionActionMenus();
  closeArticleDetailsMenu();
  closePolicyRuleMenus();
});
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') {
    closeSectionActionMenus();
    closeArticleDetailsMenu();
    closePolicyRuleMenus();
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
  els.detailsForm.hidden = false;
  setDetailsStatus('', '');
  els.title.focus();
});

function setDetailsStatus(msg, type) {
  const el = els.detailsSaveStatus;
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  el.className = 'sd-details-save-status' + (type ? ' sd-details-save-status--' + type : '');
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
    const res = await fetch('/api/media/upload', { method: 'POST', headers: authHeaders(), body: form });
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
    setDetailsStatus('Saved.', 'success');
    setTimeout(function () {
      els.detailsForm.hidden = true;
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
els.toggleLibraryBtn.addEventListener('click', function () {
  setArticleLibraryCollapsed(!els.workspace.classList.contains('sd-admin-workspace-library-collapsed'));
});
els.togglePolicyInfoBtn.addEventListener('click', function () {
  setContactPolicyInfoCollapsed(!els.policyWorkspace.classList.contains('sd-admin-policy-info-collapsed'));
});
els.addSectionBtn.addEventListener('click', function (event) {
  event.stopPropagation();
  addSection('Problem Statement');
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
els.seedBtn.addEventListener('click', function () {
  seedArticles().catch(function (err) { setSectionStatus(els.systemStatus, err.message, 'error'); });
});
els.newBtn.addEventListener('click', function () {
  selectedId = '';
  fillForm(null);
  // Show both Article Details and Article Body together.
  els.detailsForm.hidden = false;
  els.sectionBuilder.hidden = false;
  setDetailsStatus('', '');
  els.title.scrollIntoView({ behavior: 'smooth', block: 'center' });
  els.title.focus();
});
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
