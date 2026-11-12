import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { isImmutableStorageVersion } from '@tradecloseout/shared';
import { assertPdfHasNoActiveActions, sanitizeAndCheckPdfBomb, compileHandoverDossierStreamingQpdf } from '../src/queues/pdf-stream-compiler';

import { compileAndPersistHandoverPackage, markHandoverPackageFailed } from '../src/queues/handover-package.processor';

const exec = promisify(execFile);

test('PH4-G14-004: immutable version identity denies unversioned and malformed provider receipts', () => {
  for (const version of [null, undefined, '', 'null', 'NULL', ' undefined ', 'none',
    'unversioned', 'valid\nversion', ' padded ', 123]) {
    assert.equal(isImmutableStorageVersion(version), false, String(version));
  }
  assert.equal(isImmutableStorageVersion('3HL4kqtJlcpXrof3'), true);
});

test('PH4-G25-001/002: live PDF compiler rejects page-level JavaScript without changing original bytes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'phase4-pdf-'));
  try {
    const clean = path.join(dir, 'clean.pdf');
    const unsafe = path.join(dir, 'unsafe.pdf');
    const output = path.join(dir, 'dossier.pdf');
    const unsafeOutput = path.join(dir, 'sanitized.pdf');
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawText('Inspection');
    await writeFile(clean, await doc.save());
    const bad = await PDFDocument.load(await (await import('node:fs/promises')).readFile(clean));
    const action = bad.context.obj({
      S: PDFName.of('JavaScript'),
      JS: PDFString.of('app.alert("executed")'),
    });
    bad.getPage(0).node.set(PDFName.of('AA'), bad.context.obj({ O: action }));
    await writeFile(unsafe, await bad.save());
    const hasQpdf = await exec('qpdf', ['--version']).then(() => true).catch(() => false);
    await assert.doesNotReject(assertPdfHasNoActiveActions(clean, hasQpdf));
    await assert.rejects(assertPdfHasNoActiveActions(unsafe, hasQpdf), /PDF_ACTIVE_CONTENT_REJECTED/);
    const result = await sanitizeAndCheckPdfBomb(unsafe, unsafeOutput);
    assert.equal(result.safe, false, 'sanitizer must fail closed, not claim stripped scripts');
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const sha = createHash('sha256').update(await readFile(unsafe)).digest('hex');
    await assert.rejects(
      compileHandoverDossierStreamingQpdf({
        packageId: 'phase4-test',
        versionNo: 1,
        orgLegalName: 'Test organisation',
        projectCode: 'P4',
        projectName: 'Fixture',
        clientName: 'Customer',
        contractRef: 'C4',
        snapshotChecksum: 'a'.repeat(64),
        generatedAtIst: '12 Nov 2026',
        requirementsIndex: [],
        sourceFiles: [{
          documentVersionId: 'bad-version',
          sectionKey: 'TEST',
          title: 'Unsafe',
          localPath: unsafe,
          sha256: sha,
        }],
      }, output),
      /PDF_ACTIVE_CONTENT_REJECTED/,
    );
    assert.equal(createHash('sha256').update(await readFile(unsafe)).digest('hex'), sha);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('PH4-G14-003: busy advisory lock cannot be reported as successful build replay', async () => {
  const orgId = randomUUID(), packageId = randomUUID();
  let released = 0, sent = 0;
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        assert.match(sql, /pg_try_advisory_lock/);
        return { rows: [{ acquired: false }] };
      },
      release: () => { released++; },
    }),
  };
  const s3 = { send: async () => { sent++; } };
  await assert.rejects(
    compileAndPersistHandoverPackage(pool as any, s3 as any,
      { orgId, packageId }, 'same-bullmq-job', true, `PACKAGE_ATTEMPT:${randomUUID()}`),
    /PACKAGE_BUILD_ALREADY_RUNNING/,
  );
  assert.equal(released, 1);
  assert.equal(sent, 0);
});

test('PH4-G14-003: a stalled BullMQ delivery cannot publish under the previous attempt identity', async () => {
  const orgId = randomUUID(), packageId = randomUUID(), attempt = `PACKAGE_ATTEMPT:${randomUUID()}`;
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const lockClient = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [{ acquired: true }] };
    },
    release: () => undefined,
  };
  const claimClient = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT hp.id, hp.org_id')) {
        return { rows: [{
          id: packageId, org_id: orgId, project_id: randomUUID(),
          status: 'GENERATING', error_code: 'PACKAGE_JOB:same-bullmq-job',
          package_purpose: 'FULL_HANDOVER', manifest_format_version: 2,
          updated_at: new Date().toISOString(),
        }] };
      }
      if (sql.includes('UPDATE handover_packages')) return { rowCount: 0, rows: [] };
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  let connections = 0;
  const pool = { connect: async () => (++connections === 1 ? lockClient : claimClient) };
  const outcome = await compileAndPersistHandoverPackage(pool as any, {} as any,
    { orgId, packageId }, 'same-bullmq-job', true, attempt);
  assert.equal(outcome.status, 'GENERATING');
  assert(calls.some(({ sql, params }) =>
    sql.includes('UPDATE handover_packages') && params.includes(attempt)));
  assert(calls.some(({ sql }) => sql.includes('pg_advisory_unlock')));
});

test('PH4-G14-003: terminal failure compare-and-set requires the exact attempt owner', async () => {
  const orgId = randomUUID(), packageId = randomUUID(), attempt = `PACKAGE_ATTEMPT:${randomUUID()}`;
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = { connect: async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  }) };
  await markHandoverPackageFailed(pool as any, { orgId, packageId },
    'same-bullmq-job', new Error('simulated failure'), attempt);
  const cas = queries.find(({ sql }) => sql.includes("status = 'FAILED'"));
  assert(cas);
  assert(cas.sql.includes("status = 'GENERATING' AND error_code = $3"));
  assert.equal(cas.params[2], attempt);
  assert(!cas.params.includes('PACKAGE_JOB:same-bullmq-job'));
});

test('PH4-G14-003: malformed terminal owner never mutates a handover package', async () => {
  let acquired = 0;
  const pool = { connect: async () => { acquired++; throw new Error('must not connect'); } };
  await markHandoverPackageFailed(pool as any, {
    orgId: randomUUID(), packageId: randomUUID(),
  }, 'logical-job', new Error('stale'), 'PACKAGE_JOB:logical-job');
  assert.equal(acquired, 0);
});

test('PH4-G14-002: a legacy unpinned manifest cannot be silently rebuilt from current documents', async () => {
  const orgId = randomUUID(), packageId = randomUUID();
  const queries: string[] = [];
  let n = 0;
  const pool: any = { connect: async () => {
    n++;
    return {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes('SELECT hp.id, hp.org_id')) return {
          rows: [{ id: packageId, org_id: orgId, project_id: randomUUID(),
            status: 'QUEUED', manifest_format_version: 1,
            package_purpose: 'FULL_HANDOVER' }],
        };
        return { rows: [] };
      },
      release: () => undefined,
    };
  } };
  await assert.rejects(compileAndPersistHandoverPackage(pool, {} as any,
    { orgId, packageId }, 'logical-job', true, `PACKAGE_ATTEMPT:${randomUUID()}`),
    /PACKAGE_UNPINNED_MANIFEST_REQUIRES_REGENERATION/);
  assert.equal(n, 2, 'must not allocate the upload/publish transaction');
  assert.equal(queries.filter(q => q.includes('UPDATE handover_packages')).length, 0);
  assert(queries.some(q => q.includes('ROLLBACK')));
  assert(queries.some(q => q.includes('pg_advisory_unlock')));
});
