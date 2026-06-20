/**
 * ImageBlock — standalone image editor component.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────┐
 *   │  IMAGE BLOCK                              [🗑 Delete] │  ← header
 *   ├──────────────────────────────────────────────────────┤
 *   │  ┌───────────────────────────────────────────────┐   │
 *   │  │  [drag & drop or click to upload]             │   │  ← drop zone
 *   │  │  (shows preview once image is uploaded)       │   │
 *   │  └───────────────────────────────────────────────┘   │
 *   │  Alt text (required):  [________________________]    │
 *   │  Caption (optional):   [________________________]    │
 *   └──────────────────────────────────────────────────────┘
 *
 * Data model: { url, alt, caption }
 * DOM attrs:  data-block="image"  data-url="..."  data-alt="..."  data-caption="..."
 *
 * Public API
 *   createImageBlock(data, onChange) → { element, getData(), setEditable(bool) }
 *
 * The component calls POST /api/media/upload with the file and a Google
 * ID token from the page (window.__googleIdToken), then stores the returned URL.
 */

export function createImageBlock(initialData, onChange) {
  const data = {
    url:     String((initialData && initialData.url)     || ''),
    alt:     String((initialData && initialData.alt)     || ''),
    caption: String((initialData && initialData.caption) || ''),
  };

  const element = document.createElement('div');
  element.className = 'sd-image-component';
  element.contentEditable = 'false';
  element.setAttribute('data-block', 'image');
  element.setAttribute('tabindex', '-1');

  let editable = true;
  let uploading = false;

  // ── helpers ─────────────────────────────────────────────────────────────────

  function syncAttr() {
    element.dataset.url     = data.url;
    element.dataset.alt     = data.alt;
    element.dataset.caption = data.caption;
  }

  function emit() {
    syncAttr();
    if (typeof onChange === 'function') onChange(Object.assign({}, data));
  }

  function icon(name) {
    const s = document.createElement('span');
    s.className = 'material-symbols-outlined';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = name;
    return s;
  }

  function makeBtn(iconName, label, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-img-btn' + (extraClass ? ' ' + extraClass : '');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.appendChild(icon(iconName));
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ── upload ───────────────────────────────────────────────────────────────────

  async function doUpload(file) {
    if (uploading) return;
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Only image files are allowed.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setStatus('File too large. Maximum is 8 MB.', 'error');
      return;
    }

    uploading = true;
    setStatus('Uploading\u2026', 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers = {};
      // Use the admin credential (set by admin.js) or fall back to the Google
      // ID token set by other pages. In local preview mode __adminCredential is
      // 'local-admin-preview' and the server's requireAdmin bypasses auth entirely.
      const token = window.__adminCredential || window.__googleIdToken || '';
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const res = await fetch('/api/media/upload', { method: 'POST', headers, body: formData });
      const json = await res.json();

      if (!res.ok) throw new Error(json.message || json.error || 'Upload failed');

      data.url = json.url;
      clearStatus();
      render();
      emit();

      // Focus alt text field after upload
      const altInput = element.querySelector('.sd-img-alt');
      if (altInput) { altInput.focus(); altInput.select(); }
    } catch (err) {
      setStatus(err.message || 'Upload failed. Try again.', 'error');
    } finally {
      uploading = false;
    }
  }

  // ── status bar ───────────────────────────────────────────────────────────────

  let _statusEl = null;
  function setStatus(msg, type) {
    if (!_statusEl) return;
    _statusEl.textContent = msg;
    _statusEl.className = 'sd-img-status sd-img-status--' + (type || 'info');
    _statusEl.hidden = false;
  }
  function clearStatus() {
    if (_statusEl) { _statusEl.textContent = ''; _statusEl.hidden = true; }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  function render() {
    element.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'sd-img-header';
    const headerLabel = document.createElement('span');
    headerLabel.className = 'sd-img-header-label';
    headerLabel.appendChild(icon('image'));
    const labelTxt = document.createElement('span');
    labelTxt.textContent = 'Image';
    headerLabel.appendChild(labelTxt);
    header.appendChild(headerLabel);

    const headerActions = document.createElement('span');
    headerActions.className = 'sd-img-header-actions';

    if (data.url && editable) {
      headerActions.appendChild(makeBtn('swap_horiz', 'Replace image', function () {
        data.url = '';
        render(); emit();
      }, 'sd-img-replace-btn'));
    }

    headerActions.appendChild(makeBtn('delete', 'Delete image block', function () {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      if (element.parentNode) element.parentNode.replaceChild(p, element);
      if (typeof onChange === 'function') onChange(null);
    }, 'sd-img-del-btn'));

    header.appendChild(headerActions);
    element.appendChild(header);

    // Status bar
    _statusEl = document.createElement('div');
    _statusEl.className = 'sd-img-status';
    _statusEl.hidden = true;
    element.appendChild(_statusEl);

    const body = document.createElement('div');
    body.className = 'sd-img-body';

    // ── Drop zone / preview ───────────────────────────────────────────────────
    if (data.url) {
      // Image preview
      const preview = document.createElement('div');
      preview.className = 'sd-img-preview';
      const img = document.createElement('img');
      img.src = data.url;
      img.alt = data.alt || '';
      img.className = 'sd-img-preview-img';
      img.loading = 'lazy';
      preview.appendChild(img);
      body.appendChild(preview);
    } else if (editable) {
      // Drop zone
      const dropZone = document.createElement('label');
      dropZone.className = 'sd-img-dropzone';
      dropZone.setAttribute('tabindex', '0');
      dropZone.setAttribute('role', 'button');
      dropZone.setAttribute('aria-label', 'Upload image');

      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml';
      fileInput.className = 'sd-img-file-input';
      fileInput.setAttribute('aria-hidden', 'true');
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) doUpload(fileInput.files[0]);
      });

      const dropIcon = document.createElement('span');
      dropIcon.className = 'sd-img-drop-icon';
      dropIcon.appendChild(icon('upload'));

      const dropText = document.createElement('span');
      dropText.className = 'sd-img-drop-text';
      dropText.textContent = 'Drop an image here, or click to upload';

      const dropHint = document.createElement('span');
      dropHint.className = 'sd-img-drop-hint';
      dropHint.textContent = 'JPEG, PNG, GIF, WebP, SVG \u2014 max 8 MB';

      dropZone.appendChild(fileInput);
      dropZone.appendChild(dropIcon);
      dropZone.appendChild(dropText);
      dropZone.appendChild(dropHint);

      // Drag-and-drop
      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('sd-img-dropzone--active');
      });
      dropZone.addEventListener('dragleave', function () {
        dropZone.classList.remove('sd-img-dropzone--active');
      });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropZone.classList.remove('sd-img-dropzone--active');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) doUpload(file);
      });
      dropZone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
      });

      body.appendChild(dropZone);
    }

    // ── Alt text (required) ───────────────────────────────────────────────────
    const altRow = document.createElement('div');
    altRow.className = 'sd-img-field-row';
    const altLabel = document.createElement('label');
    altLabel.className = 'sd-img-field-label';
    altLabel.textContent = 'Alt text';
    const altRequired = document.createElement('span');
    altRequired.className = 'sd-img-required';
    altRequired.textContent = 'required';
    altLabel.appendChild(altRequired);

    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.className = 'sd-img-alt sd-img-field-input';
    altInput.value = data.alt;
    altInput.placeholder = 'Describe the image for screen readers and SEO';
    altInput.disabled = !editable;
    altInput.setAttribute('aria-label', 'Alt text (required for accessibility)');
    function updateAltBadge() {
      altRequired.textContent = altInput.value.trim() ? 'added' : 'required';
      altRequired.className   = altInput.value.trim() ? 'sd-img-ok' : 'sd-img-required';
    }
    updateAltBadge();
    altInput.addEventListener('input', function () {
      data.alt = altInput.value;
      updateAltBadge();
      emit();
    });

    altRow.appendChild(altLabel);
    altRow.appendChild(altInput);
    body.appendChild(altRow);

    // ── Caption (optional) ────────────────────────────────────────────────────
    const capRow = document.createElement('div');
    capRow.className = 'sd-img-field-row';
    const capLabel = document.createElement('label');
    capLabel.className = 'sd-img-field-label';
    capLabel.textContent = 'Caption';
    const capOptional = document.createElement('span');
    capOptional.className = 'sd-img-optional';
    capOptional.textContent = 'optional';
    capLabel.appendChild(capOptional);

    const capInput = document.createElement('input');
    capInput.type = 'text';
    capInput.className = 'sd-img-caption sd-img-field-input';
    capInput.value = data.caption;
    capInput.placeholder = 'Figure caption shown below the image';
    capInput.disabled = !editable;
    capInput.addEventListener('input', function () { data.caption = capInput.value; emit(); });

    capRow.appendChild(capLabel);
    capRow.appendChild(capInput);
    body.appendChild(capRow);

    element.appendChild(body);
    syncAttr();
  }

  // ── public API ───────────────────────────────────────────────────────────────

  function setEditableFn(val) {
    editable = !!val;
    element.classList.toggle('sd-img-editing', !!val);
    element.classList.toggle('sd-img-locked', !val);
    render();
  }

  render();
  setEditableFn(true);
  element._setEditable = setEditableFn;

  return {
    element,
    getData:     function () { return Object.assign({}, data); },
    setEditable: setEditableFn,
  };
}
