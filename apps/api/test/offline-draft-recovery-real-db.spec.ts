import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(120_000);

describe('PH5-G22-004 real PostgreSQL authorization for old offline draft rebind', () => {
  it('rejects cross-org/project, changed baseline, superseded and closed obligations', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [tenantA, tenantB] } = await seedTenants(admin);
      const projectA = tenantA.projectIds[0];
      const projectB = tenantB.projectIds[0];
      const versionA = uuidv7(), versionB = uuidv7();
      const requirementA = uuidv7(), requirementB = uuidv7();
      for (const [tenant, project, snapshot, requirement, label] of [
        [tenantA.orgId, projectA, versionA, requirementA, 'A'],
        [tenantB.orgId, projectB, versionB, requirementB, 'B'],
      ]) {
        await admin.query(
          `INSERT INTO checklist_snapshots
            (id, org_id, project_id, version_no, status, resolved_payload_json,
             provenance_json, source_json, checksum, created_by)
           VALUES($1,$2,$3,1,'ACTIVE','{}'::jsonb,'{}'::jsonb,
                  '{}'::jsonb,$4,$5)`,
          [snapshot, tenant, project, label.repeat(64), userId],
        );
        await admin.query(
          `INSERT INTO requirements
            (id, org_id, project_id, current_snapshot_id, requirement_key,
             group_key, title, doc_type_key, row_version, status)
           VALUES($1,$2,$3,$4,$5,'COMMISSIONING','HVAC test certificate',
                  'TEST_REPORT',7,'NOT_STARTED')`,
          [requirement, tenant, project, snapshot, `TEST-${label}`],
        );
      }
      const service = new DocumentsService(new TenantDbService(app));
      const ctx = {
        orgId: tenantA.orgId, userId, actorType: 'USER',
        requestId: 'draft-real-db-authority',
      } as any;

      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementA, 7,
      )).resolves.toEqual({
        allowed: true, projectId: projectA,
        requirementId: requirementA, rowVersion: 7,
      });
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectB, requirementB, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementB, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');

      await admin.query('UPDATE requirements SET row_version = 8 WHERE id = $1', [requirementA]);
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementA, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');

      await admin.query(`UPDATE requirements SET row_version = 7, superseded_at = now()
                          WHERE id = $1`, [requirementA]);
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementA, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');

      await admin.query(`UPDATE requirements SET superseded_at = NULL,
                          status = 'NOT_APPLICABLE' WHERE id = $1`, [requirementA]);
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementA, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');

      await admin.query(`UPDATE requirements SET status = 'NOT_STARTED' WHERE id = $1`, [requirementA]);
      await admin.query(`UPDATE projects SET status = 'CLOSED' WHERE id = $1`, [projectA]);
      await expect(service.validateDraftRecoveryAuthority(
        ctx, projectA, requirementA, 7,
      )).rejects.toThrow('DRAFT_RECOVERY_TARGET_NO_LONGER_ELIGIBLE');
    });
  }, 120_000);
});
