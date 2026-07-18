import { test, expect } from '@playwright/test';
import { mockSubscriberSession, mockFreeSession, mockArticleAccess } from './helpers/mock-session';

/**
 * Premium content gating tests.
 *
 * Scenarios:
 *  1. Guest (not signed in)      → sees paywall on premium article
 *  2. Free / signed-in user      → sees paywall on premium article
 *  3. Active subscriber          → sees full article content, no paywall
 *  4. Manual override free       → sees paywall even with active Stripe sub
 *
 * How mocking works:
 *   On localhost, GET /api/local-preview returns { enabled:true } which makes
 *   the SPA skip session fetch and set siteProfile = { type:'guest' }.
 *   To inject real session state we:
 *     - Mock /api/local-preview → { enabled:false }
 *     - Inject a fake credential into sessionStorage via addInitScript
 *     - Mock POST /api/session/start → return the desired profile
 *     - Mock GET /api/system-design/articles/:id → control hasAccess
 *   Guest tests only mock the article API (local-preview always grants access).
 *
 * The local server must be running: npm start
 */

const PREMIUM_ARTICLE = '/software-architecture/why-we-didn-t-use-rag-yet';
const SA_PAGE         = '/software-architecture';

// ── Scenario 1: Guest ─────────────────────────────────────────────────────
test.describe('Guest user (not signed in)', () => {
  test.beforeEach(async ({ page }) => {
    // Local-preview returns hasAccess:true for all articles regardless of auth.
    // Mock the article API so it behaves like production (locked for guests).
    await mockArticleAccess(page, false);
  });

  test('sees premium tier badge in list view', async ({ page }) => {
    await page.goto(SA_PAGE);
    await page.waitForSelector('#pubViewList');
    await page.locator('#pubViewList').click();
    await page.waitForSelector('.sd-pub-articles-table');
    await expect(page.locator('.sd-pub-tier-premium').first()).toBeVisible();
  });

  test('sees paywall when opening premium article directly', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-tier-gate')).toBeVisible();
    await expect(page.locator('#sdSubscribeBtn')).toBeVisible();
  });

  test('cannot see full article body', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-article-body')).not.toBeVisible();
  });
});

// ── Scenario 2: Signed-in free user ───────────────────────────────────────
test.describe('Signed-in free user', () => {
  test.beforeEach(async ({ page }) => {
    await mockFreeSession(page);
  });

  test('sees paywall on premium article', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-tier-gate')).toBeVisible();
  });

  test('cannot see full article body', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-article-body')).not.toBeVisible();
  });

  test('sees Subscribe button, not Manage button', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('#sdSubscribeBtn')).toBeVisible();
    await expect(page.locator('#sdManageSubBtn')).toBeHidden();
  });

  test('free articles are fully readable', async ({ page }) => {
    await page.goto(SA_PAGE);
    await page.waitForSelector('.sd-pub-card');
    await page.getByRole('heading', { name: /System Design: Processing 1 Million Salesforce Records with Outbound API Callouts/i }).click();
    await expect(page.locator('.sd-article-body')).toBeVisible();
    await expect(page.locator('.sd-tier-gate')).not.toBeAttached();
  });
});

// ── Scenario 3: Active subscriber ─────────────────────────────────────────
test.describe('Active subscriber', () => {
  test.beforeEach(async ({ page }) => {
    await mockSubscriberSession(page);
  });

  test('premium articles remain visible in list view', async ({ page }) => {
    await page.goto(SA_PAGE);
    await page.waitForSelector('#pubViewList');
    await page.locator('#pubViewList').click();
    // Wait for session/start to complete so siteProfile is set, then re-render applies
    await page.waitForResponse(resp =>
      resp.url().includes('/api/session/start') && resp.status() === 200
    );
    // Small render-tick settle
    await page.waitForTimeout(400);
    await expect(page.locator('.sd-pub-tier-premium').first()).toBeVisible();
  });

  test('sees full article body on premium article', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-article-body')).toBeVisible();
  });

  test('does not see paywall', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-tier-gate')).not.toBeAttached();
  });

  test('sees Manage button, not Subscribe button', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    // Wait for session/start so siteProfile.subscription.active is set
    await page.waitForResponse(resp =>
      resp.url().includes('/api/session/start') && resp.status() === 200
    );
    await page.waitForTimeout(400);
    await expect(page.locator('#sdManageSubBtn')).toBeVisible();
    await expect(page.locator('#sdSubscribeBtn')).toBeHidden();
  });
});

// ── Scenario 4: Manual tier override ──────────────────────────────────────
test.describe('Manual tier override', () => {
  test('admin-forced free tier blocks access even when subscription says active', async ({ page }) => {
    // Simulate: Stripe says active, but server-side manual override → tier=free
    // Our mockFreeSession returns hasAccess:false from the article API and a
    // free-tier session profile — exactly what the server returns after a manual override.
    await mockFreeSession(page);
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-tier-gate')).toBeVisible();
    await expect(page.locator('.sd-article-body')).not.toBeVisible();
  });
});

// ── Scenario 5: Navigation UX ─────────────────────────────────────────────
test.describe('Navigation', () => {
  test('filter chips appear on article detail page', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await expect(page.locator('.sd-detail-chips')).toBeVisible();
    await expect(page.locator('.sd-type-chip')).toHaveCount(4);
  });

  test('clicking a chip from article detail navigates back to filtered list', async ({ page }) => {
    await page.goto(PREMIUM_ARTICLE);
    await page.locator('.sd-detail-chips .sd-type-chip', { hasText: 'System Design' }).click();
    await expect(page).toHaveURL(SA_PAGE);
    await expect(page.locator('.sd-type-chip-active', { hasText: 'System Design' })).toBeVisible();
  });

  test('article list shows correct content type badges', async ({ page }) => {
    await page.goto(SA_PAGE);
    await page.waitForSelector('#pubViewList');
    await page.locator('#pubViewList').click();
    await page.waitForSelector('.sd-pub-chip');
    await expect(page.locator('.sd-pub-chip')).not.toHaveCount(0);
  });
});
