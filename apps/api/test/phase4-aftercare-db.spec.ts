import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

jest.setTimeout(180_000);

describe('PH4-G17-003 PostgreSQL aftercare lifecycle and immutable accepted context', () => {
  it('persists nonmandatory aftercare on a closed project and enforces database constraints', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const userId = uuidv7(), orgId = uuidv7(), projectId = uuidv7();
      const assetId = uuidv7(), packageId = uuidv7();
      await admin.query(
        `INSERT INTO users (id, name, status) VALUES ($1, 'Aftercare Owner', 'ACTIVE')`,
        [userId],
      );
      await admin.query(
        `INSERT INTO organisations (id, legal_name, display_name, state)
         VALUES ($1, 'Aftercare Test Services Private Limited', 'Aftercare Test', 'AP')`,
        [orgId],
      );
      await admin.query(
        `INSERT INTO projects (id, org_id, code, name, status, created_by, closed_at)
         VALUES ($1, $2, 'AFTERCARE-01', 'Post-handover support test', 'CLOSED', $3, now())`,
        [projectId, orgId, userId],
      );
      await admin.query(
        `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
         VALUES ($1, $2, $3, 'AHU-01', 'Accepted air handling unit', 'AHU', $4)`,
        [assetId, orgId, projectId, userId],
      );
      await admin.query(
        `INSERT INTO handover_packages
           (id, org_id, project_id, version_no, status, package_purpose,
            snapshot_checksum, requested_by)
         VALUES ($1, $2, $3, 1, 'ACCEPTED', 'FULL_HANDOVER', $4, $5)`,
        [packageId, orgId, projectId, 'a'.repeat(64), userId],
      );
      const ctx: any = {
        orgId, userId, actorType: 'SYSTEM',
        ip: '127.0.0.1', userAgent: 'phase4-db-test', requestId: uuidv7(),
      };
      const service = new WarrantyAndBillingService(app);
      await expect(service.createDefect(ctx, projectId, {
        title: 'Unclassified postclose snag',
      })).rejects.toMatchObject({ response: { code: 'DEFECT_PROJECT_LIFECYCLE_BLOCKED' } });

      const result = await service.createDefect(ctx, projectId, {
        title: 'Aftercare bearing noise', assetId,
        severity: 'CRITICAL', caseType: 'AFTERCARE',
        postHandoverReason: 'Customer reported abnormal bearing noise after handover',
        aftercareReference: 'POSTCLOSE-WARRANTY-001',
      });
      expect(result.status).toBe('OPEN');
      expect(result.mandatory).toBe(false);
      expect(result.acceptedPackageId).toBe(packageId);

      const { rows: [stored] } = await admin.query(
        `SELECT defect_context, mandatory, accepted_package_id, aftercare_reason, aftercare_reference
           FROM defects WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [orgId, projectId, result.defectId],
      );
      expect(stored.defect_context).toBe('AFTERCARE');
      expect(stored.mandatory).toBe(false);
      expect(stored.accepted_package_id).toBe(packageId);
      expect(stored.aftercare_reference).toBe('POSTCLOSE-WARRANTY-001');

      await expect(admin.query(
        'UPDATE defects SET mandatory = true WHERE id = $1',
        [result.defectId],
      )).rejects.toThrow(/defects_aftercare_qualified/i);
      await expect(admin.query(
        'UPDATE defects SET accepted_package_id = $2 WHERE id = $1',
        [result.defectId, uuidv7()],
      )).rejects.toThrow(/defects_aftercare_accepted_package_fk/i);

      const { rows: [project] } = await admin.query(
        'SELECT status, closed_at FROM projects WHERE id = $1', [projectId],
      );
      expect(project.status).toBe('CLOSED');
      expect(project.closed_at).not.toBeNull();
      const { rows: [pkg] } = await admin.query(
        'SELECT status FROM handover_packages WHERE id = $1', [packageId],
      );
      expect(pkg.status).toBe('ACCEPTED');
    });
  });
});
