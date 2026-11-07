import { test, expect } from '@playwright/test';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { pathToFileURL } from 'url';
import { archiveVerifierHtml } from '../../worker/src/queues/archive-verifier';

for (const variant of ['valid', 'missing', 'changed-file', 'changed-manifest', 'unsafe-title', 'extra-file'] as const) {
  test(`ARC-03/WEB-UX: offline extracted archive ${variant}`, async ({ page, context }) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'archive-browser-'));
    const folder = path.join(root, 'extracted');
    await mkdir(path.join(folder, 'evidence'), { recursive: true });
    const id = '12345678-1234-1234-1234-123456789abc';
    const bytes = Buffer.from('Known evidence bytes');
    const title = variant === 'unsafe-title' ? '<img src=x onerror="window.injected=true">' : 'Test evidence';
    const manifest = { objects: [{ archive_path: `evidence/${id}`, document_title: title,
      size_bytes: String(bytes.length), sha256: createHash('sha256').update(bytes).digest('hex') }] };
    const manifestBytes = JSON.stringify(manifest);
    const digest = createHash('sha256').update(manifestBytes).digest('hex');
    try {
      await writeFile(path.join(folder, 'manifest.json'), variant === 'changed-manifest' ? JSON.stringify({ objects: [] }) : manifestBytes);
      if (variant !== 'missing') await writeFile(path.join(folder, 'evidence', id), variant === 'changed-file' ? Buffer.from('Altered evidence!!') : bytes);
      if (variant === 'extra-file') await writeFile(path.join(folder, 'evidence', 'unlisted'), 'unexpected');
      const html = path.join(root, 'verify.html'); await writeFile(html, archiveVerifierHtml(digest));
      await context.setOffline(true);
      await page.goto(pathToFileURL(html).href);
      await page.getByLabel('Extracted archive folder').setInputFiles(folder);
      const status = page.getByRole('status');
      if (variant === 'valid' || variant === 'unsafe-title') {
        await expect(status).toContainText('Verified 1 evidence files');
        await expect(status).toContainText('Signer authenticity is not checked');
      } else { await expect(status).toContainText('Verification failed:'); }
      if (variant === 'unsafe-title') {
        await expect(page.locator('#results')).toContainText(title);
        await expect(page.locator('#results img')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
