import {defineConfig} from '../../../../apps/web/node_modules/@playwright/test';
export default defineConfig({testDir:__dirname,testMatch:'offline-probes.spec.ts',workers:1,timeout:20000,reporter:'list',outputDir:process.env.AUDIT_BROWSER_OUTPUT||'/tmp/tradecloseout-remaining-browser-output',use:{browserName:'chromium'}});
