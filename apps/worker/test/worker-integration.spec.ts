import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'crypto';
import { createServer } from 'http';
import { once } from 'events';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Redis from 'ioredis';
import { canonicalJson } from '@tradecloseout/shared';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { scoped, seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { TradeCloseoutScheduler } from '../src/scheduler';
import { compileAndPersistPortableArchive } from '../src/queues/portable-archive.processor';
import { BoundedByteStream } from '../src/queues/bounded-stream';
import { OUTBOX_EVENT_REGISTRY } from '../src/event-registry';
import { storageServer } from './helpers/storage-server';
import { jobFingerprint, reportWorkerFailure, safeWorkerErrorCategory } from '../src/safe-worker-errors';
import { markHandoverPackageFailed } from '../src/queues/handover-package.processor';

const exec = promisify(execFile);

void test('PH1-G27-005: worker diagnostic egress and package failure persistence are secret-free', async t => {
  const secret = 'postgres://admin:super-secret@internal-host/private?token=very-sensitive';
  await t.test('raw errors, stack traces and untrusted job identifiers are never logged', () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    try {
      const databaseError = Object.assign(new Error(secret), { code: '23505' });
      databaseError.stack = `Stacktrace: ${secret}`;
      reportWorkerFailure('OUTBOX_EVENT_DISPATCH_FAILED', databaseError, secret);
      const malicious = {
        message: secret,
        get code(): string { throw new Error(secret); },
      };
      reportWorkerFailure('SCHEDULER_LOCK_RELEASE_FAILED', malicious, secret);
      assert.equal(safeWorkerErrorCategory(databaseError), 'DB_UNIQUE_CONFLICT');
      assert.equal(safeWorkerErrorCategory(malicious), 'UNCLASSIFIED');
      assert.equal(jobFingerprint(secret)?.length, 16);
      assert(!logs.join(' ').includes(secret));
      assert(logs.some(row => row.includes('OUTBOX_EVENT_DISPATCH_FAILED')));
      assert(logs.some(row => row.includes('DB_UNIQUE_CONFLICT')));
      assert(logs.every(row => !row.includes('Stacktrace:')));
      assert(logs.every(row => !row.includes('internal-host')));
    } finally {
      console.error = originalError;
    }
  });

  await t.test('terminal package DB status stores only a fixed, non-sensitive failure detail', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client };
    await markHandoverPackageFailed(
      pool as any, { orgId: randomUUID(), packageId: randomUUID() } as any,
      randomUUID(), new Error(secret),
    );
    const update = queries.find(q => q.sql.includes('UPDATE handover_packages'));
    assert(update, 'the status mutation must have been attempted');
    assert.equal(update.params?.[3],
      'Package generation failed. Review the processing status and retry after resolving the worker issue.');
    assert(!JSON.stringify(queries).includes(secret));
    assert(queries.some(q => q.sql === 'COMMIT'));
  });

  await t.test('database write failure logs a fixed category, not the thrown provider secret', async () => {
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
    const client = {
      query: async (sql: string) => {
        if (sql.includes('UPDATE handover_packages')) throw new Error(secret);
        return { rowCount: 1 };
      },
      release: () => undefined,
    };
    try {
      await markHandoverPackageFailed(
        { connect: async () => client } as any,
        { orgId: randomUUID(), packageId: randomUUID() } as any,
        randomUUID(), new Error(secret),
      );
      assert(logs.some(row => row.includes('PACKAGE_FAILURE_PERSIST_FAILED')));
      assert(!logs.join(' ').includes(secret));
    } finally {
      console.error = originalError;
    }
  });
});

void test('Isolated worker DB/Redis and storage HTTP contract regressions', async t => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a, b] } = await seedTenants(admin);
    const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
    const originalEnv = { S3_BUCKET: process.env.S3_BUCKET, NOTIFICATION_DELIVERY_URL: process.env.NOTIFICATION_DELIVERY_URL,
      NOTIFICATION_DELIVERY_TOKEN: process.env.NOTIFICATION_DELIVERY_TOKEN };
    const scheduler = new TradeCloseoutScheduler(app, redis);
    try {
      await redis.connect();
      await t.test('PH1-G24-002: scoped owner discovery sends exactly one digest per eligible tenant', async () => {
        for (const org of [a, b]) {
          await admin.query(
            "INSERT INTO memberships (id, org_id, user_id, role, status) VALUES ($1,$2,$3,'R-OWNER','ACTIVE')",
            [randomUUID(), org.orgId, userId],
          );
        }
        // With no tenant context the runtime role cannot see any membership.
        assert.equal((await app.query("SELECT id FROM memberships WHERE role='R-OWNER'")).rowCount, 0);

        await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
        const digestRows = await admin.query(
          "SELECT org_id,recipient_user_id,payload_json FROM notifications WHERE event_key='WEEKLY_OWNER_DIGEST' AND org_id IN ($1,$2)",
          [a.orgId, b.orgId],
        );
        assert.equal(digestRows.rowCount, 2, 'both active tenants must receive a scoped digest');
        assert.deepEqual(new Set(digestRows.rows.map(row => row.org_id)), new Set([a.orgId, b.orgId]));
        assert(digestRows.rows.every(row => row.recipient_user_id === userId));
        assert(digestRows.rows.every(row => Array.isArray(row.payload_json.projects)));

        await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
        assert.equal((await admin.query(
          "SELECT id FROM notifications WHERE event_key='WEEKLY_OWNER_DIGEST' AND org_id IN ($1,$2)",
          [a.orgId, b.orgId],
        )).rowCount, 2, 'same period must deduplicate');

        // A third active org with no eligible Owner must raise a visible failure
        // rather than stop valid tenant processing or fabricate a recipient.
        const orphanOrg = randomUUID();
        await admin.query(
          "INSERT INTO organisations (id, legal_name, display_name, state) VALUES ($1,'Orphan tenant','Orphan tenant','MH')",
          [orphanOrg],
        );
        try {
          await assert.rejects(scheduler.runWeeklyOwnerRetentionAtRiskDigest(), /OWNER_DIGEST_INCOMPLETE/);
          assert.equal((await admin.query(
            "SELECT id FROM notifications WHERE event_key='WEEKLY_OWNER_DIGEST' AND org_id=$1",
            [orphanOrg],
          )).rowCount, 0);
        } finally {
          await admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1", [orphanOrg]);
        }
      });
      await t.test('PH1-G27-002: audit genesis and content tampering are detected without leaking event metadata', async () => {
        const eventId = randomUUID();
        await scoped(app, a.orgId, client => client.query(
          `INSERT INTO audit_events (id,org_id,actor_type,action,entity_type,entity_id,request_id)
           VALUES ($1,$2,'SYSTEM','CHAIN_VERIFIER_TEST','PROJECT',$3,'worker-verifier')`,
          [eventId, a.orgId, a.projectIds[0]],
        ));
        const positive = await scheduler.verifyAuditHashChainIntegrity();
        assert(positive.verifiedEvents >= 1);
        const original = (await admin.query(
          'SELECT prev_hash,after_json FROM audit_events WHERE id=$1 AND org_id=$2',
          [eventId, a.orgId],
        )).rows[0];

        // Only the disposable privileged test connection may temporarily
        // disable both legacy and new append-only guards to simulate tampering.
        const tamper = async (sql: string, params: unknown[]) => {
          await admin.query('ALTER TABLE audit_events DISABLE TRIGGER USER');
          try { await admin.query(sql, params); }
          finally { await admin.query('ALTER TABLE audit_events ENABLE TRIGGER USER'); }
        };
        try {
          await tamper('UPDATE audit_events SET prev_hash=$1 WHERE id=$2 AND org_id=$3', [
            'FORGED_GENESIS', eventId, a.orgId,
          ]);
          await assert.rejects(
            scheduler.verifyAuditHashChainIntegrity(),
            error => error instanceof Error && error.message === 'AUDIT_HASH_CHAIN_CORRUPT',
          );
          await tamper('UPDATE audit_events SET prev_hash=$1, after_json=$2 WHERE id=$3 AND org_id=$4', [
            original.prev_hash, JSON.stringify({ forged: true }), eventId, a.orgId,
          ]);
          await assert.rejects(
            scheduler.verifyAuditHashChainIntegrity(),
            error => error instanceof Error && error.message === 'AUDIT_CONTENT_TAMPERED',
          );
        } finally {
          await tamper('UPDATE audit_events SET prev_hash=$1, after_json=$2 WHERE id=$3 AND org_id=$4', [
            original.prev_hash, original.after_json, eventId, a.orgId,
          ]);
        }
        const restored = await scheduler.verifyAuditHashChainIntegrity();
        assert(restored.verifiedEvents >= 1);
      });
      await t.test('SCHED-01/02: real Redis NX excludes concurrent owner and old owner cannot delete replacement lock', async () => {
        const name = randomUUID();
        let enter!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        let release!: () => void;
        const barrier = new Promise<void>(resolve => { release = resolve; });
        let executions = 0;
        const first = scheduler.runWithLeaderLock(name, 30, async () => { executions++; enter(); await barrier; });
        await entered;
        await scheduler.runWithLeaderLock(name, 30, async () => { executions++; });
        await redis.set(`lock:sched:${name}`, 'replacement-owner', 'EX', 30);
        release(); await first;
        assert.equal(executions, 1);
        assert.equal(await redis.get(`lock:sched:${name}`), 'replacement-owner');
        await redis.del(`lock:sched:${name}`);
      });
      await t.test('SCHED-03/04: successful period runs once; failed period retries; India year boundary', async () => {
        const name = randomUUID(); const done = `test:done:${name}`;
        let effects = 0;
        const run = () => scheduler.runWithPeriodLock(name, done, 30, 30, async () => { effects++; });
        await run(); await run(); assert.equal(effects, 1); await redis.del(done);
        await assert.rejects(scheduler.runWithPeriodLock(name, done, 30, 30, async () => { throw new Error('injected failure'); }), /injected/);
        assert.equal(await redis.exists(done), 0);
        await run(); assert.equal(effects, 2); await redis.del(done);
        // A delayed worker must not claim successful completion if the lease
        // expired or another process acquired it while its callback ran.
        const lostKey = randomUUID();
        const lostDone = `test:done:${lostKey}`;
        await assert.rejects(
          scheduler.runWithPeriodLock(lostKey, lostDone, 30, 30, async () => {
            await redis.set(`lock:sched:${lostKey}`, 'replacement-owner', 'EX', 30);
          }),
          /SCHEDULER_LEASE_LOST/,
        );
        assert.equal(await redis.exists(lostDone), 0);
        assert.equal(await redis.get(`lock:sched:${lostKey}`), 'replacement-owner');
        await redis.del(`lock:sched:${lostKey}`);
        const period = scheduler.getIndiaSchedulePeriods(new Date('2027-01-03T18:30:00Z'));
        assert.equal(period.day, '2027-01-04'); assert.equal(period.hour, 0); assert.equal(period.week, '2027-W01');
      });
      await t.test('TX-05/06: cleanup retains expired unresolved claims after committed effect', async () => {
        const pending = randomUUID(); const completed = randomUUID();
        await admin.query(`INSERT INTO idempotency_keys (id,org_id,key,endpoint,request_hash,response_status,response_json,expires_at,created_at)
          VALUES ($1::uuid,$3,$1::text,'test','hash',0,'{}',now()-interval '1 day',now()-interval '2 days'),
                 ($2::uuid,$3,$2::text,'test','hash',200,'{}',now()-interval '1 day',now()-interval '2 days')`, [pending, completed, a.orgId]);
        await admin.query(`UPDATE projects SET name = 'Committed effect' WHERE id = $1`, [a.projectIds[0]]);
        assert.equal(await scheduler.reconcileIdempotencyClaims(), 1);
        assert.equal((await admin.query('SELECT id FROM idempotency_keys WHERE id = $1', [pending])).rowCount, 1);
        assert.equal((await admin.query('SELECT id FROM idempotency_keys WHERE id = $1', [completed])).rowCount, 0);
        // Replay the actual interceptor in API tests; here prove cleanup preserves its durable protection.
      });
      await t.test('NOTIF-01/04: no configuration, rejection and invalid ack stay queued; matching capture acknowledgment permits SENT', async () => {
        const id = randomUUID(); const foreignId = randomUUID();
        await admin.query(`INSERT INTO notifications (id, org_id, recipient_user_id, channel, event_key, payload_json, status, dedup_key)
          VALUES ($1::uuid,$2,$3,'EMAIL','TEST','{"message":"local test"}','QUEUED',$1::text),
                 ($4::uuid,$5,$3,'EMAIL','TEST','{}','QUEUED',$4::text)`, [id, a.orgId, userId, foreignId, b.orgId]);
        delete process.env.NOTIFICATION_DELIVERY_URL; delete process.env.NOTIFICATION_DELIVERY_TOKEN;
        assert.equal(await scheduler.dispatchQueuedNotifications(), 0);
        let mode = 'reject'; const requests: any[] = [];
        const gateway = createServer(async (req, res) => {
          let body = ''; for await (const chunk of req) body += chunk;
          const payload = JSON.parse(body); requests.push({ payload, key: req.headers['idempotency-key'] });
          if (mode === 'reject' || payload.id !== id) { res.writeHead(503); res.end(); return; }
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ accepted: true, notificationId: mode === 'bad-ack' ? randomUUID() : payload.id }));
        });
        gateway.listen(0, '127.0.0.1'); await once(gateway, 'listening');
        process.env.NOTIFICATION_DELIVERY_URL = `http://127.0.0.1:${(gateway.address() as any).port}`;
        process.env.NOTIFICATION_DELIVERY_TOKEN = 'local-capture-token';
        try {
          assert.equal(await scheduler.dispatchQueuedNotifications(), 0);
          mode = 'bad-ack'; assert.equal(await scheduler.dispatchQueuedNotifications(), 0);
          mode = 'accept'; assert.equal(await scheduler.dispatchQueuedNotifications(), 1);
          const own = (await admin.query('SELECT status, sent_at FROM notifications WHERE id = $1', [id])).rows[0];
          assert.equal(own.status, 'SENT'); assert(own.sent_at instanceof Date);
          assert.equal((await admin.query('SELECT status FROM notifications WHERE id = $1', [foreignId])).rows[0].status, 'QUEUED');
          assert(requests.some(request => request.key === id && request.payload.org_id === a.orgId && request.payload.recipient_user_id === userId));
        } finally { gateway.closeAllConnections(); await new Promise<void>(resolve => gateway.close(() => resolve())); }
      });
      const storage = await storageServer();
      try {
        process.env.S3_BUCKET = 'test-archive-bucket';
        const bytes = Buffer.from('%PDF-1.4 known original evidence bytes');
        const versionId = randomUUID();
        storage.objects.set('source.pdf:original', bytes);
        storage.objects.set('source.pdf:latest', Buffer.from('wrong newer bytes'));
        async function fixture(overrides: Record<string, unknown> = {}) {
          const exportId = randomUUID();
          const object = { version_id: versionId, archive_path: `evidence/${versionId}`, document_title: '<img src=x onerror=alert(1)>',
            bucket: 'source-bucket', object_key: 'source.pdf', provider_version_id: 'original', size_bytes: String(bytes.length),
            sha256: createHash('sha256').update(bytes).digest('hex'), ...overrides };
          const manifest = { export_id: exportId, project: { id: a.projectIds[0] },
            summary: { total_documents: 1, total_bytes: String(bytes.length) }, objects: [object] };
          const receipt = { manifest_sha256: createHash('sha256').update(canonicalJson(manifest)).digest('hex') };
          await admin.query(`INSERT INTO archive_exports (id,org_id,project_id,status,total_objects,total_bytes,manifest_json,verification_receipt_json)
            VALUES ($1,$2,$3,'PENDING',1,$4,$5,$6)`, [exportId, a.orgId, a.projectIds[0], bytes.length, JSON.stringify(manifest), JSON.stringify(receipt)]);
          return { exportId, orgId: a.orgId, projectId: a.projectIds[0] };
        }
        await t.test('ARC-02: ZIP contains exact pinned bytes; durable readback and replay are verified independently', async () => {
          const job = await fixture(); const result = await compileAndPersistPortableArchive(app, storage.s3, job);
          assert.equal(result.status, 'COMPLETED');
          const output = storage.uploads.at(-1)!;
          assert.equal(createHash('sha256').update(output.bytes).digest('hex'), result.archiveSha256);
          const temp = await mkdtemp(path.join(os.tmpdir(), 'archive-test-'));
          try {
            const zip = path.join(temp, 'archive.zip'); await writeFile(zip, output.bytes);
            const listing = (await exec('unzip', ['-Z1', zip])).stdout.trim().split('\n').filter(name => !name.endsWith('/'));
            assert.deepEqual(new Set(listing), new Set(['manifest.json', 'verification_receipt.json', 'verify.html', `evidence/${versionId}`]));
            const extracted = await exec('unzip', ['-p', zip, `evidence/${versionId}`], { encoding: 'buffer' });
            assert.deepEqual(extracted.stdout, bytes);
          } finally { await rm(temp, { recursive: true, force: true }); }
          assert(storage.requests.some(request => request.key === 'source.pdf' && request.version === 'original'));
          const before = storage.uploads.length; await compileAndPersistPortableArchive(app, storage.s3, job);
          assert.equal(storage.uploads.length, before);
        });
        for (const [label, override, error] of [
          ['missing source', { object_key: 'missing.pdf' }, /Unknown|NoSuch|404/],
          ['wrong digest', { sha256: '0'.repeat(64) }, /DIGEST_MISMATCH/],
          ['unversioned source', { provider_version_id: null }, /SOURCE_IDENTITY/],
          ['unsafe path', { archive_path: '../escape' }, /SOURCE_IDENTITY/],
        ] as const) await t.test(`ARC-03/04: ${label} prevents completion`, async () => {
          const job = await fixture(override); await assert.rejects(compileAndPersistPortableArchive(app, storage.s3, job), error);
          assert.notEqual((await admin.query('SELECT status FROM archive_exports WHERE id = $1', [job.exportId])).rows[0].status, 'COMPLETED');
        });
        await t.test('PKG-05: failed output upload and missing storage configuration cannot complete', async () => {
          storage.wrongVersion(true);
          await assert.rejects(compileAndPersistPortableArchive(app, storage.s3, await fixture()), /OBJECT_VERSION_MISMATCH/);
          storage.wrongVersion(false);
          const job = await fixture(); storage.rejectUploads(true);
          await assert.rejects(compileAndPersistPortableArchive(app, storage.s3, job)); storage.rejectUploads(false);
          assert.equal((await admin.query('SELECT status FROM archive_exports WHERE id = $1', [job.exportId])).rows[0].status, 'FAILED');
          delete process.env.S3_BUCKET;
          await assert.rejects(compileAndPersistPortableArchive(app, storage.s3, await fixture()), /STORAGE_UNAVAILABLE/);
        });

        await t.test('N19 / V09: BoundedByteStream validates ceilings and aborts transfer when exceeded', async () => {
          // V09: Rejects non-finite/NaN/negative/zero ceilings
          assert.throws(() => new BoundedByteStream(NaN), /INVALID_BYTE_CEILING/);
          assert.throws(() => new BoundedByteStream(-5), /INVALID_BYTE_CEILING/);
          assert.throws(() => new BoundedByteStream(0), /INVALID_BYTE_CEILING/);
          assert.throws(() => new BoundedByteStream(Infinity), /INVALID_BYTE_CEILING/);

          const stream = new BoundedByteStream(1024); // 1KB limit
          const { Readable, Writable } = await import('stream');
          const { pipeline } = await import('stream/promises');
          const oversizedChunk = Buffer.alloc(2048);
          const source = Readable.from([oversizedChunk]);
          const sink = new Writable({ write(_chunk, _enc, cb) { cb(); } });
          await assert.rejects(
            pipeline(source, stream, sink),
            /STREAM_SIZE_LIMIT_EXCEEDED/,
          );
        });

        await t.test('N18 / V02: OUTBOX_EVENT_REGISTRY covers 100% of application-emitted event types', async () => {
          // Executable events
          assert.equal(OUTBOX_EVENT_REGISTRY['FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN']?.category, 'EXECUTABLE');
          assert.equal(OUTBOX_EVENT_REGISTRY['HANDOVER_PACKAGE_QUEUED']?.category, 'EXECUTABLE');
          assert.equal(OUTBOX_EVENT_REGISTRY['PROJECT_ARCHIVE_EXPORT_QUEUED']?.category, 'EXECUTABLE');

          // V02 specific omitted types now fully registered
          const requiredEmittedTypes = [
            'PROJECT_CREATED',
            'PROJECT_ACTIVATED',
            'PROJECT_CLOSED',
            'PROJECT_REOPENED',
            'PROJECT_HANDOVER_INITIATED',
            'PROJECT_ARCHIVE_MANIFEST_CREATED',
            'ASSET_IDENTITY_REVISED',
            'DEFECT_RAISED',
            'DEFECT_CLOSED',
            'SUBMISSION_DISPATCHED',
            'WARRANTY_EVENT_RECORDED',
            'GST_INVOICE_ISSUED',
            'INVOICE_TDS_RECORDED',
            'INVOICE_TDS_FORM16A_RECONCILED',
            'CHECKLIST_SNAPSHOT_CREATED',
            'SUPPLIER_UPLOAD_LINK_CREATED',
            'ORG_PROFILE_UPDATED',
            'ORG_OWNERSHIP_TRANSFERRED',
            'DOCUMENT_SUBMITTED_FOR_REVIEW',
            'WAIVER_INITIATED_PENDING_COUNTERSIGN',
            'MANDATORY_WAIVER_APPROVED',
            'EXTERNAL_APPROVAL_RECORDED',
          ];

          for (const evType of requiredEmittedTypes) {
            assert.ok(OUTBOX_EVENT_REGISTRY[evType], `Event type ${evType} must be registered in OUTBOX_EVENT_REGISTRY`);
            assert.equal(OUTBOX_EVENT_REGISTRY[evType]?.category, 'INFORMATIONAL');
          }

          assert.equal(OUTBOX_EVENT_REGISTRY['UNKNOWN_EVENT'], undefined);
        });
      } finally { await storage.close(); }
    } finally {
      redis.disconnect();
      for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
