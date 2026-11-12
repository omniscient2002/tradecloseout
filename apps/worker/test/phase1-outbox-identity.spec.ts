import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTenantTransaction, buildTrustedOutboxPayload } from '@tradecloseout/db';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants, scoped } from '../../../packages/db/test/helpers/fixtures';
import { authorizeOutboxDispatch } from '../src/outbox-identity';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

function packageRow(orgId: string, projectId: string, packageId: string, actorId = 'actor-a') {
  const eventId = randomUUID();
  return {
    id: eventId, org_id: orgId, project_id: projectId,
    event_type: 'HANDOVER_PACKAGE_QUEUED',
    payload_json: buildTrustedOutboxPayload({
      eventId,
      eventType: 'HANDOVER_PACKAGE_QUEUED',
      orgId, projectId,
      entityType: 'HANDOVER_PACKAGE', entityId: packageId,
      actorUserId: actorId, requestId: 'request-a',
    }, { packageId, status: 'QUEUED' }),
  };
}

test('PH1-G27-004: rejects forged V1 and legacy event row fields before querying resources', async () => {
  const original = packageRow('org-a', 'project-a', 'package-a');
  let queries = 0;
  const client = { query: async () => { queries++; return { rowCount: 1 }; } };
  for (const tampered of [
    { ...original, payload_json: { ...(original.payload_json as object), eventId: 'foreign-event' } },
    { ...original, payload_json: { ...(original.payload_json as object), orgId: 'foreign-org' } },
    { ...original, payload_json: { ...(original.payload_json as object), projectId: 'foreign-project' } },
    { ...original, payload_json: { ...(original.payload_json as object), schemaVersion: 99 } },
    { ...original, payload_json: { ...(original.payload_json as object), data: { orgId: 'foreign-org' } } },
  ]) {
    await assert.rejects(authorizeOutboxDispatch(client as any, tampered), /OUTBOX_/);
  }
  assert.equal(queries, 0, 'invalid event never reaches a resource query or queue admission');
});

test('PH1-G27-004: file, package, and archive executor all prove resource scope', async () => {
  const orgId = randomUUID(), projectId = randomUUID();
  const packId = randomUUID();
  const standard = packageRow(orgId, projectId, packId);
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const mock = {
    query: async (text: string, values: unknown[]) => {
      sql.push({ text, values });
      return { rowCount: 1 };
    },
  };
  const pack = await authorizeOutboxDispatch(mock as any, standard);
  assert.equal(pack.packageId, packId);
  assert(sql[0].text.includes('handover_packages'));
  assert.deepEqual(sql[0].values, [orgId, projectId, packId]);

  const archiveId = randomUUID(), eventId = randomUUID();
  const archiveRow = {
    id: eventId, org_id: orgId, project_id: projectId,
    event_type: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
    payload_json: buildTrustedOutboxPayload({
      eventId, eventType: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
      orgId, projectId, entityType: 'PROJECT_ARCHIVE', entityId: archiveId,
      actorUserId: 'actor', requestId: 'request',
    }, { exportId: archiveId }),
  };
  const archive = await authorizeOutboxDispatch(mock as any, archiveRow);
  assert.equal(archive.exportId, archiveId);
  assert(sql[1].text.includes('archive_exports'));
  assert.deepEqual(sql[1].values, [orgId, projectId, archiveId]);

  const versionId = randomUUID(), storageId = randomUUID(), scanId = randomUUID();
  const scanRow = {
    id: scanId, org_id: orgId, project_id: projectId,
    event_type: 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN',
    payload_json: buildTrustedOutboxPayload({
      eventId: scanId, eventType: 'FILE_UPLOAD_COMPLETED_ENQUEUE_SCAN',
      orgId, projectId, entityType: 'DOCUMENT_VERSION', entityId: versionId,
      actorUserId: 'actor', requestId: 'request',
    }, {
      versionId, storageObjectId: storageId,
      bucket: 'bucket-a', objectKey: 'immutable-object', providerVersionId: 'immutable-v1',
    }),
  };
  const scan = await authorizeOutboxDispatch(mock as any, scanRow);
  assert.equal(scan.versionId, versionId);
  assert(sql[2].text.includes('document_versions'));
  assert(sql[2].text.includes('storage_objects'));
  assert.deepEqual(sql[2].values, [
    orgId, projectId, versionId, storageId, 'bucket-a', 'immutable-object', 'immutable-v1',
  ]);
  await assert.rejects(authorizeOutboxDispatch({
    query: async () => ({ rowCount: 0 }),
  } as any, scanRow), /OUTBOX_RESOURCE_SCOPE_MISMATCH/);
  const invalidVersion = {
    ...scanRow,
    payload_json: { ...(scanRow.payload_json as object), data: {
      versionId: randomUUID(), storageObjectId: storageId,
      bucket: 'bucket-a', objectKey: 'immutable-object', providerVersionId: 'immutable-v1',
    } },
  };
  await assert.rejects(authorizeOutboxDispatch(mock as any, invalidVersion),
    /OUTBOX_RESOURCE_IDENTITY_MISMATCH/);
});

test('PH1-G27-004: migrated PG16 retains actor/event/request and disallows cross-project and tenant dispatch', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a, b] } = await seedTenants(admin);
    const packageId = randomUUID();
    await admin.query(
      "INSERT INTO handover_packages(id,org_id,project_id,status,version_no,snapshot_checksum) VALUES($1,$2,$3,'QUEUED',1,$4)",
      [packageId, a.orgId, a.projectIds[0], 'a'.repeat(64)],
    );
    const archiveId = randomUUID();
    await admin.query(
      "INSERT INTO archive_exports(id,org_id,project_id,status) VALUES($1,$2,$3,'PENDING')",
      [archiveId, a.orgId, a.projectIds[0]],
    );
    const requestId = 'G27-004-real-postgres-provenance';
    await withTenantTransaction(app, {
      orgId: a.orgId, userId, actorType: 'SYSTEM',
      ip: '127.0.0.1', userAgent: 'test-runner', requestId,
    }, async (_client, emit) => {
      emit({
        eventType: 'HANDOVER_PACKAGE_QUEUED',
        projectId: a.projectIds[0], entityType: 'HANDOVER_PACKAGE',
        entityId: packageId, afterJson: { packageId, status: 'QUEUED' },
      });
      return undefined;
    });

    await scoped(app, a.orgId, async client => {
      const { rows } = await client.query(
        'SELECT id,org_id,project_id,event_type,payload_json FROM outbox_events WHERE event_type=$1',
        ['HANDOVER_PACKAGE_QUEUED'],
      );
      assert.equal(rows.length, 1);
      const stored = rows[0];
      const actual = await authorizeOutboxDispatch(client, stored);
      assert.equal(actual.schemaVersion, 1);
      assert.equal(actual.eventId, stored.id);
      assert.equal(actual.eventType, 'HANDOVER_PACKAGE_QUEUED');
      assert.equal(actual.orgId, a.orgId);
      assert.equal(actual.projectId, a.projectIds[0]);
      assert.equal(actual.actorUserId, userId);
      assert.equal(actual.requestId, requestId);
      assert.equal(actual.packageId, packageId);

      // This is the same payload admitted to BullMQ by the production
      // dispatcher. Verify real Redis stores trusted provenance unchanged.
      const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: null,
      });
      const queue = new Queue(`g27-identity-${randomUUID()}`, { connection });
      try {
        const enqueued = await queue.add('compile', actual, {
          jobId: `trusted-${stored.id}`,
        });
        const received = await queue.getJob(enqueued.id!);
        assert(received);
        assert.equal(received.data.orgId, a.orgId);
        assert.equal(received.data.projectId, a.projectIds[0]);
        assert.equal(received.data.eventId, stored.id);
        assert.equal(received.data.entityId, packageId);
        assert.equal(received.data.actorUserId, userId);
        assert.equal(received.data.requestId, requestId);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }

      const audit = await client.query(
        'SELECT actor_user_id,request_id,entity_id,action FROM audit_events WHERE action=$1 AND request_id=$2',
        ['HANDOVER_PACKAGE_QUEUED', requestId],
      );
      assert.equal(audit.rowCount, 1);
      assert.deepEqual(
        [audit.rows[0].actor_user_id, audit.rows[0].request_id,
          audit.rows[0].entity_id, audit.rows[0].action],
        [userId, requestId, packageId, 'HANDOVER_PACKAGE_QUEUED'],
      );

      // The same DB-scoped executor checks archive identities, not just
      // package identities. Cross-project and cross-tenant attempts cannot
      // pass the SELECT before any queue admission.
      const archiveEventId = randomUUID();
      const archiveEvent = {
        id: archiveEventId, org_id: a.orgId, project_id: a.projectIds[0],
        event_type: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
        payload_json: buildTrustedOutboxPayload({
          eventId: archiveEventId, eventType: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
          orgId: a.orgId, projectId: a.projectIds[0],
          entityType: 'PROJECT_ARCHIVE', entityId: archiveId,
          actorUserId: userId, requestId,
        }, { exportId: archiveId }),
      };
      const archivePayload = await authorizeOutboxDispatch(client, archiveEvent);
      assert.equal(archivePayload.exportId, archiveId);
      await assert.rejects(authorizeOutboxDispatch(client, {
        ...archiveEvent,
        project_id: a.projectIds[1],
        payload_json: buildTrustedOutboxPayload({
          eventId: archiveEventId, eventType: 'PROJECT_ARCHIVE_EXPORT_QUEUED',
          orgId: a.orgId, projectId: a.projectIds[1],
          entityType: 'PROJECT_ARCHIVE', entityId: archiveId,
          actorUserId: userId, requestId,
        }, { exportId: archiveId }),
      }), /OUTBOX_RESOURCE_SCOPE_MISMATCH/);

      const fakeProject = packageRow(a.orgId, a.projectIds[1], packageId, userId);
      await assert.rejects(authorizeOutboxDispatch(client, fakeProject),
        /OUTBOX_RESOURCE_SCOPE_MISMATCH/);
    });

    await scoped(app, b.orgId, async client => {
      const fakeOrg = packageRow(b.orgId, b.projectIds[0], packageId, userId);
      await assert.rejects(authorizeOutboxDispatch(client, fakeOrg),
        /OUTBOX_RESOURCE_SCOPE_MISMATCH/);
      assert.equal((await client.query('SELECT id FROM handover_packages WHERE id=$1', [packageId])).rowCount, 0);
    });
  });
});
