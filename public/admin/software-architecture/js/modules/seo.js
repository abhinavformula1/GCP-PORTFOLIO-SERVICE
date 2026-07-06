/**
 * SEO / AEO configuration module.
 * S — all SEO config concerns live here.
 */

import { authedJson, setSectionStatus } from '../http.js';

let _seoConfig = null;

export async function renderSeoConfig(els) {
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
    els.seoAiCrawlersAllowed.checked  = _seoConfig.aiCrawlersAllowed  !== false;
    els.seoEeatSignalsEnabled.checked = _seoConfig.eeatSignalsEnabled !== false;
    updateSerpPreview(els);
    setSectionStatus(els.seoConfigStatus, '', '');
  } catch (err) {
    setSectionStatus(els.seoConfigStatus, 'Failed to load SEO config: ' + err.message, 'error');
  }
}

export async function saveSeoConfig(els) {
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
      llmsTxtEnabled:     els.seoLlmsTxtEnabled.checked,
      aiCrawlersAllowed:  els.seoAiCrawlersAllowed.checked,
      eeatSignalsEnabled: els.seoEeatSignalsEnabled.checked,
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

export function updateSerpPreview(els) {
  const url  = (els.seoSiteUrl.value || '').replace(/\/$/, '');
  const desc = els.seoSiteDescription.value || '';
  if (els.seoSerpUrl)   els.seoSerpUrl.textContent   = url || 'https://your-domain.com';
  if (els.seoSerpTitle) els.seoSerpTitle.textContent = 'Abhinav Kumar — Senior Salesforce Application Engineer';
  if (els.seoSerpDesc)  els.seoSerpDesc.textContent  = desc.slice(0, 160) || 'Meta description will appear here…';
  const count = desc.length;
  if (els.seoDescCharCount) {
    els.seoDescCharCount.textContent = count + ' / 160';
    els.seoDescCharCount.style.color = count > 160 ? 'var(--md-sys-color-error)' : '';
  }
}
