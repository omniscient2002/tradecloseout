import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { WarrantyAndBillingService } from '../src/modules/billing/warranty-and-billing.service';

jest.setTimeout(180_000);

describe('PH4-G17-001/002 Pass 03: actual PostgreSQL scanner receipt and shared evidence', () => {
  it('stores complete multi-asset receipt, preserves it in audit and rejects same-size changed bytes', async () => {
    await withDisposableDatabase(async ({admin, app}) => {
      const orgId = uuidv7(), projectId = uuidv7(), docId = uuidv7();
      const versionId = uuidv7(), objectId = uuidv7();
      const assetA = uuidv7(), assetB = uuidv7();
      const defectA = uuidv7(), defectB = uuidv7();
      const submitter = uuidv7(), verifier = uuidv7();
      const sha = 'a'.repeat(64), newSha = 'b'.repeat(64);
      for (const [id, name] of [[submitter, 'Remedy Submitter'], [verifier, 'Independent Verifier']]) {
        await admin.query("INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE')", [id, name]);
      }
      await admin.query(
        `INSERT INTO organisations (id, legal_name, display_name, state)
          VALUES ($1, 'Verified HVAC Evidence Limited', 'Verified HVAC', 'AP')`,
        [orgId],
      );
      await admin.query(
        `INSERT INTO projects (id, org_id, code, name, status, created_by)
          VALUES ($1, $2, 'P3-REMEDY', 'Scoped remedy bytes', 'ACTIVE', $3)`,
        [projectId, orgId, submitter],
      );
      for (const [id, tag] of [[assetA, 'AHU-01'], [assetB, 'AHU-02']]) {
        await admin.query(
          `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
            VALUES ($1, $2, $3, $4, 'Air handling unit', 'AHU', $5)`,
          [id, orgId, projectId, tag, submitter],
        );
      }
      await admin.query(
        `INSERT INTO storage_objects
          (id, org_id, bucket, object_key, mime, size_bytes,
           sha256, expected_sha256, observed_size_bytes,
           provider_version_id, av_scanned_at, status, created_by)
         VALUES ($1, $2, 'test-bucket', $3, 'application/pdf', 1024,
                 $4, $4, 1024, 'scanner-version-1', now(), 'READY', $5)`,
        [objectId, orgId, `projects/${projectId}/remedy.pdf`, sha, submitter],
      );
      await admin.query(
        `INSERT INTO documents (id, org_id, project_id, title, doc_type_key,
              category_key, status, created_by)
         VALUES ($1, $2, $3, 'Independent repair report', 'DEFECT_REMEDY',
                 'HVAC', 'ACTIVE', $4)`,
        [docId, orgId, projectId, submitter],
      );
      await admin.query(
        `INSERT INTO document_versions
          (id, org_id, project_id, document_id, version_no, revision_code,
           object_id, file_status, review_status, issue_date, uploaded_by)
         VALUES ($1, $2, $3, $4, 1, 'A1', $5, 'READY', 'APPROVED',
                 CURRENT_DATE, $6)`,
        [versionId, orgId, projectId, docId, objectId, submitter],
      );
      await admin.query(
        `UPDATE documents SET current_approved_version_id = $2
          WHERE id = $1`, [docId, versionId],
      );
      for (const assetId of [assetA, assetB]) {
        await admin.query(
          `INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), orgId, projectId, docId, assetId],
        );
      }
      for (const [id, assetId] of [[defectA, assetA], [defectB, assetB]]) {
        await admin.query(
          `INSERT INTO defects
            (id, org_id, project_id, asset_id, title, description,
             severity, raised_by, status)
           VALUES ($1, $2, $3, $4, 'Mechanical balancing repair',
                   'Repair and verify damaged fan assembly',
                   'HIGH', $5, 'OPEN')`,
          [id, orgId, projectId, assetId, submitter],
        );
      }
      const service = new WarrantyAndBillingService(app);
      const submitCtx: any = {
        orgId, userId: submitter, actorType: 'SYSTEM',
        requestId: uuidv7(), ip: '127.0.0.1', userAgent: 'P3-remedy-db',
      };
      const verifierCtx: any = {...submitCtx, userId: verifier, requestId: uuidv7()};
      const first = await service.submitDefectRemedy(submitCtx, projectId, defectA, objectId, 1);
      const second = await service.submitDefectRemedy(submitCtx, projectId, defectB, objectId, 1);
      expect(first.status).toBe('RECTIFIED');
      expect(second.status).toBe('RECTIFIED');
      const {rows: pinned} = await admin.query(
        `SELECT remedy_sha256, remedy_provider_version_id,
                remedy_size_bytes, remedy_scanned_at, remedy_asset_scope_ids
           FROM defects WHERE id = $1`, [defectA],
      );
      expect(pinned[0].remedy_sha256).toBe(sha);
      expect(pinned[0].remedy_size_bytes).toBe('1024');
      expect(pinned[0].remedy_provider_version_id).toBe('scanner-version-1');
      expect(pinned[0].remedy_scanned_at).not.toBeNull();
      expect([...pinned[0].remedy_asset_scope_ids].sort()).toEqual([assetA, assetB].sort());
      const {rows: events} = await admin.query(
        `SELECT action, evidence_sha256, evidence_asset_scope_ids
          FROM defect_transition_events WHERE org_id=$1 AND defect_id=$2`,
        [orgId, defectA],
      );
      expect(events).toHaveLength(1);
      expect(events[0].evidence_sha256).toBe(sha);
      expect([...events[0].evidence_asset_scope_ids].sort()).toEqual([assetA, assetB].sort());

      // Same size, different verified digest cannot gain independent closure.
      await admin.query(
        `UPDATE storage_objects SET sha256 = $2, expected_sha256 = $2
          WHERE id = $1`, [objectId, newSha],
      );
      await expect(service.closeDefect(verifierCtx, projectId, defectA, objectId, 2))
        .rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_IMMUTABLE_RECEIPT_CHANGED'}});
      const {rows: [stillOpen]} = await admin.query(
        'SELECT status FROM defects WHERE id=$1', [defectA],
      );
      expect(stillOpen.status).toBe('RECTIFIED');
      await admin.query(
        `UPDATE storage_objects SET sha256 = $2, expected_sha256 = $2
         WHERE id = $1`, [objectId, sha],
      );
      await admin.query(
        `DELETE FROM document_assets
         WHERE org_id=$1 AND project_id=$2 AND document_id=$3 AND asset_id=$4`,
        [orgId, projectId, docId, assetB],
      );
      await expect(service.closeDefect(verifierCtx, projectId, defectA, objectId, 2))
        .rejects.toMatchObject({response: {code: 'DEFECT_REMEDY_IMMUTABLE_RECEIPT_CHANGED'}});
      await admin.query(
        `INSERT INTO document_assets (id, org_id, project_id, document_id, asset_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv7(), orgId, projectId, docId, assetB],
      );
      const outcome = await service.closeDefect(verifierCtx, projectId, defectA, objectId, 2);
      expect(outcome.status).toBe('CLOSED');
      const {rows: [secondDefect]} = await admin.query(
        'SELECT status FROM defects WHERE id=$1', [defectB],
      );
      expect(secondDefect.status).toBe('RECTIFIED');
    });
  });
});
