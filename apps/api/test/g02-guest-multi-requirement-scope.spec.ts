import { randomUUID } from 'crypto';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(90000);

describe('PH1-G02-006 — guest version and detail scope (restricted PostgreSQL 16)', () => {
  it('requires every linked obligation within the live grant, denies revocation and closed-project upload', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const projectId = a.projectIds[0];
      const snapshotId = randomUUID();
      const partyId = randomUUID();
      const grantId = randomUUID();
      const documentId = randomUUID();
      const allowedRequirementId = randomUUID();
      const otherRequirementId = randomUUID();
      const readyVersionId = randomUUID();
      const pendingVersionId = randomUUID();
      await admin.query(
        "INSERT INTO parties (id,org_id,name,types,created_by) VALUES ($1,$2,'Supplier Test',ARRAY['SUPPLIER_OEM']::text[],$3)",
        [partyId, a.orgId, userId],
      );
      await admin.query(
        `INSERT INTO guest_grants
           (id,org_id,project_id,party_id,role,grant_type,capabilities,scope_json,token_hash,expires_at,created_by)
         VALUES ($1,$2,$3,$4,'R-SUPPLIER-OEM','SUPPLIER_UPLOAD',
           ARRAY['document.upload','document.download']::text[],$5::jsonb,$6,now()+interval '1 day',$7)`,
        [grantId, a.orgId, projectId, partyId,
          JSON.stringify({ requirementIds: [allowedRequirementId] }), randomUUID(), userId],
      );
      await admin.query(
        `INSERT INTO checklist_snapshots
          (id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by)
         VALUES ($1,$2,$3,1,'ACTIVE','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$4,$5)`,
        [snapshotId, a.orgId, projectId, 'a'.repeat(64), userId],
      );
      for (const [id, key] of [[allowedRequirementId, 'REQ-ALLOWED'], [otherRequirementId, 'REQ-OTHER']]) {
        await admin.query(
          `INSERT INTO requirements
            (id,org_id,project_id,current_snapshot_id,requirement_key,group_key,title,doc_type_key,reviewer_role)
           VALUES ($1,$2,$3,$4,$5,'TEST','Guest acceptance','DT-001','R-QC')`,
          [id, a.orgId, projectId, snapshotId, key],
        );
      }
      await admin.query(
        `INSERT INTO documents (id,org_id,project_id,title,doc_type_key,category_key,created_by)
         VALUES ($1,$2,$3,'Shared report','DT-001','HANDOVER_DOCS',$4)`,
        [documentId, a.orgId, projectId, userId],
      );
      for (const requirementId of [allowedRequirementId, otherRequirementId]) {
        await admin.query(
          "INSERT INTO document_requirements (id,org_id,project_id,document_id,requirement_id) VALUES ($1,$2,$3,$4,$5)",
          [randomUUID(), a.orgId, projectId, documentId, requirementId],
        );
      }
      for (const [versionId, versionNo, status] of [
        [readyVersionId, 1, 'READY'], [pendingVersionId, 2, 'PENDING_UPLOAD'],
      ] as const) {
        const objectId = randomUUID();
        await admin.query(
          `INSERT INTO storage_objects
            (id,org_id,bucket,object_key,mime,size_bytes,status,sha256,observed_size_bytes,provider_version_id,s3_upload_id,created_by)
           VALUES ($1,$2,'test-bucket',$3,'application/pdf',1024,$4,$5,$6,$7,$8,$9)`,
          [objectId, a.orgId, `guest/${versionId}/source`, status,
            status === 'READY' ? 'b'.repeat(64) : null,
            status === 'READY' ? 1024 : null,
            status === 'READY' ? 'stored-version' : null,
            status === 'PENDING_UPLOAD' ? 'upload-session' : null,
            userId],
        );
        await admin.query(
          `INSERT INTO document_versions
            (id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,issue_date,uploaded_by_grant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9)`,
          [versionId, a.orgId, projectId, documentId, versionNo, `R${versionNo}`, objectId, status, grantId],
        );
      }

      const signer = {
        createSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example.test/file'),
        refreshUploadUrls: jest.fn().mockResolvedValue({ parts: [], expiresInSeconds: 900 }),
        finalizeUpload: jest.fn(),
        abortUpload: jest.fn(),
      };
      const service = new DocumentsService(new TenantDbService(app), signer as any);
      const ctx = {
        orgId: a.orgId, userId, actorType: 'GUEST' as const,
        guestGrantId: grantId, requestId: 'mixed-requirement-guest-scope',
      };
      const rejectMixed = async () => {
        await expect(service.getDocument(ctx, documentId)).rejects.toThrow('DOCUMENT_NOT_FOUND');
        await expect(service.getDownloadUrl(ctx, readyVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
        await expect(service.refreshUploadUrls(ctx, pendingVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
        await expect(service.completeUpload(ctx, pendingVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
        await expect(service.abortUpload(ctx, pendingVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
        expect(signer.createSignedDownloadUrl).not.toHaveBeenCalled();
        expect(signer.refreshUploadUrls).not.toHaveBeenCalled();
        expect(signer.finalizeUpload).not.toHaveBeenCalled();
        expect(signer.abortUpload).not.toHaveBeenCalled();
      };
      // One permitted linked requirement must not make the entire multi-linked
      // document visible to a supplier.
      await rejectMixed();

      await admin.query(
        "UPDATE guest_grants SET scope_json=$1::jsonb WHERE id=$2",
        [JSON.stringify({ requirementIds: [allowedRequirementId, otherRequirementId] }), grantId],
      );
      await expect(service.getDocument(ctx, documentId)).resolves.toMatchObject({
        id: documentId, versions: expect.arrayContaining([{ id: readyVersionId }]),
      });
      await expect(service.getDownloadUrl(ctx, readyVersionId))
        .resolves.toMatchObject({ downloadUrl: 'https://signed.example.test/file' });
      await expect(service.refreshUploadUrls(ctx, pendingVersionId))
        .resolves.toMatchObject({ versionId: pendingVersionId });
      expect(signer.createSignedDownloadUrl).toHaveBeenCalledTimes(1);
      expect(signer.refreshUploadUrls).toHaveBeenCalledTimes(1);

      await admin.query("UPDATE projects SET status='CLOSED' WHERE org_id=$1 AND id=$2", [a.orgId, projectId]);
      await expect(service.refreshUploadUrls(ctx, pendingVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
      expect(signer.refreshUploadUrls).toHaveBeenCalledTimes(1);
      await admin.query("UPDATE projects SET status='ACTIVE' WHERE org_id=$1 AND id=$2", [a.orgId, projectId]);

      await admin.query(
        "UPDATE guest_grants SET scope_json=$1::jsonb WHERE id=$2",
        [JSON.stringify({ requirementIds: { [allowedRequirementId]: true, [otherRequirementId]: true } }), grantId],
      );
      await expect(service.getDocument(ctx, documentId)).rejects.toThrow('DOCUMENT_NOT_FOUND');
      await expect(service.getDownloadUrl(ctx, readyVersionId)).rejects.toThrow('VERSION_NOT_FOUND');

      await admin.query("UPDATE guest_grants SET status='REVOKED' WHERE id=$1", [grantId]);
      await expect(service.getDocument(ctx, documentId)).rejects.toThrow('DOCUMENT_NOT_FOUND');
      await expect(service.refreshUploadUrls(ctx, pendingVersionId)).rejects.toThrow('VERSION_NOT_FOUND');
    });
  });
});
