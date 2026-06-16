/* global DOMParser, URL, atob, clearTimeout, document, fetch, google, localStorage, sessionStorage, setTimeout */

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
import { renderAtlasShell, renderTechFooter, renderTopbar } from '../../assets/ui/shared-layout.js';
import {
  closeAssistant,
  initChat,
  minimiseAssistant,
  openAssistant,
  restartAssistant,
  toggleChatTeaser,
} from '../../assets/chat/chat.js';

const ADMIN_HANDOFF_KEY = 'portfolio_admin_handoff';

let credential = readAdminHandoffCredential() || googleCredential || '';
let articles = [];
let selectedId = '';
let contactPolicyState = null;
let adminAvatarObjectUrl = '';
let autosaveTimer = 0;
let articleSections = [];

const SECTION_TYPES = [
  { value: 'overview', label: 'Overview', title: 'Overview' },
  { value: 'problem', label: 'Problem statement', title: 'Problem statement' },
  { value: 'solution', label: 'Solution', title: 'Solution' },
  { value: 'tradeoffs', label: 'Trade-offs', title: 'Trade-offs' },
  { value: 'risks', label: 'Risks', title: 'Risks' },
  { value: 'conclusion', label: 'Conclusion', title: 'Conclusion' },
];

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
  modules:         document.getElementById('adminModules'),
  policyWorkspace: document.getElementById('contactPolicyWorkspace'),
  togglePolicyInfoBtn: document.getElementById('toggleContactPolicyInfoBtn'),
  policyMeta:      document.getElementById('contactPolicyMeta'),
  allowedDomains:  document.getElementById('contactAllowedDomains'),
  personalDomains: document.getElementById('contactPersonalDomains'),
  allowedEmails:   document.getElementById('contactAllowedEmails'),
  blockedDomains:  document.getElementById('contactBlockedDomains'),
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
  category:        document.getElementById('articleCategory'),
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
  doneDetailsBtn:  document.getElementById('doneArticleDetailsBtn'),
  title:           document.getElementById('articleTitle'),
  subtitle:        document.getElementById('articleSubtitle'),
  tags:            document.getElementById('articleTags'),
  body:            document.getElementById('articleBody'),
  sections:        document.getElementById('articleSections'),
  addSectionBtn:   document.getElementById('addArticleSectionBtn'),
  systemStatus:    document.getElementById('systemDesignStatus'),
  saveState:       document.getElementById('articleSaveState'),
  previewBtn:      document.getElementById('previewBtn'),
  publishBtn:      document.getElementById('publishBtn'),
  previewState:    document.getElementById('previewStateBadge'),
  previewMeta:     document.getElementById('previewMeta'),
  previewTitle:    document.getElementById('previewTitle'),
  previewSubtitle: document.getElementById('previewSubtitle'),
  previewBody:     document.getElementById('previewBody'),
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
  status.textContent = message;
  status.dataset.kind = kind || 'info';
}

function setSectionStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || '';
  if (message) el.dataset.kind = kind || 'info';
  else delete el.dataset.kind;
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

function resetAdminSession() {
  credential = '';
  setGoogleCredential(null);
  setSiteProfile(null);
  sessionStorage.removeItem(STORAGE_CREDENTIAL);
  sessionStorage.removeItem(STORAGE_PROFILE);
  els.workspace.hidden = true;
  els.modules.hidden = true;
  els.policyWorkspace.hidden = true;
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

function handleAdminLoadError(err) {
  els.workspace.hidden = true;
  els.modules.hidden = true;
  els.policyWorkspace.hidden = true;
  if (err?.status === 401) {
    resetAdminSession();
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
  renderPolicyValues(els.personalDomainsView, parseListInput(els.personalDomains), 'No personal domains configured.');
  renderPolicyValues(els.allowedEmailsView, parseListInput(els.allowedEmails), 'No email exceptions configured.');
  renderPolicyValues(els.blockedDomainsView, parseListInput(els.blockedDomains), 'No blocked company domains.');
  renderPolicyValues(els.allowedDomainsView, parseListInput(els.allowedDomains), 'No strategic domains configured.');
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
  els.policyMeta.textContent = source + ' · ' + personalDomains.length + ' personal domains blocked · ' + allowedEmails.length + ' email exceptions · Updated: ' + updated;
  setSectionStatus(els.policyTest, '', 'info');
}

function setActiveModule(moduleName) {
  const isPolicy = moduleName === 'contact-policy';
  els.workspace.hidden = isPolicy;
  els.policyWorkspace.hidden = !isPolicy;
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
  const allowedDomains = parseListInput(els.allowedDomains);
  const personalDomains = parseListInput(els.personalDomains);
  const allowedEmails = parseListInput(els.allowedEmails);
  const blockedDomains = parseListInput(els.blockedDomains);
  setSectionStatus(els.policyTest, 'Saving contact policy...', 'info');
  const data = await authedJson('/api/admin/contact-policy', {
    method: 'PUT',
    body:   JSON.stringify({ allowedDomains, personalDomains, allowedEmails, blockedDomains }),
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  return text;
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push('<p>' + inlineMarkdown(paragraph.join(' ')) + '</p>');
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    html.push('<ul>' + list.map(function (item) {
      return '<li>' + inlineMarkdown(item) + '</li>';
    }).join('') + '</ul>');
    list = [];
  }

  lines.forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = heading[1].length === 2 ? 'h3' : 'h4';
      html.push('<' + tag + '>' + inlineMarkdown(heading[2]) + '</' + tag + '>');
      return;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  return html.join('');
}

function sectionTemplate(type) {
  const meta = SECTION_TYPES.find(function (item) { return item.value === type; }) || SECTION_TYPES[0];
  return {
    id: 'section-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    type: meta.value,
    title: meta.title,
    body: '',
  };
}

function nextSectionType() {
  const used = new Set(articleSections.map(function (section) { return section.type; }));
  const next = SECTION_TYPES.find(function (type) { return !used.has(type.value); });
  return next ? next.value : 'solution';
}

function sectionsToHtml(sections) {
  return sections
    .filter(function (section) { return section.body; })
    .map(function (section) {
      const title = (SECTION_TYPES.find(function (item) { return item.value === section.type; }) || SECTION_TYPES[0]).title;
      return '<h3>' + inlineMarkdown(title) + '</h3>' + markdownToHtml(section.body);
    })
    .join('');
}

function htmlToSections(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const sections = [];
  let current = null;

  function bodyText(node) {
    if (node.matches && node.matches('ul,ol')) {
      return Array.from(node.querySelectorAll('li')).map(function (li) {
        return '- ' + li.textContent.trim();
      }).join('\n');
    }
    return node.textContent.trim();
  }

  Array.from(doc.body.children).forEach(function (node) {
    if (node.matches('h1,h2,h3,h4,h5,h6')) {
      current = sectionTemplate('overview');
      current.title = node.textContent.trim() || 'Overview';
      current.body = '';
      sections.push(current);
      return;
    }
    if (!current) {
      current = sectionTemplate('overview');
      sections.push(current);
    }
    const text = bodyText(node);
    if (text) current.body += (current.body ? '\n\n' : '') + text;
  });
  return sections.length ? sections : [sectionTemplate('overview')];
}

function articleFromForm() {
  const id = slugify(els.id.value || els.title.value);
  const bodyHtml = sectionsToHtml(articleSections);
  return {
    id,
    status:      els.statusField.value,
    category:    els.category.value,
    icon:        els.icon.value.trim() || 'article',
    readMinutes: Number(els.readMinutes.value || 5),
    order:       Number(els.order.value || 100),
    tags:        els.tags.value.split(',').map(function (tag) { return tag.trim(); }).filter(Boolean),
    stub:        els.statusField.value === 'Coming soon',
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

function syncSectionFromCard(card) {
  const section = articleSections.find(function (item) { return item.id === card.dataset.sectionId; });
  if (!section) return;
  const bodyEl = card.querySelector('.sd-section-body-input');
  section.body = bodyEl ? bodyEl.value.trim() : section.body;
}

function renderSectionBuilder() {
  els.sections.textContent = '';
  articleSections.forEach(function (section, index) {
    const card = document.createElement('article');
    card.className = 'sd-section-card';
    card.dataset.sectionId = section.id;

    const head = document.createElement('div');
    head.className = 'sd-section-card-head';
    const number = document.createElement('span');
    number.className = 'sd-section-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const typeMeta = SECTION_TYPES.find(function (type) { return type.value === section.type; }) || SECTION_TYPES[0];
    const typeLabel = document.createElement('div');
    typeLabel.className = 'sd-section-type-label';
    typeLabel.textContent = typeMeta.label;
    const actions = document.createElement('div');
    actions.className = 'reco-actions sd-section-actions';
    const actionTrigger = document.createElement('button');
    actionTrigger.type = 'button';
    actionTrigger.className = 'reco-actions-trigger sd-section-actions-trigger';
    actionTrigger.setAttribute('aria-label', 'Section actions');
    actionTrigger.setAttribute('aria-haspopup', 'menu');
    actionTrigger.setAttribute('aria-expanded', 'false');
    const actionIcon = document.createElement('span');
    actionIcon.className = 'material-symbols-outlined';
    actionIcon.setAttribute('aria-hidden', 'true');
    actionIcon.textContent = 'more_vert';
    actionTrigger.appendChild(actionIcon);

    const actionMenu = document.createElement('div');
    actionMenu.className = 'reco-actions-menu sd-section-actions-menu';
    actionMenu.setAttribute('role', 'menu');
    actionMenu.hidden = true;

    const editAction = document.createElement('button');
    editAction.type = 'button';
    editAction.className = 'reco-action-item sd-section-action-item';
    editAction.setAttribute('role', 'menuitem');
    const editIcon = document.createElement('span');
    editIcon.className = 'material-symbols-outlined';
    editIcon.setAttribute('aria-hidden', 'true');
    editIcon.textContent = 'edit';
    const editLabel = document.createElement('span');
    editLabel.textContent = 'Edit';
    editAction.append(editIcon, editLabel);

    const deleteAction = document.createElement('button');
    deleteAction.type = 'button';
    deleteAction.className = 'reco-action-item reco-action-item-destructive sd-section-action-item';
    deleteAction.setAttribute('role', 'menuitem');
    const deleteIcon = document.createElement('span');
    deleteIcon.className = 'material-symbols-outlined';
    deleteIcon.setAttribute('aria-hidden', 'true');
    deleteIcon.textContent = 'delete';
    const deleteLabel = document.createElement('span');
    deleteLabel.textContent = 'Delete';
    deleteAction.append(deleteIcon, deleteLabel);

    actionMenu.addEventListener('click', function (event) { event.stopPropagation(); });
    actionMenu.append(editAction, deleteAction);
    actions.append(actionTrigger, actionMenu);
    head.append(number, typeLabel, actions);

    const readOnlyBody = document.createElement('div');
    readOnlyBody.className = 'sd-section-body-readonly';
    readOnlyBody.textContent = section.body || 'No content yet. Use Edit to write this section.';

    const body = document.createElement('textarea');
    body.className = 'sd-section-body-input';
    body.rows = 5;
    body.placeholder = 'Write this section in plain language. Bullets, **bold**, and `code` are supported.';
    body.value = section.body || '';
    body.hidden = true;

    const editBar = document.createElement('div');
    editBar.className = 'sd-section-edit-bar';
    editBar.hidden = true;
    const doneEdit = document.createElement('button');
    doneEdit.type = 'button';
    doneEdit.textContent = 'Done';
    editBar.appendChild(doneEdit);

    card.append(head, readOnlyBody, body, editBar);
    card.addEventListener('input', function () {
      syncSectionFromCard(card);
      renderPreview();
      markDirty();
    });
    card.addEventListener('change', function () {
      syncSectionFromCard(card);
      renderPreview();
      markDirty();
    });
    actionTrigger.addEventListener('click', function (event) {
      event.stopPropagation();
      const willOpen = actionMenu.hidden;
      closeSectionActionMenus();
      closeArticleDetailsMenu();
      actionMenu.hidden = !willOpen;
      actionTrigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    editAction.addEventListener('click', function () {
      closeSectionActionMenus();
      readOnlyBody.hidden = true;
      body.hidden = false;
      editBar.hidden = false;
      body.focus();
    });
    doneEdit.addEventListener('click', function () {
      syncSectionFromCard(card);
      readOnlyBody.textContent = section.body || 'No content yet. Use Edit to write this section.';
      readOnlyBody.hidden = false;
      body.hidden = true;
      editBar.hidden = true;
      renderPreview();
      markDirty();
    });
    deleteAction.addEventListener('click', function () {
      closeSectionActionMenus();
      articleSections = articleSections.filter(function (item) { return item.id !== section.id; });
      if (!articleSections.length) articleSections.push(sectionTemplate('overview'));
      renderSectionBuilder();
      renderPreview();
      markDirty();
    });
    els.sections.appendChild(card);
  });
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

function updateWorkflowChrome(status, saveLabel, saveKind) {
  const effectiveStatus = status || els.statusField.value || 'Draft';
  els.previewState.textContent = effectiveStatus;
  els.previewState.dataset.status = effectiveStatus;
  if (saveLabel !== undefined) {
    els.saveState.textContent = saveLabel || 'Unsaved changes';
    els.saveState.dataset.status = saveKind || (saveLabel ? 'saved' : 'dirty');
  }
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

function canAutosaveDraft(article) {
  return article.status === 'Draft'
    && article.id
    && article.en.title.length >= 3
    && !!article.en.body;
}

function scheduleDraftAutosave() {
  clearDraftAutosave();
  const article = articleFromForm();
  if (!canAutosaveDraft(article)) return;
  autosaveTimer = setTimeout(function () {
    autosaveTimer = 0;
    updateWorkflowChrome('Draft', 'Autosaving...', 'saving');
    saveArticleWithStatus('Draft', { silent: true }).catch(function () {
      updateWorkflowChrome('Draft', 'Autosave failed', 'error');
    });
  }, 1200);
}

function fillForm(article) {
  const item = article || {
    id: '',
    status: 'Draft',
    category: 'integration',
    icon: 'article',
    readMinutes: 5,
    order: 100,
    tags: [],
    en: { title: '', subtitle: '', body: '' },
  };
  const en = item.en || {};
  selectedId = item.id || '';
  els.id.value = item.id || '';
  els.statusField.value = item.status || 'Draft';
  els.category.value = item.category || 'integration';
  els.icon.value = item.icon || 'article';
  els.readMinutes.value = item.readMinutes || 5;
  els.order.value = item.order || 100;
  els.title.value = en.title || '';
  els.subtitle.value = en.subtitle || '';
  els.tags.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
  els.detailsForm.hidden = true;
  renderArticleDetails();
  articleSections = htmlToSections(en.body || '');
  els.body.value = '';
  renderSectionBuilder();
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
    const category = document.createElement('span');
    category.className = 'sd-admin-chip sd-admin-chip-muted';
    category.textContent = article.category || 'uncategorized';
    top.append(status, category);
    const title = document.createElement('strong');
    title.textContent = en.title || article.id;
    const subtitle = document.createElement('small');
    subtitle.textContent = en.subtitle || article.id;
    const meta = document.createElement('span');
    meta.className = 'sd-admin-article-meta';
    meta.textContent = (article.readMinutes || 5) + ' min read · Order ' + (article.order || 100);
    btn.append(top, title, subtitle, meta);
    btn.addEventListener('click', function () {
      const article = articles.find(function (item) { return item.id === btn.dataset.id; });
      fillForm(article);
    });
    els.list.appendChild(btn);
  });
}

function renderPreview() {
  const article = articleFromForm();
  updateWorkflowChrome(article.status);
  els.previewMeta.textContent = (article.status || 'Draft') + ' · ' + (article.category || 'integration') + ' · ' + article.readMinutes + ' min read';
  els.previewTitle.textContent = article.en.title || 'Untitled article';
  els.previewSubtitle.textContent = article.en.subtitle || '';
  els.previewBody.textContent = article.en.body
    ? articleSections.length + ' structured section' + (articleSections.length === 1 ? '' : 's') + ' will render as the public article.'
    : 'Nothing to preview yet.';
}

async function loadArticles() {
  setStatus('Loading articles...', 'info');
  const data = await authedJson('/api/admin/system-design/articles');
  articles = Array.isArray(data.articles) ? data.articles : [];
  els.modules.hidden = false;
  els.workspace.hidden = false;
  els.signOut.hidden = false;
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
  const data = await authedJson('/api/admin/system-design/articles/' + article.id, {
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
  els.title.focus();
});
els.doneDetailsBtn.addEventListener('click', function () {
  els.detailsForm.hidden = true;
  renderArticleDetails();
  renderPreview();
  markDirty();
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
els.addSectionBtn.addEventListener('click', function () {
  articleSections.push(sectionTemplate(nextSectionType()));
  renderSectionBuilder();
  renderPreview();
  markDirty();
});

els.title.addEventListener('input', function () {
  if (!selectedId) els.id.value = slugify(els.title.value);
  renderArticleDetails();
  renderPreview();
  markDirty();
});
[
  els.id, els.statusField, els.category, els.icon, els.readMinutes, els.order,
  els.subtitle, els.tags, els.body,
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
if (els.previewBtn) els.previewBtn.addEventListener('click', renderPreview);
els.publishBtn.addEventListener('click', function () {
  publishArticle().catch(function (err) { setSectionStatus(els.systemStatus, err.message, 'error'); });
});
els.seedBtn.addEventListener('click', function () {
  seedArticles().catch(function (err) { setSectionStatus(els.systemStatus, err.message, 'error'); });
});
els.newBtn.addEventListener('click', function () {
  selectedId = '';
  fillForm(null);
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
