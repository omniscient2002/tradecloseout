import { ConflictException, NotFoundException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

describe('PH3-G09-001: typed document quota arithmetic on restricted PostgreSQL', () => {
  it('soft-deletes/restores with BIGINT counters and does not double-account retries', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const seeded = await seedTenants(admin);
      const orgId = seeded.tenants[0].orgId;
      const projectId = seeded.tenants[0].projectIds[0];
      const userId = seeded.userId;
      const documentId = uuidv7();
      const objectId = uuidv7();
      const versionId = uuidv7();
      await admin.query(
        `INSERT INTO storage_objects (
          id, org_id, bucket, object_key, size_bytes, observed_size_bytes,
          mime, sha256, status, provider_version_id
        ) VALUES ($1, $2, 'test-bucket', 'phase3/test.pdf', 1024, 1024,
          'application/pdf', $3, 'READY', 'provider-v1')`,
        [objectId, orgId, 'a'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO documents (id, org_id, project_id, title, doc_type_key,
          category_key, status, created_by)
          VALUES ($1, $2, $3, 'Phase 3 Evidence', 'DT-001', 'TEST', 'ACTIVE', $4)`,
        [documentId, orgId, projectId, userId],
      );
      await admin.query(
        `INSERT INTO document_versions (id, org_id, project_id, document_id,
          version_no, revision_code, object_id, issue_date, file_status, uploaded_by)
          VALUES ($1, $2, $3, $4, 1, 'R0', $5, CURRENT_DATE, 'READY', $6)`,
        [versionId, orgId, projectId, documentId, objectId, userId],
      );
      await admin.query(
        `INSERT INTO usage_counters (id, org_id, metric, period, value)
          VALUES ($1, $2, 'STORAGE_BYTES', 'ALL_TIME', 1024)`,
        [uuidv7(), orgId],
      );
      const ctx: any = { orgId, userId, actorType: 'USER', requestId: 'phase3-quota' };
      const service = new DocumentsService(app as any, {} as any);
      const readCounter = async () => {
        const result = await admin.query(
          `SELECT value FROM usage_counters
            WHERE org_id = $1 AND metric = 'STORAGE_BYTES' AND period = 'ALL_TIME'`,
          [orgId],
        );
        return BigInt(result.rows[0].value);
      };

      expect(await readCounter()).toBe(1024n);
      // The same row locks must refuse destructive edits of a closed project.
      await admin.query(
        `UPDATE projects SET status = 'CLOSED', closed_at = now()
          WHERE org_id = $1 AND id = $2`,
        [orgId, projectId],
      );
      await expect(service.deleteDocument(ctx, documentId)).rejects.toThrow(ConflictException);
      expect(await readCounter()).toBe(1024n);
      await admin.query(
        `UPDATE projects SET status = 'ACTIVE', closed_at = NULL
          WHERE org_id = $1 AND id = $2`,
        [orgId, projectId],
      );
      const deleted = await service.deleteDocument(ctx, documentId);
      expect(deleted.deleted).toBe(true);
      expect(await readCounter()).toBe(0n);
      await expect(service.deleteDocument(ctx, documentId)).rejects.toThrow(NotFoundException);
      expect(await readCounter()).toBe(0n);

      await admin.query(
        `UPDATE projects SET status = 'CLOSED', closed_at = now()
          WHERE org_id = $1 AND id = $2`,
        [orgId, projectId],
      );
      await expect(service.restoreDocument(ctx, documentId)).rejects.toThrow(ConflictException);
      expect(await readCounter()).toBe(0n);
      await admin.query(
        `UPDATE projects SET status = 'ACTIVE', closed_at = NULL
          WHERE org_id = $1 AND id = $2`,
        [orgId, projectId],
      );
      const restored = await service.restoreDocument(ctx, documentId);
      expect(restored.restored).toBe(true);
      expect(await readCounter()).toBe(1024n);
      await expect(service.restoreDocument(ctx, documentId)).rejects.toThrow(NotFoundException);
      expect(await readCounter()).toBe(1024n);
    });
  });
});
