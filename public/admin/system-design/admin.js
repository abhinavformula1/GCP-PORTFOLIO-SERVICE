/* global DOMParser, URL, atob, clearTimeout, customElements, document, fetch, google, localStorage, sessionStorage, setTimeout */

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
const ARTICLE_CATEGORIES = ['integration', 'architecture', 'scale', 'security', 'delivery'];
const CUSTOM_SECTION_TYPE = 'custom';

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
  articleSettingsWorkspace: document.getElementById('articleSettingsWorkspace'),
  articleSettingsList: document.getElementById('articleSettingsList'),
  articleSettingsStatus: document.getElementById('articleSettingsStatus'),
  autoFixArticleOrderBtn: document.getElementById('autoFixArticleOrderBtn'),
  saveArticleSettingsBtn: document.getElementById('saveArticleSettingsBtn'),
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
  sectionPicker:   document.getElementById('sectionPicker'),
  sectionPickerOptions: document.getElementById('sectionPickerOptions'),
  customSectionTitle: document.getElementById('customSectionTitle'),
  createCustomSectionBtn: document.getElementById('createCustomSectionBtn'),
  cancelSectionPickerBtn: document.getElementById('cancelSectionPickerBtn'),
  systemStatus:    document.getElementById('systemDesignStatus'),
  previewBtn:      document.getElementById('previewBtn'),
  publishBtn:      document.getElementById('publishBtn'),
  publishDialog:   document.getElementById('publishReviewDialog'),
  publishReviewHeading: document.getElementById('publishReviewTitle'),
  publishReviewDescription: document.getElementById('publishReviewDescription'),
  publishReviewMeta: document.getElementById('publishReviewMeta'),
  publishReviewTitle: document.getElementById('publishReviewArticleTitle'),
  publishReviewSubtitle: document.getElementById('publishReviewSubtitle'),
  publishReviewBody: document.getElementById('publishReviewBody'),
  publishPreviewPanel: document.getElementById('publishPreviewPanel'),
  publishSeoPanel: document.getElementById('publishSeoPanel'),
  publishSeoSlug: document.getElementById('publishSeoSlug'),
  publishSeoCategory: document.getElementById('publishSeoCategory'),
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
  status.textContent = message;
  status.dataset.kind = kind || 'info';
}

function setSectionStatus(el, message, kind) {
  if (!el) return;
  el.textContent = message || '';
  if (message) el.dataset.kind = kind || 'info';
  else delete el.dataset.kind;
}

function createMaterialIcon(name) {
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = name;
  return icon;
}

function createAuthoringActionItem(action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'reco-action-item' + (action.destructive ? ' reco-action-item-destructive' : '');
  if (action.className) button.className += ' ' + action.className;
  button.setAttribute('role', 'menuitem');
  button.append(createMaterialIcon(action.icon), document.createTextNode(action.label));
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (action.onClick) action.onClick(event);
  });
  return button;
}

function createAuthoringActions(options) {
  const actions = document.createElement('div');
  actions.className = 'reco-actions' + (options.className ? ' ' + options.className : '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'reco-actions-trigger' + (options.triggerClassName ? ' ' + options.triggerClassName : '');
  trigger.setAttribute('aria-label', options.label || 'Authoring actions');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.appendChild(createMaterialIcon('more_vert'));

  const menu = document.createElement('div');
  menu.className = 'reco-actions-menu' + (options.menuClassName ? ' ' + options.menuClassName : '');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.addEventListener('click', function (event) { event.stopPropagation(); });
  (options.items || []).forEach(function (action) {
    menu.appendChild(createAuthoringActionItem(action));
  });

  trigger.addEventListener('click', function (event) {
    event.stopPropagation();
    const willOpen = menu.hidden;
    if (options.onBeforeOpen) options.onBeforeOpen();
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  actions.append(trigger, menu);
  return { actions, trigger, menu };
}

function createAuthoringToolbar(options) {
  const toolbar = document.createElement('div');
  toolbar.className = 'sd-authoring-toolbar' + (options.className ? ' ' + options.className : '');
  toolbar.hidden = true;

  (options.items || []).forEach(function (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sd-authoring-toolbar-btn' + (action.primary ? ' sd-authoring-toolbar-btn-primary' : '');
    button.append(createMaterialIcon(action.icon), document.createTextNode(action.label));
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!action.onClick) return;
      const previous = button.disabled;
      button.disabled = true;
      Promise.resolve()
        .then(function () { return action.onClick({ event, button }); })
        .finally(function () { button.disabled = previous; });
    });
    toolbar.appendChild(button);
  });

  if (options.doneAction) {
    const spacer = document.createElement('span');
    spacer.className = 'sd-authoring-toolbar-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    toolbar.appendChild(spacer);

    const doneButton = document.createElement('button');
    doneButton.type = 'button';
    doneButton.className = 'sd-authoring-toolbar-btn sd-authoring-toolbar-done';
    doneButton.textContent = 'Done';
    doneButton.addEventListener('click', function (event) {
      event.stopPropagation();
      options.doneAction();
    });
    toolbar.appendChild(doneButton);
  }

  return toolbar;
}

function createAuthoringCard(options) {
  const card = document.createElement(options.tagName || 'article');
  card.className = 'sd-authoring-card' + (options.className ? ' ' + options.className : '');
  Object.entries(options.dataset || {}).forEach(function ([key, value]) {
    card.dataset[key] = value;
  });

  const head = document.createElement('div');
  head.className = 'sd-authoring-card-head' + (options.headClassName ? ' ' + options.headClassName : '');
  if (options.leading) head.appendChild(options.leading);

  const title = document.createElement('div');
  title.className = 'sd-authoring-card-title' + (options.titleClassName ? ' ' + options.titleClassName : '');
  title.textContent = options.title || 'Untitled';
  head.appendChild(title);

  let editor = null;
  let titleEditor = null;
  let toolbar = null;
  const readOnly = options.renderReadOnly ? options.renderReadOnly() : document.createElement('div');

  function setEditing(editing) {
    card.classList.toggle('sd-authoring-card-editing', editing);
    title.hidden = editing && !!titleEditor;
    if (titleEditor) titleEditor.hidden = !editing;
    readOnly.hidden = editing;
    if (editor) editor.hidden = !editing;
    if (toolbar) toolbar.hidden = !editing;
    if (editing && options.onEdit) options.onEdit({ card, editor, readOnly, title, titleEditor, toolbar });
  }

  const customActions = (options.actions || []).map(function (action) {
    return Object.assign({}, action, {
      onClick: function (event) {
        if (options.onBeforeOpen) options.onBeforeOpen();
        if (action.onClick) action.onClick({ card, editor, readOnly, setEditing, event });
      },
    });
  });
  const actions = createAuthoringActions({
    label: options.actionsLabel,
    className: options.actionsClassName,
    triggerClassName: options.triggerClassName,
    menuClassName: options.menuClassName,
    onBeforeOpen: options.onBeforeOpen,
    items: customActions.concat([
      {
        icon:    'edit',
        label:   'Edit',
        onClick: function () {
          if (options.onBeforeOpen) options.onBeforeOpen();
          setEditing(true);
        },
      },
    ].concat(options.deleteAction ? [{
      icon:        'delete',
      label:       'Delete',
      destructive: true,
      onClick:     options.deleteAction,
    }] : [])),
  });
  head.appendChild(actions.actions);

  titleEditor = options.renderTitleEditor ? options.renderTitleEditor() : null;
  if (titleEditor) {
    titleEditor.hidden = true;
    head.insertBefore(titleEditor, actions.actions);
  }

  editor = options.renderEditor ? options.renderEditor() : null;
  if (editor) editor.hidden = true;
  toolbar = createAuthoringToolbar({
    className: options.toolbarClassName,
    items: (options.toolbarActions || []).map(function (action) {
      return Object.assign({}, action, {
        onClick: function (toolbarApi) {
          return action.onClick({
            card,
            editor,
            readOnly,
            title,
            titleEditor,
            toolbar,
            setEditing,
            event: toolbarApi.event,
            button: toolbarApi.button,
          });
        },
      });
    }),
    doneAction: function () {
      if (options.onDone) options.onDone({ card, editor, readOnly, title, titleEditor });
      setEditing(false);
    },
  });

  card.append(head, readOnly);
  if (editor) card.appendChild(editor);
  if (options.toolbarActions?.length) card.appendChild(toolbar);
  return { card, readOnly, editor, toolbar, setEditing };
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
  els.articleSettingsWorkspace.hidden = true;
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

async function improveSectionWithAi(section, cardApi, mode) {
  const { card, editor, readOnly, setEditing } = cardApi;
  if (!editor) return;
  syncSectionFromCard(card);
  const sectionBody = String(section.body || editor.value || '').trim();
  if (!sectionBody) {
    setSectionStatus(els.systemStatus, 'Write a rough draft first, then AI can improve it.', 'error');
    setEditing(true);
    editor.focus();
    return;
  }

  const typeMeta = SECTION_TYPES.find(function (type) { return type.value === section.type; }) || SECTION_TYPES[0];
  const assistMode = mode || 'improve';
  const modeLabel = assistMode === 'concise' ? 'making concise'
    : assistMode === 'grammar' ? 'fixing grammar'
      : 'improving';
  setSectionStatus(els.systemStatus, 'AI is ' + modeLabel + ' the ' + typeMeta.label + ' section...', 'info');
  const data = await authedJson('/api/admin/system-design/writing-assist', {
    method: 'POST',
    body:   JSON.stringify({
      articleTitle:    els.title.value.trim(),
      articleSubtitle: els.subtitle.value.trim(),
      sectionType:     section.type,
      sectionLabel:    typeMeta.label,
      sectionBody,
      mode:           assistMode,
    }),
  });
  const suggestion = String(data.suggestion || '').trim();
  if (!suggestion) throw new Error('AI returned an empty suggestion.');

  section.body = suggestion;
  editor.value = suggestion;
  readOnly.textContent = suggestion;
  setEditing(true);
  renderPreview();
  markDirty();
  const source = data.source === 'local-preview' ? 'local preview' : 'Gemini';
  const tokenText = data.usage?.totalTokens ? ' · ' + data.usage.totalTokens + ' tokens' : '';
  setSectionStatus(els.systemStatus, 'AI suggestion applied from ' + source + tokenText + '. Review and press Done.', 'success');
}

function handleAdminLoadError(err) {
  els.workspace.hidden = true;
  els.modules.hidden = true;
  els.policyWorkspace.hidden = true;
  els.articleSettingsWorkspace.hidden = true;
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
  const isSettings = moduleName === 'article-settings';
  els.workspace.hidden = isPolicy || isSettings;
  els.policyWorkspace.hidden = !isPolicy;
  els.articleSettingsWorkspace.hidden = !isSettings;
  if (isSettings) renderArticleSettings();
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

function customSectionTemplate(title) {
  const cleanTitle = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return {
    id: 'section-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    type: CUSTOM_SECTION_TYPE,
    title: cleanTitle || 'Custom section',
    body: '',
  };
}

function sectionMeta(section) {
  if (section.type === CUSTOM_SECTION_TYPE) {
    const title = String(section.title || 'Custom section').trim() || 'Custom section';
    return { value: CUSTOM_SECTION_TYPE, label: title, title };
  }
  return SECTION_TYPES.find(function (type) { return type.value === section.type; }) || SECTION_TYPES[0];
}

function sectionsToHtml(sections) {
  return sections
    .filter(function (section) { return section.body; })
    .map(function (section) {
      const title = sectionMeta(section).title;
      return '<h3>' + inlineMarkdown(title) + '</h3>' + markdownToHtml(section.body);
    })
    .join('');
}

function htmlToSections(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const sections = [];
  let current = null;

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sectionTypeForHeading(heading) {
    const value = cleanText(heading).toLowerCase();
    if (/problem|question|shape/.test(value)) return 'problem';
    if (/alternative|trade|option|comparison/.test(value)) return 'tradeoffs';
    if (/risk|failure|bearer|trust|boundary|threat|security/.test(value)) return 'risks';
    if (/conclusion|summary|takeaway|decision/.test(value)) return sections.length ? 'conclusion' : 'overview';
    if (/solution|goal|architecture|implementation|property|flow|design/.test(value)) return 'solution';
    return sections.length ? CUSTOM_SECTION_TYPE : 'overview';
  }

  function labelledCardText(card) {
    if (card.parentElement?.matches('.sd-sequence')) {
      const step = cleanText(card.querySelector('b')?.textContent);
      const detailText = cleanText(card.querySelector('span')?.textContent || card.textContent);
      return (step ? step + '. ' : '- ') + detailText;
    }
    const title = cleanText(card.querySelector('strong')?.textContent || card.querySelector('span')?.textContent);
    const status = cleanText(card.querySelector(':scope > span')?.textContent);
    const detail = cleanText(Array.from(card.children)
      .filter(function (child) {
        return child.tagName !== 'STRONG'
          && !(child.tagName === 'SPAN' && child === card.querySelector(':scope > span'));
      })
      .map(function (child) { return child.textContent; })
      .join(' '));
    if (card.parentElement?.matches('.sd-decision-grid')) {
      const label = cleanText(card.querySelector('span')?.textContent);
      const value = cleanText(card.querySelector('strong')?.textContent);
      return label && value ? '- **' + label + ':** ' + value : cleanText(card.textContent);
    }
    if (status && detail && status !== title) return '- **' + title + ' (' + status + '):** ' + detail;
    if (title && detail) return '- **' + title + ':** ' + detail;
    if (title) return '- ' + title;
    return cleanText(card.textContent);
  }

  function bodyText(node) {
    if (node.matches && node.matches('ul,ol')) {
      return Array.from(node.querySelectorAll('li')).map(function (li) {
        return '- ' + cleanText(li.textContent);
      }).join('\n');
    }
    if (node.matches && node.matches('.sd-card-grid,.sd-decision-grid,.sd-risk-grid,.sd-comparison,.sd-sequence')) {
      return Array.from(node.children).map(labelledCardText).filter(Boolean).join('\n');
    }
    if (node.matches && node.matches('.sd-flow')) {
      return Array.from(node.children).map(function (child) { return cleanText(child.textContent); }).filter(Boolean).join(' -> ');
    }
    if (node.matches && node.matches('table')) {
      return Array.from(node.querySelectorAll('tr')).map(function (row) {
        return '- **' + cleanText(row.querySelector('th')?.textContent) + ':** ' + cleanText(row.querySelector('td')?.textContent);
      }).filter(function (line) { return !line.endsWith(':**'); }).join('\n');
    }
    if (node.matches && node.matches('section')) {
      return Array.from(node.children)
        .filter(function (child) { return !child.matches('h1,h2,h3,h4,h5,h6,.sd-kicker'); })
        .map(bodyText)
        .filter(Boolean)
        .join('\n\n');
    }
    return cleanText(node.textContent);
  }

  Array.from(doc.body.children).forEach(function (node) {
    if (node.matches && node.matches('section')) {
      const heading = node.querySelector('h1,h2,h3,h4,h5,h6');
      if (heading) {
        current = sectionTemplate(sectionTypeForHeading(heading.textContent));
        current.title = cleanText(heading.textContent) || current.title;
        sections.push(current);
      }
      const text = bodyText(node);
      if (text) {
        if (!current) {
          current = sectionTemplate('overview');
          sections.push(current);
        }
        current.body += (current.body ? '\n\n' : '') + text;
      }
      return;
    }
    if (node.matches('h1,h2,h3,h4,h5,h6')) {
      current = sectionTemplate(sectionTypeForHeading(node.textContent));
      current.title = cleanText(node.textContent) || current.title;
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

function closeSectionPicker() {
  els.sectionPicker.hidden = true;
  els.addSectionBtn.setAttribute('aria-expanded', 'false');
}

function openSectionPicker() {
  els.sectionPicker.hidden = false;
  els.addSectionBtn.setAttribute('aria-expanded', 'true');
  els.customSectionTitle.focus();
}

function addSection(section) {
  articleSections.push(section);
  closeSectionPicker();
  renderSectionBuilder();
  renderPreview();
  markDirty();
}

function renderSectionPickerOptions() {
  els.sectionPickerOptions.textContent = '';
  SECTION_TYPES.forEach(function (type) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sd-section-picker-option';
    const used = articleSections.some(function (section) { return section.type === type.value; });
    if (used) button.dataset.used = 'true';
    const title = document.createElement('strong');
    title.textContent = type.label;
    const hint = document.createElement('span');
    hint.textContent = used ? 'Already used. Add another if this article needs it.' : 'Standard article section';
    button.append(title, hint);
    button.addEventListener('click', function () {
      addSection(sectionTemplate(type.value));
    });
    els.sectionPickerOptions.appendChild(button);
  });
}

function renderSectionBuilder() {
  els.sections.textContent = '';
  articleSections.forEach(function (section, index) {
    const number = document.createElement('span');
    number.className = 'sd-section-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const typeMeta = sectionMeta(section);
    const authoringCard = createAuthoringCard({
      className: 'sd-section-card',
      headClassName: 'sd-section-card-head',
      dataset: { sectionId: section.id },
      leading: number,
      title: typeMeta.label,
      titleClassName: 'sd-section-type-label',
      actionsLabel: 'Section actions',
      actionsClassName: 'sd-section-actions',
      triggerClassName: 'sd-section-actions-trigger',
      menuClassName: 'sd-section-actions-menu',
      onBeforeOpen: function () {
        closeSectionActionMenus();
        closeArticleDetailsMenu();
        closePolicyRuleMenus();
      },
      toolbarActions: [{
        icon:    'auto_awesome',
        label:   'AI Improve',
        primary: true,
        onClick: function (cardApi) {
          return improveSectionWithAi(section, cardApi, 'improve').catch(function (err) {
            setSectionStatus(els.systemStatus, err.message, 'error');
          });
        },
      }, {
        icon:  'short_text',
        label: 'Concise',
        onClick: function (cardApi) {
          return improveSectionWithAi(section, cardApi, 'concise').catch(function (err) {
            setSectionStatus(els.systemStatus, err.message, 'error');
          });
        },
      }, {
        icon:  'spellcheck',
        label: 'Grammar',
        onClick: function (cardApi) {
          return improveSectionWithAi(section, cardApi, 'grammar').catch(function (err) {
            setSectionStatus(els.systemStatus, err.message, 'error');
          });
        },
      }],
      renderReadOnly: function () {
        const readOnlyBody = document.createElement('div');
        readOnlyBody.className = 'sd-section-body-readonly';
        readOnlyBody.textContent = section.body || 'No content yet. Use Edit to write this section.';
        return readOnlyBody;
      },
      renderTitleEditor: function () {
        const typeSelect = document.createElement('select');
        typeSelect.className = 'sd-section-type-select';
        typeSelect.setAttribute('aria-label', 'Section category');
        SECTION_TYPES.forEach(function (type) {
          const option = document.createElement('option');
          option.value = type.value;
          option.textContent = type.label;
          typeSelect.appendChild(option);
        });
        const customOption = document.createElement('option');
        customOption.value = CUSTOM_SECTION_TYPE;
        customOption.textContent = section.type === CUSTOM_SECTION_TYPE ? typeMeta.label : 'Custom section';
        typeSelect.appendChild(customOption);
        typeSelect.value = section.type;
        return typeSelect;
      },
      renderEditor: function () {
        const body = document.createElement('textarea');
        body.className = 'sd-section-body-input';
        body.rows = 5;
        body.placeholder = 'Write this section in plain language. Bullets, **bold**, and `code` are supported.';
        body.value = section.body || '';
        return body;
      },
      onEdit: function ({ editor }) {
        if (editor) editor.focus();
      },
      onDone: function ({ editor, readOnly, title, titleEditor }) {
        if (titleEditor) {
          section.type = titleEditor.value;
          if (section.type !== CUSTOM_SECTION_TYPE) {
            const updatedMeta = SECTION_TYPES.find(function (type) { return type.value === section.type; }) || SECTION_TYPES[0];
            section.title = updatedMeta.title;
            title.textContent = updatedMeta.label;
          } else {
            section.title = section.title || 'Custom section';
            title.textContent = section.title;
          }
        }
        section.body = editor ? editor.value.trim() : section.body;
        readOnly.textContent = section.body || 'No content yet. Use Edit to write this section.';
        renderPreview();
        markDirty();
      },
      deleteAction: function () {
        closeSectionActionMenus();
        articleSections = articleSections.filter(function (item) { return item.id !== section.id; });
        if (!articleSections.length) articleSections.push(sectionTemplate('overview'));
        renderSectionBuilder();
        renderPreview();
        markDirty();
      },
    });
    const card = authoringCard.card;
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
    category: 'integration',
    icon: 'article',
    readMinutes: 5,
    order: nextAvailableOrder(),
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

function createArticleSettingsField(labelText, field, value, type) {
  const label = document.createElement('label');
  label.className = 'sd-article-settings-field';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = labelText;
  let input;
  if (field === 'category') {
    input = document.createElement('select');
    ARTICLE_CATEGORIES.forEach(function (category) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      input.appendChild(option);
    });
    input.value = value || 'integration';
  } else {
    input = document.createElement('input');
    input.type = type || 'text';
    input.value = value || '';
    if (field === 'readMinutes') {
      input.min = '1';
      input.max = '60';
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
      createArticleSettingsField('Category', 'category', article.category || 'integration'),
      createArticleSettingsField('Icon', 'icon', article.icon || 'article'),
      createArticleSettingsField('Read time', 'readMinutes', String(article.readMinutes || 5), 'number'),
      createArticleSettingsField('Order', 'order', String(article.order || 100), 'number')
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
      category: input('category').value || 'integration',
      icon: input('icon').value.trim() || 'article',
      readMinutes: Number(input('readMinutes').value || 5),
      order: Number(input('order').value || 100),
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

function renderStructuredPreview(target) {
  target.textContent = '';
  const visibleSections = articleSections.filter(function (section) { return String(section.body || '').trim(); });
  if (!visibleSections.length) {
    const empty = document.createElement('p');
    empty.className = 'sd-preview-empty';
    empty.textContent = 'Nothing to preview yet. Add content to a section and it will appear here.';
    target.appendChild(empty);
    return;
  }

  visibleSections.forEach(function (section) {
    const previewSection = document.createElement('section');
    previewSection.className = 'sd-preview-section';
    const heading = document.createElement('h3');
    heading.textContent = sectionMeta(section).title;
    const body = document.createElement('div');
    body.className = 'sd-preview-section-body';
    body.innerHTML = markdownToHtml(section.body);
    previewSection.append(heading, body);
    target.appendChild(previewSection);
  });
}

function renderPreview() {
  const article = articleFromForm();
  updateWorkflowChrome(article.status);
}

function renderPublishReview() {
  const article = articleFromForm();
  els.publishReviewMeta.textContent = (article.status || 'Draft') + ' · ' + (article.category || 'integration') + ' · ' + article.readMinutes + ' min read';
  els.publishReviewTitle.textContent = article.en.title || 'Untitled article';
  els.publishReviewSubtitle.textContent = article.en.subtitle || '';
  els.publishSeoSlug.value = article.id || '';
  els.publishSeoCategory.value = article.category || 'integration';
  els.publishSeoIcon.value = article.icon || 'article';
  els.publishSeoReadMinutes.value = String(article.readMinutes || 5);
  els.publishSeoOrder.value = String(article.order || 100);
  renderPublishOrderWarning();
  renderStructuredPreview(els.publishReviewBody);
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
  els.category.value = els.publishSeoCategory.value || 'integration';
  els.icon.value = els.publishSeoIcon.value.trim() || 'article';
  els.readMinutes.value = els.publishSeoReadMinutes.value || '5';
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
  els.publishReviewHeading.textContent = isSeoStep ? 'Final check' : 'Ready to publish?';
  els.publishReviewDescription.textContent = isSeoStep
    ? 'Confirm SEO and ordering before this article goes live.'
    : 'Review the public version before it goes live.';
  els.continueEditingBtn.textContent = isSeoStep ? 'Back to preview' : 'Continue editing';
  els.publishActionLabel.textContent = isSeoStep ? 'Publish now' : 'Publish';
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
els.addSectionBtn.setAttribute('aria-haspopup', 'dialog');
els.addSectionBtn.setAttribute('aria-expanded', 'false');
els.addSectionBtn.addEventListener('click', function () {
  renderSectionPickerOptions();
  if (els.sectionPicker.hidden) openSectionPicker();
  else closeSectionPicker();
});
els.cancelSectionPickerBtn.addEventListener('click', closeSectionPicker);
els.createCustomSectionBtn.addEventListener('click', function () {
  const title = els.customSectionTitle.value.trim();
  if (!title) {
    els.customSectionTitle.focus();
    return;
  }
  addSection(customSectionTemplate(title));
  els.customSectionTitle.value = '';
});
els.customSectionTitle.addEventListener('keydown', function (event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.createCustomSectionBtn.click();
  } else if (event.key === 'Escape') {
    closeSectionPicker();
  }
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
  els.publishSeoCategory,
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
  publishArticle()
    .then(closePublishReview)
    .catch(function (err) { setSectionStatus(els.systemStatus, err.message, 'error'); });
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
