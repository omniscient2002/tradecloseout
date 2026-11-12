import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { TenantDbService } from '../src/database/tenant-db.service';
import { PartiesService } from '../src/modules/parties/parties.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

describe('PH3-G04-004 — real PostgreSQL supplier intake authority and durability', () => {
  it('rejects mismatched/unverified proofs, persists rejection/resubmission and deduplicates retries', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const actor = fixture.userId;
      const supplierId = uuidv7();
      const grantId = uuidv7();
      const poId = uuidv7();
      const poLineId = uuidv7();
      const obligationId = uuidv7();
      const docId = uuidv7();
      const storageId = uuidv7();
      const versionId = uuidv7();
      const commandId = uuidv7();
      const ctx: any = {
        orgId, userId: actor, actorType: 'USER', requestId: 'phase3-intake',
        ip: '127.0.0.1', userAgent: 'jest-phase3',
      };
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES ($1, $2, $3, 'R-OWNER', 'ACTIVE')`,
        [uuidv7(), orgId, actor],
      );
      await admin.query(
        `INSERT INTO parties (id, org_id, name, types, status, created_by)
          VALUES ($1, $2, 'Supplier One', ARRAY['SUPPLIER_OEM'], 'ACTIVE', $3)`,
        [supplierId, orgId, actor],
      );
      await admin.query(
        `INSERT INTO guest_grants
          (id, org_id, project_id, party_id, grant_type, role, capabilities,
           token_hash, expires_at, created_by, target_email)
         VALUES ($1, $2, $3, $4, 'SUPPLIER_UPLOAD', 'R-SUPPLIER-OEM',
           ARRAY['document.upload'], $5, now() + interval '30 days', $6, 'supplier@example.test')`,
        [grantId, orgId, projectId, supplierId, 'intake-hash-' + grantId, actor],
      );
      await admin.query(
        `INSERT INTO procurement_orders
          (id, org_id, project_id, po_number, supplier_party_id, status, created_by)
         VALUES ($1, $2, $3, 'PO-INTAKE-1', $4, 'ISSUED', $5)`,
        [poId, orgId, projectId, supplierId, actor],
      );
      await admin.query(
        `INSERT INTO procurement_order_lines
          (id, org_id, project_id, po_id, line_no, asset_category_key, description)
         VALUES ($1, $2, $3, $4, 1, 'AHU', 'Air handling unit')`,
        [poLineId, orgId, projectId, poId],
      );
      await admin.query(
        `INSERT INTO supplier_document_obligations
          (id, org_id, project_id, po_line_id, doc_type_key, stage_key,
           title, supplier_party_id, status)
         VALUES ($1, $2, $3, $4, 'DT-001', 'FAT', 'Factory test', $5, 'UPLOADED')`,
        [obligationId, orgId, projectId, poLineId, supplierId],
      );
      await admin.query(
        `INSERT INTO storage_objects
          (id, org_id, bucket, object_key, size_bytes, observed_size_bytes,
           mime, sha256, status, provider_version_id)
         VALUES ($1, $2, 'verified-vault', 'supplier/scan.pdf', 100, 100,
           'application/pdf', $3, 'READY', 'immutable-v1')`,
        [storageId, orgId, 'a'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO documents
          (id, org_id, project_id, title, doc_type_key, category_key, status, created_by)
         VALUES ($1, $2, $3, 'FAT Certificate', 'DT-001', 'TEST', 'ACTIVE', $4)`,
        [docId, orgId, projectId, actor],
      );
      await admin.query(
        `INSERT INTO document_versions
          (id, org_id, project_id, document_id, version_no, revision_code,
           object_id, issue_date, file_status, uploaded_by_grant_id)
         VALUES ($1, $2, $3, $4, 1, 'R0', $5, CURRENT_DATE, 'READY', $6)`,
        [versionId, orgId, projectId, docId, storageId, grantId],
      );

      const service = new PartiesService(new TenantDbService(app));
      await expect(service.intakeSupplierObligation(
        { ...ctx, actorType: 'GUEST', guestGrantId: grantId },
        projectId, obligationId,
        { decision: 'ACCEPT', documentVersionId: versionId },
      )).rejects.toThrow(ForbiddenException);

      await admin.query(
        `UPDATE storage_objects SET provider_version_id = 'null'
          WHERE org_id = $1 AND id = $2`, [orgId, storageId],
      );
      await expect(service.intakeSupplierObligation(
        ctx, projectId, obligationId,
        { decision: 'ACCEPT', documentVersionId: versionId },
      )).rejects.toThrow('SUPPLIER_INTAKE_EVIDENCE_NOT_VERIFIED');
      await admin.query(
        `UPDATE storage_objects SET provider_version_id = 'immutable-v1'
          WHERE org_id = $1 AND id = $2`, [orgId, storageId],
      );

      const alternateParty = uuidv7();
      await admin.query(
        `INSERT INTO parties (id, org_id, name, types, created_by)
          VALUES ($1, $2, 'Other supplier', ARRAY['SUPPLIER'], $3)`,
        [alternateParty, orgId, actor],
      );
      await admin.query(
        `UPDATE guest_grants SET party_id = $3
          WHERE org_id = $1 AND id = $2`,
        [orgId, grantId, alternateParty],
      );
      await expect(service.intakeSupplierObligation(
        ctx, projectId, obligationId, { decision: 'ACCEPT', documentVersionId: versionId },
      )).rejects.toThrow('SUPPLIER_INTAKE_EVIDENCE_MISMATCH');
      await admin.query(
        `UPDATE guest_grants SET party_id = $3
          WHERE org_id = $1 AND id = $2`,
        [orgId, grantId, supplierId],
      );

      const rejected = await service.intakeSupplierObligation(
        ctx, projectId, obligationId,
        { decision: 'REJECT', notes: 'Missing supplier test seal', documentVersionId: versionId,
          commandId, expectedRowVersion: 1 },
      );
      expect(rejected).toMatchObject({
        status: 'PENDING', decision: 'REJECT', rowVersion: 2,
        idempotentReplay: false,
      });
      const replay = await service.intakeSupplierObligation(
        ctx, projectId, obligationId,
        { decision: 'REJECT', notes: 'Missing supplier test seal', documentVersionId: versionId,
          commandId, expectedRowVersion: 1 },
      );
      expect(replay.idempotentReplay).toBe(true);
      await expect(service.intakeSupplierObligation(
        ctx, projectId, obligationId,
        { decision: 'ACCEPT', documentVersionId: versionId, expectedRowVersion: 2 },
      )).rejects.toThrow('REJECTED_VERSION_REUPLOAD_REQUIRED');

      const nextStorageId = uuidv7();
      const nextVersionId = uuidv7();
      await admin.query(
        `INSERT INTO storage_objects
          (id, org_id, bucket, object_key, size_bytes, observed_size_bytes,
           mime, sha256, status, provider_version_id)
         VALUES ($1, $2, 'verified-vault', 'supplier/rescan.pdf', 100, 100,
           'application/pdf', $3, 'READY', 'immutable-v2')`,
        [nextStorageId, orgId, 'b'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO document_versions
          (id, org_id, project_id, document_id, version_no, revision_code,
           object_id, issue_date, file_status, uploaded_by_grant_id)
         VALUES ($1, $2, $3, $4, 2, 'R1', $5, CURRENT_DATE, 'READY', $6)`,
        [nextVersionId, orgId, projectId, docId, nextStorageId, grantId],
      );
      const accepted = await service.intakeSupplierObligation(
        ctx, projectId, obligationId,
        { decision: 'ACCEPT', documentVersionId: nextVersionId, expectedRowVersion: 2,
          commandId: uuidv7() },
      );
      expect(accepted).toMatchObject({ decision: 'ACCEPT', status: 'ACCEPTED', rowVersion: 3 });
      const history = await service.getSupplierIntakeHistory(ctx, projectId, obligationId);
      expect(history.decisions).toHaveLength(2);
      expect(history.decisions[0].decision).toBe('ACCEPT');
      expect(history.decisions[1].reason).toBe('Missing supplier test seal');
      await expect(service.getSupplierIntakeHistory(
        { ...ctx, actorType: 'GUEST', guestGrantId: grantId },
        projectId, obligationId,
      )).rejects.toThrow(ForbiddenException);
      const receipts = await admin.query(
        `SELECT count(*)::int AS decisions FROM supplier_intake_decisions WHERE obligation_id = $1`,
        [obligationId],
      );
      expect(receipts.rows[0].decisions).toBe(2);
      const outbox = await admin.query(
        `SELECT count(*)::int AS events FROM outbox_events
          WHERE org_id = $1 AND project_id = $2 AND event_type LIKE 'SUPPLIER_INTAKE_%'`,
        [orgId, projectId],
      );
      expect(outbox.rows[0].events).toBe(2);
      const audit = await admin.query(
        `SELECT count(*)::int AS events FROM audit_events
          WHERE org_id = $1 AND project_id = $2 AND entity_id = $3
            AND action LIKE 'SUPPLIER_INTAKE_%'`,
        [orgId, projectId, obligationId],
      );
      expect(audit.rows[0].events).toBe(2);
    });
  });

  it('serializes concurrent accepted decisions on one obligation', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const actor = fixture.userId;
      const supplierId = uuidv7(), grantId = uuidv7();
      const poId = uuidv7(), poLineId = uuidv7(), obligationId = uuidv7();
      const docId = uuidv7(), storageId = uuidv7(), versionId = uuidv7();
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES ($1,$2,$3,'R-OWNER','ACTIVE')`, [uuidv7(),orgId,actor],
      );
      await admin.query(
        `INSERT INTO parties (id,org_id,name,types,created_by)
          VALUES ($1,$2,'Supplier',ARRAY['SUPPLIER'], $3)`,[supplierId,orgId,actor],
      );
      await admin.query(
        `INSERT INTO guest_grants
          (id,org_id,project_id,party_id,grant_type,role,capabilities,token_hash,expires_at,created_by,target_email)
         VALUES ($1,$2,$3,$4,'SUPPLIER_UPLOAD','R-SUPPLIER-OEM',
           ARRAY['document.upload'], $5, now()+interval '1 month', $6, 'supplier@example.test')`,
        [grantId,orgId,projectId,supplierId,'concurrency-'+grantId,actor],
      );
      await admin.query(
        `INSERT INTO procurement_orders
          (id,org_id,project_id,po_number,supplier_party_id,created_by)
         VALUES ($1,$2,$3,'PO-CONC',$4,$5)`,[poId,orgId,projectId,supplierId,actor],
      );
      await admin.query(
        `INSERT INTO procurement_order_lines
          (id,org_id,project_id,po_id,line_no,asset_category_key,description)
         VALUES ($1,$2,$3,$4,1,'AHU','Unit')`,[poLineId,orgId,projectId,poId],
      );
      await admin.query(
        `INSERT INTO supplier_document_obligations
          (id,org_id,project_id,po_line_id,doc_type_key,stage_key,title,supplier_party_id,status)
         VALUES ($1,$2,$3,$4,'DT-001','FAT','Factory Test',$5,'UPLOADED')`,
        [obligationId,orgId,projectId,poLineId,supplierId],
      );
      await admin.query(
        `INSERT INTO storage_objects
          (id,org_id,bucket,object_key,size_bytes,observed_size_bytes,mime,sha256,status,provider_version_id)
         VALUES ($1,$2,'vault','one.pdf',100,100,'application/pdf',$3,'READY','v1')`,
        [storageId,orgId,'c'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO documents
          (id,org_id,project_id,title,doc_type_key,category_key,status,created_by)
         VALUES ($1,$2,$3,'FAT','DT-001','TEST','ACTIVE',$4)`,[docId,orgId,projectId,actor],
      );
      await admin.query(
        `INSERT INTO document_versions
          (id,org_id,project_id,document_id,version_no,revision_code,object_id,issue_date,file_status,uploaded_by_grant_id)
         VALUES ($1,$2,$3,$4,1,'R0',$5,CURRENT_DATE,'READY',$6)`,
        [versionId,orgId,projectId,docId,storageId,grantId],
      );
      const ctx: any = { orgId, userId: actor, actorType: 'USER', requestId: 'concurrency-test' };
      const service = new PartiesService(new TenantDbService(app));
      const decisions = await Promise.all([
        service.intakeSupplierObligation(ctx, projectId, obligationId, {
          decision: 'ACCEPT', documentVersionId: versionId, commandId: uuidv7(), expectedRowVersion: 1,
        }),
        service.intakeSupplierObligation(ctx, projectId, obligationId, {
          decision: 'ACCEPT', documentVersionId: versionId, commandId: uuidv7(), expectedRowVersion: 1,
        }),
      ]);
      expect(decisions.filter((d) => !d.idempotentReplay)).toHaveLength(1);
      expect(decisions.filter((d) => d.idempotentReplay)).toHaveLength(1);
      const stored = await admin.query(
        'SELECT count(*)::int AS n FROM supplier_intake_decisions WHERE obligation_id=$1',
        [obligationId],
      );
      expect(stored.rows[0].n).toBe(1);
    });
  });
});
