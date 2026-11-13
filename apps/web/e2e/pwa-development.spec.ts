import { test, expect } from '@playwright/test';

test('development retires a previously installed caching worker without deleting unrelated storage', async ({ page, context }) => {
  const origin = 'http://localhost:3002';
  // Emulate the worker installed before development-mode recovery existed.
  await context.route(`${origin}/sw.js`, route => route.fulfill({
    contentType: 'application/javascript',
    headers: { 'Service-Worker-Allowed': '/' },
    body: `self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));`,
  }));
  await page.goto(`${origin}/login`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    await (await caches.open('tc-shell-v021')).put('/_next/static/stale.js', new Response('stale'));
    await (await caches.open('unrelated-app')).put('/unrelated', new Response('keep'));
    localStorage.setItem('pwa-recovery-sentinel', 'keep');
  });
  await context.unroute(`${origin}/sw.js`);
  // Updating the existing script must retrieve the development recovery worker.
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration!.update();
  }).catch(() => { /* recovery navigates this page */ });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('tc-shell-v021')).catch(() => true)).toBe(false);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).includes('unrelated-app'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('pwa-recovery-sentinel'))).toBe('keep');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Send Verification Code' })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
});

test('persona switch displays OTP throttling inline without verifying or producing an error overlay', async ({ page, context }) => {
  await context.addCookies([{ name: 'tc_session', value: 'browser-fixture', url: 'http://localhost:3002' }]);
  let verifyRequests = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/otp/request')) {
      return route.fulfill({ status: 429, contentType: 'application/problem+json', body: JSON.stringify({ status: 429, code: 'RATE_LIMITED', detail: 'Too many OTP requests. Try again later.' }) });
    }
    if (path.endsWith('/auth/otp/verify')) verifyRequests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(path.endsWith('/auth/me') ? { name: 'Meera Deshmukh', orgRole: 'R-PM', activeOrgId: 'fixture-org', userId: 'fixture-user' } : []) });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Quick switch failed')) errors.push(message.text()); });
  await page.goto('http://localhost:3002/parties');
  await page.getByRole('button', { name: /Vikramaditya/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Too many OTP requests' })).toHaveText('Too many OTP requests. Try again later.');
  expect(verifyRequests).toBe(0);
  expect(errors).toEqual([]);
  await expect(page.getByRole('button', { name: /Vikramaditya/ })).toBeEnabled();
});
