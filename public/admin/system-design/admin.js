/* global atob, document, fetch, google, localStorage, sessionStorage, setTimeout */

import { GOOGLE_CLIENT_ID } from '../../assets/core/config.js';
import {
  STORAGE_CREDENTIAL,
  STORAGE_PROFILE,
  setGoogleCredential,
  setSiteProfile,
} from '../../assets/core/state.js';
import { initTheme } from '../../assets/core/theme.js';
import { hideWelcomeOverlay, showWelcomeOverlay } from '../../assets/ui/welcome.js';
import { renderTechFooter, renderTopbar } from '../../assets/ui/shared-layout.js';
import {
  closeAssistant,
  initChat,
  minimiseAssistant,
  openAssistant,
  restartAssistant,
  toggleChatTeaser,
} from '../../assets/chat/chat.js';

const LEGACY_ADMIN_STORAGE_KEY = 'portfolio_admin_credential';
const ADMIN_HANDOFF_KEY = 'portfolio_admin_handoff';

let credential = sessionStorage.getItem(STORAGE_CREDENTIAL)
  || readAdminHandoffCredential()
  || sessionStorage.getItem(LEGACY_ADMIN_STORAGE_KEY)
  || '';
let articles = [];
let selectedId = '';

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
  list:            document.getElementById('articleList'),
  seedBtn:         document.getElementById('seedArticlesBtn'),
  newBtn:          document.getElementById('newArticleBtn'),
  id:              document.getElementById('articleId'),
  statusField:     document.getElementById('articleStatus'),
  category:        document.getElementById('articleCategory'),
  icon:            document.getElementById('articleIcon'),
  readMinutes:     document.getElementById('articleReadMinutes'),
  order:           document.getElementById('articleOrder'),
  title:           document.getElementById('articleTitle'),
  subtitle:        document.getElementById('articleSubtitle'),
  tags:            document.getElementById('articleTags'),
  body:            document.getElementById('articleBody'),
  previewBtn:      document.getElementById('previewBtn'),
  publishBtn:      document.getElementById('publishBtn'),
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
    if (handoff.profile && typeof handoff.profile === 'object') {
      sessionStorage.setItem(STORAGE_PROFILE, JSON.stringify(handoff.profile));
      setSiteProfile(handoff.profile);
    }
    if (handoff.credential) {
      sessionStorage.setItem(STORAGE_CREDENTIAL, handoff.credential);
      setGoogleCredential(handoff.credential);
      return handoff.credential;
    }
  } catch (_) {}
  return '';
}

function saveSharedSession(token) {
  const profile = profileFromCredential(token);
  setGoogleCredential(token);
  setSiteProfile(profile);
  sessionStorage.removeItem(LEGACY_ADMIN_STORAGE_KEY);
  return profile;
}

function updateAdminChrome(profile) {
  const signedIn = !!profile;
  els.topbarSignIn.hidden = signedIn;
  els.topbarUser.hidden = !signedIn;
  els.signOut.hidden = !signedIn;
  if (!signedIn) {
    els.userName.textContent = '';
    els.userPhoto.removeAttribute('src');
    els.userPhoto.alt = 'Signed-in admin profile photo';
    return;
  }
  els.userName.textContent = profile.name || profile.email || 'Admin';
  els.userPhoto.src = profile.picture || '';
  els.userPhoto.alt = (profile.name || 'Admin') + ' profile photo';
}

function resetAdminSession() {
  credential = '';
  setGoogleCredential(null);
  setSiteProfile(null);
  sessionStorage.removeItem(STORAGE_CREDENTIAL);
  sessionStorage.removeItem(STORAGE_PROFILE);
  sessionStorage.removeItem(LEGACY_ADMIN_STORAGE_KEY);
  els.workspace.hidden = true;
  els.dropdown.hidden = true;
  updateAdminChrome(null);
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
  if (err?.status === 401) {
    resetAdminSession();
  }
  setStatus(err.message, 'error');
}

function articleFromForm() {
  const id = slugify(els.id.value || els.title.value);
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
      body:     els.body.value.trim(),
    },
    fr: {
      title:    els.title.value.trim(),
      subtitle: els.subtitle.value.trim(),
      body:     els.body.value.trim(),
    },
  };
}

function fillForm(article) {
  const item = article || {
    id: '',
    status: 'Published',
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
  els.statusField.value = item.status || 'Published';
  els.category.value = item.category || 'integration';
  els.icon.value = item.icon || 'article';
  els.readMinutes.value = item.readMinutes || 5;
  els.order.value = item.order || 100;
  els.title.value = en.title || '';
  els.subtitle.value = en.subtitle || '';
  els.tags.value = Array.isArray(item.tags) ? item.tags.join(', ') : '';
  els.body.value = en.body || '';
  renderPreview();
  renderList();
}

function renderList() {
  els.list.textContent = '';
  if (!articles.length) {
    const empty = document.createElement('div');
    empty.className = 'sd-admin-empty';
    empty.textContent = 'No articles in Firestore yet.';
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
    const title = document.createElement('strong');
    title.textContent = en.title || article.id;
    const subtitle = document.createElement('small');
    subtitle.textContent = en.subtitle || article.id;
    const meta = document.createElement('span');
    meta.textContent = (article.status || 'Draft') + ' · ' + (article.category || '');
    btn.append(title, subtitle, meta);
    btn.addEventListener('click', function () {
      const article = articles.find(function (item) { return item.id === btn.dataset.id; });
      fillForm(article);
    });
    els.list.appendChild(btn);
  });
}

function renderPreview() {
  const article = articleFromForm();
  els.previewTitle.textContent = article.en.title || 'Untitled article';
  els.previewSubtitle.textContent = article.en.subtitle || '';
  els.previewBody.textContent = article.en.body
    ? 'Preview will render on the public System Design page after publishing.'
    : 'Nothing to preview yet.';
}

async function loadArticles() {
  setStatus('Loading articles...', 'info');
  const data = await authedJson('/api/admin/system-design/articles');
  articles = Array.isArray(data.articles) ? data.articles : [];
  els.workspace.hidden = false;
  els.signOut.hidden = false;
  setStatus('', 'info');
  renderList();
  fillForm(articles[0] || null);
}

async function publishArticle() {
  const article = articleFromForm();
  if (!article.id || !article.en.title || !article.en.body) {
    setStatus('Slug, title, and body are required.', 'error');
    return;
  }
  setStatus('Publishing...', 'info');
  const data = await authedJson('/api/admin/system-design/articles/' + article.id, {
    method: 'PUT',
    body:   JSON.stringify(article),
  });
  const saved = data.article;
  articles = articles.filter(function (item) { return item.id !== saved.id; }).concat(saved)
    .sort(function (a, b) { return Number(a.order || 999) - Number(b.order || 999); });
  fillForm(saved);
  setStatus('Published version ' + data.version + '.', 'success');
}

async function seedArticles() {
  setStatus('Importing seed articles...', 'info');
  const data = await authedJson('/api/admin/system-design/seed', { method: 'POST' });
  setStatus('Imported ' + data.imported + ' seed articles.', 'success');
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
      credential = resp.credential || '';
      hideWelcomeOverlay();
      const profile = saveSharedSession(credential);
      updateAdminChrome(profile);
      loadArticles().catch(function (err) {
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
    updateAdminChrome(saveSharedSession(credential));
    loadArticles().catch(function (err) {
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

els.title.addEventListener('input', function () {
  if (!selectedId) els.id.value = slugify(els.title.value);
  renderPreview();
});
[
  els.id, els.statusField, els.category, els.icon, els.readMinutes, els.order,
  els.subtitle, els.tags, els.body,
].forEach(function (el) {
  el.addEventListener('input', renderPreview);
  el.addEventListener('change', renderPreview);
});
els.previewBtn.addEventListener('click', renderPreview);
els.publishBtn.addEventListener('click', function () {
  publishArticle().catch(function (err) { setStatus(err.message, 'error'); });
});
els.seedBtn.addEventListener('click', function () {
  seedArticles().catch(function (err) { setStatus(err.message, 'error'); });
});
els.newBtn.addEventListener('click', function () {
  selectedId = '';
  fillForm(null);
  els.title.focus();
});
els.signOut.addEventListener('click', function () {
  resetAdminSession();
  setStatus('', 'info');
});

initTheme();
globalThis.toggleChatTeaser = toggleChatTeaser;
globalThis.openAssistant = openAssistant;
globalThis.closeAssistant = closeAssistant;
globalThis.minimiseAssistant = minimiseAssistant;
globalThis.restartAssistant = restartAssistant;
initChat();
initGoogle();
