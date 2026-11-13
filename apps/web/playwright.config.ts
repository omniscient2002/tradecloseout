import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'pwa-development', testMatch: 'pwa-development.spec.ts', use: { browserName: 'chromium' } },
    { name: 'archive', testMatch: 'archive-verifier.spec.ts', use: { browserName: 'chromium' } },
    // Requires separately running application/API/worker and explicit isolated fixtures.
    { name: 'application', testMatch: 'critical-flows.spec.ts', use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:3002', browserName: 'chromium' } },
  ],
});
