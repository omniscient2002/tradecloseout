import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'archive', testMatch: ['archive-verifier.spec.ts', 'csv-export.spec.ts', 'offline-queue-phase5.spec.ts', 'chunked-sha256.spec.ts', 'project-requirements.spec.ts', 'format-money.spec.ts', 'api-list.spec.ts', 'project-summary.spec.ts'], use: { browserName: 'chromium' } },
    // Requires separately running application/API/worker and explicit isolated fixtures.
    { name: 'application', testMatch: 'critical-flows.spec.ts', use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:3002', browserName: 'chromium' } },
  ],
});
