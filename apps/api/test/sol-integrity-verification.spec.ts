import {syntheticEntitlementQuery} from './helpers/synthetic-entitlement-query';
// apps/api/test/sol-integrity-verification.spec.ts
// Invariant Verification for Sol Part A & Audit Findings:
// 1. Revision allocation locks parent document FOR UPDATE (TC-F013)
// 2. Client-controlled EICAR/quarantine bypass removed (SOL A1(d))
// 3. Bulk import dry-run and commit disabled (SOL A1(e))
// 4. External notification channels stored as QUEUED without fake SENT (TC-F017, SOL A1(b))

import { DocumentsService } from '../src/modules/documents/documents.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import { GoneException } from '@nestjs/common';

describe('Sol Integrity & Audit Invariants Suite', () => {
  const actor = {
    orgId: '0192e3a0-0000-7000-8000-000000000001',
    userId: '0192e3a0-2000-7000-8000-000000000003',
    actorType: 'USER' as const,
    requestId: 'req-sol-1',
  };
  const projectId = '0192e3a0-1000-7000-8000-000000000002';
  const existingDocId = '0192e3a0-3000-7000-8000-000000000004';

  describe('1. Revision allocation locks parent document (TC-F013)', () => {
    it('executes SELECT ... FROM documents FOR UPDATE before allocating nextVersionNo on existing document', async () => {
      const executedQueries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          executedQueries.push(sql);
          if(sql.includes('SELECT project_id FROM document_versions'))return {rows:[{project_id:projectId}]};
          if(sql.includes('SELECT id,status,purged_at FROM projects'))return {rows:[{id:projectId,status:'ACTIVE',purged_at:null}]};
          const entitlementFixture=syntheticEntitlementQuery(sql,{});if(entitlementFixture)return entitlementFixture;
          if(sql.includes('SELECT id,status,purged_at FROM projects'))return {rows:[{id:projectId,status:'ACTIVE',purged_at:null}]};
          if (sql.includes("maxStorageBytes' AS max_storage_bytes")) {
            return { rows: [{ max_storage_bytes: '1048576' }] };
          }
          if (sql.includes("metric='STORAGE_BYTES'") && sql.includes('FOR UPDATE')) {
            return { rows: [{ value: '0' }] };
          }
          if (sql.includes('SUM(size_bytes)')) {
            return { rows: [{ reserved_bytes: '0' }] };
          }
          if (sql.includes('SELECT id, doc_type_key FROM documents WHERE')) {
            return { rows: [{ id: existingDocId, doc_type_key: 'DT-001' }] };
          }
          if (sql.includes('SELECT id FROM document_versions')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT COALESCE(MAX(version_no), 0)')) {
            return { rows: [{ max_v: 2 }] };
          }
          if (sql.includes('INSERT INTO storage_objects')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO document_versions')) {
            return { rows: [] };
          }
          if (sql.includes('UPDATE documents SET latest_version_id')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockDb = new TenantDbService({ connect: jest.fn().mockResolvedValue(mockClient) } as any);
      const mockStorage = {
        createUploadUrls: jest.fn().mockResolvedValue({
          uploadId: null,
          partSizeBytes: 1024,
          parts: [{ partNumber: 1, uploadUrl: 'https://s3.example.com/test', requiredHeaders: {} }],
        }),
      };

      const service = new DocumentsService(mockDb, mockStorage as any);

      const res = await service.createUploadIntent(actor, projectId, {
        documentId: existingDocId,
        filename: 'chiller_manual_rev3.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        revisionCode: 'R3',
      });

      expect(res.versionId).toBeDefined();
      // Verify parent document was locked FOR UPDATE before MAX(version_no) query
      const lockIndex = executedQueries.findIndex((q) => q.includes('SELECT id, doc_type_key FROM documents WHERE org_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL FOR UPDATE'));
      const maxIndex = executedQueries.findIndex((q) => q.includes('SELECT COALESCE(MAX(version_no), 0)'));
      expect(lockIndex).toBeGreaterThanOrEqual(0);
      expect(maxIndex).toBeGreaterThan(lockIndex);
    });
  });

  describe('2. Client-controlled EICAR quarantine bypass removed (SOL A1(d))', () => {
    it('does not allow client DTO or filename to trigger quarantine directly on upload completion', async () => {
      const executedQueries: string[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string) => {
          executedQueries.push(sql);
          if(sql.includes('SELECT project_id FROM document_versions'))return {rows:[{project_id:projectId}]};
          if(sql.includes('SELECT id,status,purged_at FROM projects'))return {rows:[{id:projectId,status:'ACTIVE',purged_at:null}]};
          if (sql.includes('SELECT dv.*, so.id AS storage_id') || sql.includes('FROM document_versions dv')) {
            return {
              rows: [{
                id: 'ver-1',
                org_id: actor.orgId,
                project_id: projectId,
                doc_id: existingDocId,
                storage_id: 'so-1',
                file_status: 'PENDING_UPLOAD',
                storage_status: 'PENDING',
                object_key: 'orgs/1/eicar_test_file.pdf',
                storage_size_bytes: '1024',
                expected_sha256: null,
              }],
            };
          }
          if (sql.includes('UPDATE document_versions')) {
            return { rows: [] };
          }
          if (sql.includes('UPDATE storage_objects')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockDb = new TenantDbService({ connect: jest.fn().mockResolvedValue(mockClient) } as any);
      const mockStorage = {
        finalizeUpload: jest.fn().mockResolvedValue({ providerVersionId: 's3-ver-123', observedSizeBytes: 1024 }),
      };

      const service = new DocumentsService(mockDb, mockStorage as any);

      // Client attempts to pass EICAR flag
      const result = await service.completeUpload(actor, 'ver-1', {
        isEicarTestVirus: true,
        samplePayload: 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
      } as any);

      // Must transition to PROCESSING, not QUARANTINED; worker ClamAV scan owns quarantine
      expect(result.fileStatus).toBe('PROCESSING');
      const quarantinedQuery = executedQueries.find((q) => q.includes("file_status = 'QUARANTINED'"));
      expect(quarantinedQuery).toBeUndefined();
      const processingQuery = executedQueries.find((q) => q.includes("file_status = 'PROCESSING'"));
      expect(processingQuery).toBeDefined();
    });
  });

  describe('3. Bulk import dry-run & commit disabled (SOL A1(e))', () => {
    it('throws GoneException on createBulkImportIntent, dryRunBulkImport, and commitBulkImport', async () => {
      const service = new DocumentsService({} as any);
      await expect(service.createBulkImportIntent(actor, projectId)).rejects.toThrow(GoneException);
      await expect(service.dryRunBulkImport(actor, 'job-1')).rejects.toThrow(GoneException);
      await expect(service.commitBulkImport(actor, 'job-1')).rejects.toThrow(GoneException);
    });
  });

  describe('4. External notifications stored as QUEUED without fake SENT (TC-F017, SOL A1(b))', () => {
    it('rejects unapproved external messages and delivers addressed in-app notifications', async () => {
      let insertParams: any[] = [];
      const mockClient = {
        query: jest.fn(async (sql: string, params: any[]) => {
          if (sql.includes('INSERT INTO notifications')) {
            insertParams = params;
            return { rows: [{ id: 'notif-1', status: params[7], sent_at: params[9] }] };
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockDb = new TenantDbService({ connect: jest.fn().mockResolvedValue(mockClient) } as any);
      const service = new NotificationsService(mockDb);

      // Untrusted clients may not queue arbitrary SMS/email content.
      await expect(service.createNotification(actor, {
        channel: 'SMS',
        eventKey: 'TEST_EVENT',
        payload: { text: 'Hello' },
        dedupKey: 'dedup-1',
      })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'EXTERNAL_NOTIFICATION_TEMPLATES_REQUIRED' }),
      });
      expect(insertParams).toHaveLength(0);

      const inAppResult = await service.createNotification(actor, {
        channel: 'IN_APP',
        eventKey: 'TEST_IN_APP',
        payload: { text: 'In App Notice' },
        dedupKey: 'dedup-2',
      });

      expect(inAppResult.notification.status).toBe('SENT');
      expect(inAppResult.notification.sent_at).not.toBeNull();
    });
  });
});
