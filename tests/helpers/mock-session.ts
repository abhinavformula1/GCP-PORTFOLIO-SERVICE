import { Page } from '@playwright/test';

/**
 * Session mocking helpers for Playwright tests.
 *
 * Architecture note:
 *   On localhost, the SPA calls GET /api/local-preview (enabled=true) and
 *   immediately sets siteProfile = { type:'guest' } — it never fetches /api/session.
 *   To inject a real subscriber/free session we must:
 *     1. Disable local-preview (mock /api/local-preview → { enabled: false }).
 *     2. Inject a fake credential into sessionStorage via addInitScript so the
 *        app calls POST /api/session/start instead of showing the sign-in overlay.
 *     3. Mock POST /api/session/start to return the desired profile without
 *        requiring a real Google JWT.
 *     4. Mock GET+POST /api/system-design/articles/:id so hasAccess is controlled
 *        independently of the server's localPreview flag.
 */

const PREMIUM_ARTICLE_ID = 'why-we-didn-t-use-rag-yet';
const FAKE_CREDENTIAL    = 'test-fake-google-credential-for-playwright';

const PREMIUM_ARTICLE_BASE = {
  id:          PREMIUM_ARTICLE_ID,
  tier:        'premium',
  contentType: 'architecture',
  readMinutes: 5,
  status:      'Published',
  stub:        false,
  blocks:      [],
  tags:        ['AI', 'Platform Engineering'],
};

const PREMIUM_ARTICLE_FULL = {
  ...PREMIUM_ARTICLE_BASE,
  en: { title: "Why We Didn't Use RAG (Yet)", subtitle: 'Retrieval-Augmented Generation', body: '<p>Full article content visible to subscribers.</p>' },
};

const PREMIUM_ARTICLE_LOCKED = {
  ...PREMIUM_ARTICLE_BASE,
  en: { title: "Why We Didn't Use RAG (Yet)", subtitle: 'Retrieval-Augmented Generation', body: '' },
};

// ── Low-level helpers ─────────────────────────────────────────────────────────

/**
 * Disables local-preview mode and injects a fake Google credential so
 * the SPA uses /api/session/start to load the profile (not the guest shortcut).
 */
async function disableLocalPreview(page: Page) {
  // Inject the fake credential before the page script runs
  await page.addInitScript((cred: string) => {
    try { sessionStorage.setItem('portfolio_credential', cred); } catch (_) {}
  }, FAKE_CREDENTIAL);

  // Force local-preview OFF so the SPA goes through the normal session path
  await page.route('**/api/local-preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false }),
    });
  });
}

/**
 * Mocks POST /api/session/start to return a specific profile without validating
 * the Google JWT — allowing headless tests to simulate signed-in users.
 */
async function mockSessionStart(page: Page, profile: Record<string, unknown>) {
  await page.route('**/api/session/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, ...profile }),
    });
  });
}

/**
 * Mocks the article API so hasAccess is controlled by the test, independent
 * of the server's localPreview flag (which always returns hasAccess:true locally).
 */
export async function mockArticleAccess(page: Page, hasAccess: boolean) {
  const article = hasAccess ? PREMIUM_ARTICLE_FULL : PREMIUM_ARTICLE_LOCKED;
  await page.route(`**/api/system-design/articles/${PREMIUM_ARTICLE_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, article: { ...article, hasAccess } }),
    });
  });
}

// ── Public session helpers ────────────────────────────────────────────────────

/**
 * Mocks a full subscriber session:
 *   - Disables local-preview mode
 *   - /api/session/start returns premium subscription profile
 *   - Article API returns hasAccess:true (full content)
 */
export async function mockSubscriberSession(page: Page) {
  await disableLocalPreview(page);
  await mockSessionStart(page, {
    sub:      'test-subscriber-001',
    name:     'Test Subscriber',
    email:    'subscriber@example.com',
    picture:  null,
    tier:     'premium',
    visitCount: 5,
    firstSeenAt: null,
    lastSeenAt:  null,
    isReturning: true,
    contact:  { canSeePhone: false, phone: null, matchedDomain: null },
    subscription: {
      active:           true,
      status:           'active',
      currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
      cancelAtPeriodEnd: false,
      planNickname:     'Premium Tier',
      amount:           900,
      currency:         'usd',
      interval:         'month',
      intervalCount:    1,
    },
  });
  await mockArticleAccess(page, true);
}

/**
 * Mocks a signed-in free-tier session:
 *   - Disables local-preview mode
 *   - /api/session/start returns free tier profile
 *   - Article API returns hasAccess:false (locked content)
 */
export async function mockFreeSession(page: Page) {
  await disableLocalPreview(page);
  await mockSessionStart(page, {
    sub:      'test-free-001',
    name:     'Test Free User',
    email:    'free@example.com',
    picture:  null,
    tier:     'free',
    visitCount: 2,
    firstSeenAt: null,
    lastSeenAt:  null,
    isReturning: true,
    contact:  { canSeePhone: false, phone: null, matchedDomain: null },
    subscription: { active: false, status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false },
  });
  await mockArticleAccess(page, false);
}
