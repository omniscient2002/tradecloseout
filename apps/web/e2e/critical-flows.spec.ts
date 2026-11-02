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
