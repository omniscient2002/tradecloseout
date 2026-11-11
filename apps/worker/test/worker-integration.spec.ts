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
import { assertWorkerRuntimeDatabasePrivileges } from '../src/worker-startup-security';
import { compileAndPersistPortableArchive } from '../src/queues/portable-archive.processor';
import { BoundedByteStream } from '../src/queues/bounded-stream';
import { OUTBOX_EVENT_REGISTRY } from '../src/event-registry';
import { storageServer } from './helpers/storage-server';

const exec = promisify(execFile);
void test('Isolated worker DB/Redis and storage HTTP contract regressions', async t => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a, b] } = await seedTenants(admin);
    const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 1, lazyConnect: true });
    const originalEnv = { S3_BUCKET: process.env.S3_BUCKET, NOTIFICATION_DELIVERY_URL: process.env.NOTIFICATION_DELIVERY_URL,
      NOTIFICATION_DELIVERY_TOKEN: process.env.NOTIFICATION_DELIVERY_TOKEN };
    const scheduler = new TradeCloseoutScheduler(app, redis);
    try {
      // Verify the actual connection identity under the restricted DB role,
      // not only a mocked pg_roles response.
      await assert.doesNotReject(assertWorkerRuntimeDatabasePrivileges(app));
      await assert.rejects(assertWorkerRuntimeDatabasePrivileges(admin),
        /BOOT_WORKER_RUNTIME_ROLE_UNSAFE/);
      await redis.connect();
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
        // Simulate a replacement worker taking over after TTL/lost ownership:
        // the old callback cannot record a fraudulent completion marker.
        const takeover = `period-takeover:${randomUUID()}`;
        const takeoverDone = `test:done:${takeover}`;
        await assert.rejects(scheduler.runWithPeriodLock(takeover,takeoverDone,30,30,async()=>{
          await redis.set(`lock:sched:${takeover}`,'replacement-worker','EX',30);
        }), /SCHEDULER_LEASE_LOST/);
        assert.equal(await redis.exists(takeoverDone),0);
        assert.equal(await redis.get(`lock:sched:${takeover}`),'replacement-worker');
        await redis.del(`lock:sched:${takeover}`);
        const period = scheduler.getIndiaSchedulePeriods(new Date('2027-01-03T18:30:00Z'));
        assert.equal(period.day, '2027-01-04'); assert.equal(period.hour, 0); assert.equal(period.week, '2027-W01');
      });
      await t.test('PH1-G24-002: tenant-scoped active owner digests are delivered once and missing owners fail visibly', async () => {
        for (const orgId of [a.orgId,b.orgId]) {
          await admin.query(`INSERT INTO memberships
             (id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
            [randomUUID(),orgId,userId]);
        }
        // The restricted application role cannot scan all memberships
        // without a tenant context: prove that discovery alone is insufficient.
        assert.equal((await app.query(
          `SELECT org_id FROM memberships WHERE role='R-OWNER' AND status='ACTIVE'`
        )).rows.length,0);
        await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
        const delivered = await admin.query(`SELECT org_id,recipient_user_id
          FROM notifications WHERE event_key='WEEKLY_OWNER_DIGEST' ORDER BY org_id`);
        assert.equal(delivered.rows.length,2);
        assert.deepEqual(new Set(delivered.rows.map(row=>row.org_id)),new Set([a.orgId,b.orgId]));
        assert(delivered.rows.every(row=>row.recipient_user_id===userId));
        await scheduler.runWeeklyOwnerRetentionAtRiskDigest();
        assert.equal((await admin.query(`SELECT count(*)::int n FROM notifications
          WHERE event_key='WEEKLY_OWNER_DIGEST'`)).rows[0].n,2);
        await admin.query(`UPDATE memberships SET status='REMOVED'
          WHERE org_id=$1 AND user_id=$2`,[b.orgId,userId]);
        await assert.rejects(scheduler.runWeeklyOwnerRetentionAtRiskDigest(), /OWNER_DIGEST_INCOMPLETE/);
      });
      await t.test('PH1-G27-002: verifier includes genesis and verifies real tenant chains', async () => {
        for(const tenant of [a,b]) {
          await scoped(app,tenant.orgId,client=>client.query(`INSERT INTO audit_events
            (id,org_id,actor_type,action,entity_type,entity_id,request_id)
            VALUES($1,$2,'SYSTEM','WORKER_VERIFIER_PROBE','PROJECT',$3,'worker-audit-test')`,
            [randomUUID(),tenant.orgId,tenant.projectIds[0]]));
        }
        const verified=await scheduler.verifyAuditHashChainIntegrity();
        assert.equal(verified.orgCount,2);
        assert.equal(verified.verifiedEvents,2);
        // Independent negative contract: do not alter an actual audit trail.
        const mockClient={
          query:async(sql:string)=>{
            if(sql.includes('SELECT id FROM organisations'))return {rows:[{id:a.orgId}]};
            if(sql.includes('FROM audit_events'))return {rows:[{
              id:randomUUID(),chain_seq:'1',prev_hash:'FORGED_GENESIS',
              hash:'a'.repeat(64),computed_hash:'a'.repeat(64),
            }]};
            return {rows:[]};
          },release:()=>{},
        };
        const corrupted=new TradeCloseoutScheduler({connect:async()=>mockClient} as any,redis);
        await assert.rejects(corrupted.verifyAuditHashChainIntegrity(),/AUDIT_HASH_CHAIN_CORRUPT/);
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
      await t.test('G01-020: abandoned unconfirmed invitations never become redeemable',async()=>{
        const stale=randomUUID(),expired=randomUUID(),fresh=randomUUID(),other=randomUUID();
        await admin.query(
          `INSERT INTO invitations
             (id,org_id,email,role,token_hash,status,expires_at,invited_by,created_at)
           VALUES
             ($1,$5,'stale@g01.test','R-SITE',$8,'DELIVERY_PENDING',now()+interval '2 days',$7,now()-interval '30 minutes'),
             ($2,$5,'expired@g01.test','R-SITE',$9,'PENDING',now()-interval '1 day',$7,now()-interval '2 days'),
             ($3,$5,'fresh@g01.test','R-SITE',$10,'DELIVERY_PENDING',now()+interval '1 day',$7,now()),
             ($4,$6,'other@g01.test','R-SITE',$11,'PENDING',now()+interval '1 day',$7,now())`,
          [stale,expired,fresh,other,a.orgId,b.orgId,userId,
            'stale_'+stale,'expired_'+expired,'fresh_'+fresh,'other_'+other],
        );
        const first=await scheduler.cleanupStaleInvitations();
        assert.equal(first.staleDelivery,1);
        assert.equal(first.expired,1);
        const {rows}=await admin.query(
          'SELECT id,status FROM invitations WHERE id=ANY($1::uuid[])',
          [[stale,expired,fresh,other]],
        );
        const status=(id:string)=>rows.find(row=>row.id===id)?.status;
        assert.equal(status(stale),'REVOKED');
        assert.equal(status(expired),'EXPIRED');
        assert.equal(status(fresh),'DELIVERY_PENDING');
        assert.equal(status(other),'PENDING');
        const second=await scheduler.cleanupStaleInvitations();
        assert.equal(second.staleDelivery,0);
        assert.equal(second.expired,0);
      });
      await t.test('NOTIF-01/04: no configuration, rejection and invalid ack stay queued; matching capture acknowledgment permits SENT', async () => {
        const id = randomUUID(); const foreignId = randomUUID();
        await admin.query(`INSERT INTO notifications (id, org_id, recipient_user_id, channel, event_key, payload_json, status, dedup_key)
          VALUES ($1::uuid,$2,$3,'EMAIL','TEST','{"message":"local test"}','QUEUED',$1::text),
                 ($4::uuid,$5,$3,'EMAIL','TEST','{}','QUEUED',$4::text)`, [id, a.orgId, userId, foreignId, b.orgId]);
        delete process.env.NOTIFICATION_DELIVERY_URL; delete process.env.NOTIFICATION_DELIVERY_TOKEN;
        assert.equal(await scheduler.dispatchQueuedNotifications(), 0);
        assert.equal((await admin.query('SELECT delivery_attempts FROM notifications WHERE id=$1',[id])).rows[0].delivery_attempts,0);
        // Explicitly advance the disposable fixture's retry clock, not the
        // production policy: failures now have durable exponential backoff.
        const due=()=>admin.query(`UPDATE notifications
          SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[id]);
        await due();
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
          await due();
          mode = 'bad-ack'; assert.equal(await scheduler.dispatchQueuedNotifications(), 0);
          await due();
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
