import { test, expect } from '@playwright/test';

test.describe('TradeCloseout v0.2.1 Critical User Flows (SCR-002 -> SCR-010 -> SCR-013 -> SCR-025)', () => {
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

/**
 * Browser/API contract regression, not a substitute for live OTP/provider E2E.
 * Only the API responses are intercepted; the real Next login form and its
 * outgoing HTTP request are exercised.
 */
test.describe('G01 browser authentication contract', () => {
  test('E2E-G01: blocks contractor content until session identity is verified', async ({ page }) => {
    await page.context().addCookies([{
      name:'tc_session', value:'expired-opaque-cookie',
      domain:'localhost',path:'/',httpOnly:true,sameSite:'Lax',
    }]);
    let releaseVerification!: () => void;
    const verificationWait=new Promise<void>(resolve => {releaseVerification=resolve;});
    await page.route('**/api/v1/auth/me',async route=>{
      await verificationWait;
      await route.fulfill({
        status:401,contentType:'application/problem+json',
        body:JSON.stringify({status:401,code:'SESSION_EXPIRED',detail:'Session expired'}),
      });
    });
    await page.goto('http://localhost:3002/dashboard');
    await expect(page.getByRole('status')).toContainText('Verifying your workspace session');
    await expect(page.getByRole('navigation')).toHaveCount(0);
    releaseVerification();
    await expect(page).toHaveURL(/\\/login(?:\\?|$)/);
  });

  test('E2E-G01: forwards the server-issued challenge ID with the human-entered code', async ({ page }) => {
    const challengeId = '01999999-1234-7000-8000-999999999999';
    await page.route('**/api/v1/auth/otp/request', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        identifier: 'test@g01.example',
      });
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ challengeId, channel: 'EMAIL', expiresInSeconds: 300 }),
      });
    });
    await page.route('**/api/v1/auth/otp/verify', async (route) => {
      await route.fulfill({
        status: 401, contentType: 'application/problem+json',
        body: JSON.stringify({ status: 401, code: 'OTP_INVALID', detail: 'Invalid OTP' }),
      });
    });
    await page.goto('http://localhost:3002/login');
    await page.locator('input[type="text"]').first().fill('test@g01.example');
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Enter verification code')).toBeVisible();
    await page.locator('input[maxlength="6"]').fill('482615');
    const verification = page.waitForRequest((request) =>
      request.url().includes('/api/v1/auth/otp/verify') && request.method() === 'POST');
    await page.locator('button[type="submit"]').click();
    const sent = (await verification).postDataJSON();
    expect(sent).toMatchObject({
      challengeId, identifier: 'test@g01.example', code: '482615',
    });
    await expect(page.getByText('Invalid OTP', { exact: true })).toBeVisible();
  });
});
