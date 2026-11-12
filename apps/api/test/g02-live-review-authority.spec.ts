import { randomUUID } from 'crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { scoped, seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import {
  resolveLiveReviewAuthority,
  assertReviewDocumentScope,
} from '../src/modules/reviews/review-live-authority';

jest.setTimeout(90000);

describe('G02 live review decision authority — restricted PostgreSQL 16', () => {
  it('rechecks current account, membership, project lifecycle, and restrictive scope inside the decision transaction', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const projectId = a.projectIds[0];
      const documentId = randomUUID();
      await admin.query(
        "INSERT INTO memberships (id,org_id,user_id,role,status) VALUES ($1,$2,$3,'R-QC','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      await admin.query(
        "INSERT INTO project_members (id,org_id,project_id,user_id,role,status,added_by,scope_json) VALUES ($1,$2,$3,$4,'R-REVIEWER','ACTIVE',$4,$5::jsonb)",
        [randomUUID(), a.orgId, projectId, userId, JSON.stringify({ documentIds: [documentId] })],
      );
      const ctx = { orgId: a.orgId, userId, actorType: 'USER' as const, requestId: 'review-authority-test', orgRole: 'R-OWNER' };
      const authorized = () => scoped(app, a.orgId, async client => {
        await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
        const authority = await resolveLiveReviewAuthority(client, ctx, projectId);
        await assertReviewDocumentScope(client, authority, ctx, projectId, { id: documentId });
        return authority;
      });
      const resolved = await authorized();
      expect(resolved.orgRole).toBe('R-QC'); // current role, not the stale Owner snapshot
      expect(resolved.projectRole).toBe('R-REVIEWER');

      await expect(scoped(app, a.orgId, async client => {
        await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
        const authority = await resolveLiveReviewAuthority(client, ctx, projectId);
        await assertReviewDocumentScope(client, authority, ctx, projectId, { id: randomUUID() });
      })).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');

      await admin.query(
        "UPDATE project_members SET scope_json=$1::jsonb WHERE org_id=$2 AND project_id=$3 AND user_id=$4",
        [JSON.stringify({ mode: 'READ_ONLY' }), a.orgId, projectId, userId],
      );
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query(
        "UPDATE project_members SET scope_json=$1::jsonb WHERE org_id=$2 AND project_id=$3 AND user_id=$4",
        [JSON.stringify({ readOnly: 'false' }), a.orgId, projectId, userId],
      );
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query(
        "UPDATE project_members SET scope_json=$1::jsonb WHERE org_id=$2 AND project_id=$3 AND user_id=$4",
        [JSON.stringify({ unknownDimension: true }), a.orgId, projectId, userId],
      );
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query(
        "UPDATE project_members SET scope_json='{}'::jsonb, status='REMOVED' WHERE org_id=$1 AND project_id=$2 AND user_id=$3",
        [a.orgId, projectId, userId],
      );
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query(
        "UPDATE project_members SET status='ACTIVE' WHERE org_id=$1 AND project_id=$2 AND user_id=$3",
        [a.orgId, projectId, userId],
      );
      await admin.query("UPDATE projects SET status='SUSPENDED' WHERE id=$1 AND org_id=$2", [projectId, a.orgId]);
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1 AND org_id=$2", [projectId, a.orgId]);
      await admin.query("UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2", [a.orgId, userId]);
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
      await admin.query("UPDATE memberships SET status='ACTIVE' WHERE org_id=$1 AND user_id=$2", [a.orgId, userId]);
      await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [userId]);
      await expect(authorized()).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
    });
  });

  it('holds the current project membership against concurrent removal until the command transaction completes', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      await admin.query(
        "INSERT INTO memberships (id,org_id,user_id,role,status) VALUES ($1,$2,$3,'R-QC','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      await admin.query(
        "INSERT INTO project_members (id,org_id,project_id,user_id,role,status,added_by) VALUES ($1,$2,$3,$4,'R-REVIEWER','ACTIVE',$4)",
        [randomUUID(), a.orgId, a.projectIds[0], userId],
      );
      const ctx = { orgId: a.orgId, userId, actorType: 'USER' as const, requestId: 'concurrent-test' };
      await scoped(app, a.orgId, async client => {
        await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
        await resolveLiveReviewAuthority(client, ctx, a.projectIds[0]);
        const conflicting = await admin.connect();
        try {
          await conflicting.query("SET lock_timeout = '150ms'");
          await expect(conflicting.query(
            "UPDATE project_members SET status='REMOVED' WHERE org_id=$1 AND project_id=$2 AND user_id=$3",
            [a.orgId, a.projectIds[0], userId],
          )).rejects.toMatchObject({ code: '55P03' });
        } finally {
          conflicting.release();
        }
      });
      await admin.query(
        "UPDATE project_members SET status='REMOVED' WHERE org_id=$1 AND project_id=$2 AND user_id=$3",
        [a.orgId, a.projectIds[0], userId],
      );
      await expect(scoped(app, a.orgId, async client => {
        await client.query("SELECT set_config('app.current_user', $1, true)", [userId]);
        await resolveLiveReviewAuthority(client, ctx, a.projectIds[0]);
      })).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
    });
  });
  it('filters document detail and lists by live read-only scope under tc_app RLS', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const projectId = a.projectIds[0];
      const allowedId = randomUUID();
      const deniedId = randomUUID();

      await admin.query(
        "INSERT INTO memberships (id,org_id,user_id,role,status) VALUES ($1,$2,$3,'R-QC','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      await admin.query(
        "INSERT INTO project_members (id,org_id,project_id,user_id,role,status,added_by,scope_json) VALUES ($1,$2,$3,$4,'R-REVIEWER','ACTIVE',$4,$5::jsonb)",
        [randomUUID(), a.orgId, projectId, userId, JSON.stringify({
          documentIds: [allowedId], mode: 'READ_ONLY',
        })],
      );
      for (const [id, title] of [[allowedId, 'In scope'], [deniedId, 'Out of scope']]) {
        await admin.query(
          "INSERT INTO documents (id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES ($1,$2,$3,$4,'DT-001','TEST',$5)",
          [id, a.orgId, projectId, title, userId],
        );
      }
      const service = new DocumentsService(new TenantDbService(app), {} as any);
      const ctx = { orgId: a.orgId, userId, actorType: 'USER' as const, requestId: 'document-read-scope' };

      const listed = await service.listDocuments(ctx, projectId);
      expect(listed.map((row: { id: string }) => row.id)).toEqual([allowedId]);
      await expect(service.getDocument(ctx, allowedId)).resolves.toMatchObject({ id: allowedId });
      await expect(service.getDocument(ctx, deniedId)).rejects.toMatchObject({
        response: { message: 'DOCUMENT_NOT_FOUND' },
      });
      await expect(service.deleteDocument(ctx, allowedId)).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');

      await admin.query(
        "UPDATE project_members SET scope_json=$1::jsonb WHERE org_id=$2 AND project_id=$3 AND user_id=$4",
        [JSON.stringify({ unknownDimension: true }), a.orgId, projectId, userId],
      );
      await expect(service.listDocuments(ctx, projectId)).rejects.toThrow('REVIEW_AUTHORITY_CHANGED');
    });
  });

});
