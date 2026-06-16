/* global document, fetch, google, sessionStorage, setTimeout, window */

import { GOOGLE_CLIENT_ID } from '/assets/core/config.js';

const STORAGE_KEY = 'portfolio_admin_credential';

let credential = sessionStorage.getItem(STORAGE_KEY) || '';
let articles = [];
let selectedId = '';

const els = {
  googleBtn:       document.getElementById('adminGoogleBtn'),
  signOut:         document.getElementById('adminSignOut'),
  status:          document.getElementById('adminStatus'),
  workspace:       document.getElementById('adminWorkspace'),
  list:            document.getElementById('articleList'),
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
  els.status.textContent = message;
  els.status.dataset.kind = kind || 'info';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function authHeaders() {
  return {
    Authorization: 'Bearer ' + credential,
    'Content-Type': 'application/json',
  };
}

async function authedJson(url, options) {
  const resp = await fetch(url, Object.assign({}, options || {}, {
    headers: Object.assign({}, authHeaders(), (options && options.headers) || {}),
  }));
  const data = await resp.json().catch(function () { return {}; });
  if (!resp.ok || data.success === false) {
    throw new Error(data.error || data.message || 'Request failed.');
  }
  return data;
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
  if (!articles.length) {
    els.list.innerHTML = '<div class="sd-admin-empty">No articles in Firestore yet.</div>';
    return;
  }
  els.list.innerHTML = articles.map(function (article) {
    const en = article.en || {};
    const active = article.id === selectedId ? ' sd-admin-article-active' : '';
    return '<button type="button" class="sd-admin-article' + active + '" data-id="' + article.id + '">' +
      '<strong>' + escapeHtml(en.title || article.id) + '</strong>' +
      '<span>' + escapeHtml(article.status || 'Draft') + ' · ' + escapeHtml(article.category || '') + '</span>' +
      '</button>';
  }).join('');
  els.list.querySelectorAll('.sd-admin-article').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const article = articles.find(function (item) { return item.id === btn.dataset.id; });
      fillForm(article);
    });
  });
}

function renderPreview() {
  const article = articleFromForm();
  els.previewTitle.textContent = article.en.title || 'Untitled article';
  els.previewSubtitle.textContent = article.en.subtitle || '';
  els.previewBody.innerHTML = article.en.body || '<p>Nothing to preview yet.</p>';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadArticles() {
  setStatus('Loading articles...', 'info');
  const data = await authedJson('/api/admin/system-design/articles');
  articles = Array.isArray(data.articles) ? data.articles : [];
  els.workspace.hidden = false;
  els.signOut.hidden = false;
  setStatus('Signed in. You can edit and publish articles.', 'success');
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

function initGoogle() {
  if (!GOOGLE_CLIENT_ID) {
    setStatus('Google Sign-In is not configured.', 'error');
    return;
  }
  if (!window.google || !window.google.accounts) {
    setTimeout(initGoogle, 200);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: function (resp) {
      credential = resp.credential || '';
      sessionStorage.setItem(STORAGE_KEY, credential);
      loadArticles().catch(function (err) {
        setStatus(err.message, 'error');
      });
    },
    ux_mode: 'popup',
    use_fedcm_for_prompt: true,
    use_fedcm_for_button: true,
  });
  google.accounts.id.renderButton(els.googleBtn, {
    theme: 'filled_black',
    size:  'large',
    text:  'continue_with',
    width: 260,
  });
  if (credential) {
    loadArticles().catch(function () {
      sessionStorage.removeItem(STORAGE_KEY);
      credential = '';
      setStatus('Sign in with your approved Google account.', 'info');
    });
  }
}

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
els.newBtn.addEventListener('click', function () {
  selectedId = '';
  fillForm(null);
  els.title.focus();
});
els.signOut.addEventListener('click', function () {
  credential = '';
  sessionStorage.removeItem(STORAGE_KEY);
  els.workspace.hidden = true;
  els.signOut.hidden = true;
  setStatus('Signed out.', 'info');
});

initGoogle();
