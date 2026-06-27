'use strict';

export function initPromotionsModule(deps) {
  const els = deps && deps.els ? deps.els : {};
  const authedJson = deps.authedJson;
  const setSectionStatus = deps.setSectionStatus;
  const safeText = deps.safeText || ((s) => String(s == null ? '' : s));

  let promotionsState = null;
  let _editingPromoCode = null;

  function fmtDate(ms) {
    if (!ms) return '—';
    try { return new Date(Number(ms)).toLocaleDateString(); } catch (_) { return '—'; }
  }

  async function render() {
    if (!els.promosPanel) return;
    if (promotionsState && Array.isArray(promotionsState.promos)) {
      paint();
      return;
    }
    await refresh();
  }

  async function refresh() {
    if (!els.promosPanel) return;
    setSectionStatus(els.promosStatus, 'Loading promotions…', 'info');
    els.promosPanel.textContent = '';
    try {
      const data = await authedJson('/api/admin/promotions');
      promotionsState = data;
      paint();
      setSectionStatus(els.promosStatus, 'Promotions updated.', 'success');
    } catch (err) {
      setSectionStatus(els.promosStatus, err.message || 'Failed to load promotions.', 'error');
    }
  }

  function paint() {
    if (!els.promosPanel) return;
    els.promosPanel.textContent = '';
    const state = promotionsState || {};
    const promos = Array.isArray(state.promos) ? state.promos : [];
    const activeCount = promos.filter(function (p) { return p && p.active !== false; }).length;
    const redeemedTotal = promos.reduce(function (sum, p) { return sum + Number((p && p.redeemedCount) || 0); }, 0);

    const tbody = promos.slice(0, 200).map(function (p) {
      const code = String(p.code || '');
      const days = Number(p.days || 0);
      const active = p.active !== false;
      const redeemed = Number(p.redeemedCount || 0);
      const max = p.maxRedemptions == null ? null : Number(p.maxRedemptions || 0);
      const limitText = max ? (redeemed.toLocaleString() + ' / ' + max.toLocaleString()) : redeemed.toLocaleString();
      const range = (p.startsAt || p.expiresAt)
        ? (fmtDate(p.startsAt) + ' → ' + fmtDate(p.expiresAt))
        : 'Always';
      return `
        <tr data-code="${safeText(code)}">
          <td>
            <div class="sd-analytics-user-name">${safeText(code)}</div>
            <div class="sd-analytics-user-sub">${safeText(range)}</div>
          </td>
          <td><span class="sd-analytics-chip" data-kind="promo" data-status="${active ? 'active' : 'disabled'}">${active ? 'Active' : 'Disabled'}</span></td>
          <td class="sd-analytics-num">${days.toLocaleString()}</td>
          <td class="sd-analytics-num">${safeText(limitText)}</td>
          <td>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button type="button" class="sd-admin-ghost sd-promo-edit" data-code="${safeText(code)}">Edit</button>
              <button type="button" class="sd-admin-ghost sd-promo-toggle" data-code="${safeText(code)}" data-active="${active ? '1' : '0'}">
                ${active ? 'Disable' : 'Enable'}
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    els.promosPanel.innerHTML = `
      <div class="sd-article-settings-card">
        <div class="sd-article-settings-card-head">
          <div>
            <h3>Quick create</h3>
            <p>Fast path for a new code. Use <strong>New promo</strong> for advanced settings (dates, status).</p>
          </div>
        </div>
        <form class="sd-promo-quick">
          <div class="sd-article-settings-grid" style="grid-template-columns: minmax(180px, 300px) repeat(2, minmax(120px, 0.7fr)) minmax(160px, 0.7fr);">
            <label class="sd-article-settings-field">
              <span>Code</span>
              <input name="code" type="text" placeholder="LAUNCH30" maxlength="24" required />
            </label>
            <label class="sd-article-settings-field">
              <span>Days</span>
              <input name="days" type="number" min="1" max="365" value="30" />
            </label>
            <label class="sd-article-settings-field">
              <span>Max</span>
              <input name="maxRedemptions" type="number" min="1" max="100000" placeholder="(optional)" />
            </label>
            <div class="sd-article-settings-field" style="gap:8px;">
              <span>&nbsp;</span>
              <div style="display:flex; gap:10px; align-items:center;">
                <button type="submit" class="sd-admin-primary">
                  <span class="material-symbols-outlined" aria-hidden="true">add</span> Create
                </button>
                <button type="button" class="sd-admin-ghost sd-promo-advanced">Advanced…</button>
              </div>
            </div>
          </div>
        </form>
      </div>
      <div class="sd-media-kpis sd-analytics-kpis" role="region" aria-label="Promotion KPIs">
        <div class="sd-media-kpi">
          <div class="sd-media-kpi-label">Codes</div>
          <div class="sd-media-kpi-value">${promos.length.toLocaleString()}</div>
          <div class="sd-media-kpi-sub">top 200 shown</div>
        </div>
        <div class="sd-media-kpi">
          <div class="sd-media-kpi-label">Active</div>
          <div class="sd-media-kpi-value">${activeCount.toLocaleString()}</div>
          <div class="sd-media-kpi-sub">enabled promos</div>
        </div>
        <div class="sd-media-kpi">
          <div class="sd-media-kpi-label">Redemptions</div>
          <div class="sd-media-kpi-value">${redeemedTotal.toLocaleString()}</div>
          <div class="sd-media-kpi-sub">total (all time)</div>
        </div>
      </div>
      <div class="sd-analytics-table-wrap">
        <table class="sd-analytics-table" style="min-width: 980px">
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th class="sd-analytics-num">Days</th>
              <th class="sd-analytics-num">Redeemed</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${tbody || '<tr><td colspan="5" class="sd-analytics-empty">No promotions yet. Click “New promo”.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    const quick = els.promosPanel.querySelector('.sd-promo-quick');
    if (quick) {
      quick.addEventListener('submit', async function (event) {
        event.preventDefault();
        const fd = new FormData(quick);
        const code = String(fd.get('code') || '').trim();
        const days = Number(fd.get('days') || 30);
        const maxRaw = String(fd.get('maxRedemptions') || '').trim();
        const payload = {
          code,
          days,
          maxRedemptions: maxRaw ? Number(maxRaw) : null,
          active: true,
        };
        setSectionStatus(els.promosStatus, 'Creating promo…', 'info');
        try {
          await authedJson('/api/admin/promotions', { method: 'POST', body: JSON.stringify(payload) });
          promotionsState = null;
          await refresh();
        } catch (err) {
          setSectionStatus(els.promosStatus, err.message || 'Failed to create promo.', 'error');
        }
      });
    }

    const adv = els.promosPanel.querySelector('.sd-promo-advanced');
    if (adv) {
      adv.addEventListener('click', function () {
        const formEl = els.promosPanel.querySelector('.sd-promo-quick');
        const codeEl = formEl ? formEl.querySelector('input[name="code"]') : null;
        const daysEl = formEl ? formEl.querySelector('input[name="days"]') : null;
        const maxEl = formEl ? formEl.querySelector('input[name="maxRedemptions"]') : null;
        openDrawer({
          code: codeEl ? String(codeEl.value || '').trim() : '',
          days: daysEl ? Number(daysEl.value || 30) : 30,
          maxRedemptions: (maxEl && String(maxEl.value || '').trim()) ? Number(maxEl.value) : null,
          active: true,
        });
      });
    }

    els.promosPanel.querySelectorAll('.sd-promo-toggle').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        const code = String(btn.dataset.code || '').trim();
        const currentlyActive = String(btn.dataset.active || '0') === '1';
        btn.disabled = true;
        try {
          await authedJson('/api/admin/promotions/' + encodeURIComponent(code), {
            method: 'PATCH',
            body: JSON.stringify({ active: !currentlyActive }),
          });
          promotionsState = null;
          await refresh();
        } catch (err) {
          setSectionStatus(els.promosStatus, err.message || 'Failed to update promo.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    els.promosPanel.querySelectorAll('.sd-promo-edit').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const code = String(btn.dataset.code || '').trim();
        const promo = promos.find(function (p) { return String(p.code || '') === code; }) || null;
        openDrawer(promo);
      });
    });
  }

  function openDrawer(promo) {
    _editingPromoCode = promo && promo.code ? String(promo.code) : null;
    if (!els.promoDrawer) return;
    els.promoDrawer.hidden = false;
    if (els.promoDrawerTitle) els.promoDrawerTitle.textContent = _editingPromoCode ? 'Edit Promo' : 'New Promo';
    setSectionStatus(els.promoDrawerStatus, '', 'info');

    const codeEl = document.getElementById('promoCode');
    const daysEl = document.getElementById('promoDays');
    const maxEl  = document.getElementById('promoMaxRedemptions');
    const sEl    = document.getElementById('promoStartsAt');
    const eEl    = document.getElementById('promoExpiresAt');
    const aEl    = document.getElementById('promoActive');

    if (codeEl) {
      codeEl.value = promo && promo.code ? String(promo.code) : '';
      codeEl.readOnly = !!_editingPromoCode;
    }
    if (daysEl) daysEl.value = String((promo && promo.days) ? Number(promo.days) : 30);
    if (maxEl)  maxEl.value  = (promo && promo.maxRedemptions) ? String(promo.maxRedemptions) : '';
    if (sEl)    sEl.value    = promo && promo.startsAt  ? new Date(promo.startsAt).toISOString().split('T')[0] : '';
    if (eEl)    eEl.value    = promo && promo.expiresAt ? new Date(promo.expiresAt).toISOString().split('T')[0] : '';
    if (aEl)    aEl.checked  = promo ? (promo.active !== false) : true;
  }

  function closeDrawer() {
    if (!els.promoDrawer) return;
    els.promoDrawer.hidden = true;
    _editingPromoCode = null;
  }

  async function save() {
    if (!els.savePromoBtn || els.savePromoBtn.disabled) return;
    els.savePromoBtn.disabled = true;
    setSectionStatus(els.promoDrawerStatus, 'Saving…', 'info');
    try {
      const code = String(document.getElementById('promoCode').value || '').trim();
      const days = Number(document.getElementById('promoDays').value || 30);
      const maxRaw = String(document.getElementById('promoMaxRedemptions').value || '').trim();
      const startsDate = String(document.getElementById('promoStartsAt').value || '').trim();
      const expiresDate = String(document.getElementById('promoExpiresAt').value || '').trim();
      const active = !!document.getElementById('promoActive').checked;

      const payload = {
        code,
        days,
        maxRedemptions: maxRaw ? Number(maxRaw) : null,
        startsAt: startsDate ? new Date(startsDate).getTime() : null,
        expiresAt: expiresDate ? new Date(expiresDate).getTime() : null,
        active,
      };

      if (_editingPromoCode) {
        await authedJson('/api/admin/promotions/' + encodeURIComponent(_editingPromoCode), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await authedJson('/api/admin/promotions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setSectionStatus(els.promoDrawerStatus, 'Saved!', 'success');
      promotionsState = null;
      setTimeout(function () { closeDrawer(); refresh(); }, 600);
    } catch (err) {
      setSectionStatus(els.promoDrawerStatus, err.message || 'Failed to save promo.', 'error');
    } finally {
      els.savePromoBtn.disabled = false;
    }
  }

  async function copyCode() {
    const code = String(document.getElementById('promoCode').value || '').trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setSectionStatus(els.promoDrawerStatus, 'Copied.', 'success');
    } catch (_) {
      setSectionStatus(els.promoDrawerStatus, 'Copy failed. Select and copy manually.', 'error');
    }
  }

  function bind() {
    if (els.refreshPromosBtn) {
      els.refreshPromosBtn.addEventListener('click', function () {
        promotionsState = null;
        refresh();
      });
    }
    if (els.newPromoBtn) {
      els.newPromoBtn.addEventListener('click', function () {
        openDrawer(null);
      });
    }
    if (els.closePromoDrawerBtn) els.closePromoDrawerBtn.addEventListener('click', closeDrawer);
    if (els.savePromoBtn) els.savePromoBtn.addEventListener('click', function () { save().catch(function () {}); });
    if (els.copyPromoBtn) els.copyPromoBtn.addEventListener('click', function () { copyCode().catch(function () {}); });
  }

  bind();

  return {
    render,
    refresh,
    openDrawer,
    closeDrawer,
  };
}

