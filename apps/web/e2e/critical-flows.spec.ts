import { test, expect } from '@playwright/test';

test.describe('TradeCloseout v0.2.1 Critical User Flows (SCR-002 -> SCR-010 -> SCR-013 -> SCR-025)', () => {

  test('PH1-G27-007: application pages reject framing and proxied API responses cannot be cached', async ({ request }) => {
    const page = await request.get('http://localhost:3002/login');
    expect(page.ok()).toBe(true);
    expect(page.headers()['x-frame-options']).toBe('DENY');
    expect(page.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(page.headers()['cache-control']).toContain('no-store');
    expect(page.headers()['referrer-policy']).toBe('no-referrer');
    expect(page.headers()['x-content-type-options']).toBe('nosniff');

    const api = await request.get('http://localhost:3002/api/v1/health');
    // The health probe may return 503 if the DB is unavailable; its cache
    // and content rules must be enforced independently of availability.
    expect([200, 503]).toContain(api.status());
    expect(api.headers()['cache-control']).toContain('no-store');
    expect(api.headers()['x-content-type-options']).toBe('nosniff');
    expect(api.headers()['referrer-policy']).toBe('no-referrer');

    // A lookalike URL is an application page, not the /api or /_next
    // infrastructure namespace. It must not bypass login or page headers.
    for (const path of ['/api-private', '/icons-private', '/_next-private']) {
      const spoof = await request.get(`http://localhost:3002${path}`, { maxRedirects: 0 });
      expect([307, 308]).toContain(spoof.status());
      expect(spoof.headers().location).toContain('/login');
      expect(spoof.headers()['x-frame-options']).toBe('DENY');
    }
  });

  test('E2E-01: Unauthenticated visitor to / is redirected to /login by middleware', async ({ page }) => {
    await page.goto('http://localhost:3002/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h2')).toContainText('Sign in to your workspace');
  });

  test('E2E-02: PM Meera Deshmukh signs in via OTP, views 3-project portfolio on /dashboard, and opens HYD-BIO-09', async ({
    page,
  }) => {
    await page.goto('http://localhost:3002/login');
    await page.fill('input[type="text"]', 'meera@deccanmep.in');
    await page.click('button[type="submit"]');

    await expect(page.locator('h2')).toContainText('Enter verification code');
    // In development mode, OTP is pre-filled from devOtpPreview
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText('Deccan EnviroTech MEP Pvt Ltd');
    await expect(page.getByText('HYD-BIO-09')).toBeVisible();
    await expect(page.getByText('HYD-IT-04')).toBeVisible();
    await expect(page.getByText('SEC-HOSP-02')).toBeVisible();
  });
});
