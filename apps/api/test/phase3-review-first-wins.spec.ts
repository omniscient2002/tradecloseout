import { ConflictException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { executeReviewDecision } from '../src/modules/reviews/review-decision.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import { evaluateReadinessInTransaction } from '../src/modules/handover/closeout-readiness';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

/** PH3-G11-001: real PostgreSQL 16 restricted-role serialization and sibling settlement. */
describe('PH3-G11-001 — exactly one terminal review decision per document version', () => {
  it('serializes conflicting reviewers, cancels siblings, and keeps pointers/requirements/audit coherent', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const seeded = await seedTenants(admin);
      const orgId = seeded.tenants[0].orgId;
      const projectId = seeded.tenants[0].projectIds[0];
      const firstUser = seeded.userId;
      const secondUser = uuidv7();
      const uploader = uuidv7();
      for (const [id, name] of [[secondUser, 'Second reviewer'], [uploader, 'Independent uploader']]) {
        await admin.query(
          `INSERT INTO users (id, name, status) VALUES ($1, $2, 'ACTIVE')`,
          [id, name],
        );
      }
      const contexts: any[] = [firstUser, secondUser].map((userId, index) => ({
        orgId, userId, actorType: 'USER', orgRole: 'R-QC', projectRole: 'R-QC',
        requestId: `phase3-first-wins-${index}`,
      }));
      const snapshotId = uuidv7();
      await admin.query(
        `INSERT INTO checklist_snapshots
           (id, org_id, project_id, version_no, status, resolved_payload_json,
            provenance_json, source_json, checksum, created_by)
           VALUES ($1, $2, $3, 1, 'ACTIVE', '{"requirements":[{"requirementKey":"REQ-SERIAL"}]}'::jsonb, '{}'::jsonb,
                   '{}'::jsonb, $4, $5)`,
        [snapshotId, orgId, projectId, 'a'.repeat(64), firstUser],
      );
      const service = new ReviewsService(new TenantDbService(app));

      async function createVersion(tag: string) {
        const documentId = uuidv7();
        const versionId = uuidv7();
        const objectId = uuidv7();
        const requirementId = uuidv7();
        const reviewA = uuidv7();
        const reviewB = uuidv7();
        await admin.query(
          `INSERT INTO storage_objects
             (id,org_id,bucket,object_key,size_bytes,observed_size_bytes,
              mime,sha256,status,provider_version_id)
             VALUES ($1,$2,'fixture',$3,100,100,'application/pdf',$4,'READY',$5)`,
          [objectId, orgId, `review/${tag}/source`, 'b'.repeat(64), `object-version-${tag}`],
        );
        await admin.query(
          `INSERT INTO documents
             (id,org_id,project_id,title,doc_type_key,category_key,status,created_by)
             VALUES ($1,$2,$3,$4,'DT-999','HVAC','ACTIVE',$5)`,
          [documentId, orgId, projectId, `Review race ${tag}`, uploader],
        );
        await admin.query(
          `INSERT INTO document_versions
             (id,org_id,project_id,document_id,version_no,revision_code,
              object_id,issue_date,file_status,review_status,uploaded_by)
             VALUES ($1,$2,$3,$4,1,'R0',$5,CURRENT_DATE,'READY','IN_REVIEW',$6)`,
          [versionId, orgId, projectId, documentId, objectId, uploader],
        );
        await admin.query(
          `UPDATE documents SET latest_version_id=$1 WHERE org_id=$2 AND id=$3`,
          [versionId, orgId, documentId],
        );
        await admin.query(
          `INSERT INTO requirements
             (id,org_id,project_id,current_snapshot_id,requirement_key,scope_key,
              group_key,title,doc_type_key,reviewer_role,status)
             VALUES ($1,$2,$3,$4,$5,'project','QA','Quality evidence',
                     'DT-999','R-QC','IN_REVIEW')`,
          [requirementId, orgId, projectId, snapshotId, `REQ-${tag}`],
        );
        await admin.query(
          `INSERT INTO document_requirements
             (id,org_id,project_id,document_id,requirement_id)
             VALUES ($1,$2,$3,$4,$5)`,
          [uuidv7(), orgId, projectId, documentId, requirementId],
        );
        for (const [reviewId, reviewerUserId, stage, status] of [
          [reviewA, firstUser, 'TECHNICAL', 'IN_REVIEW'],
          [reviewB, secondUser, 'FINAL', 'PENDING'],
        ]) {
          await admin.query(
            `INSERT INTO reviews
               (id,org_id,project_id,document_version_id,stage_key,
                reviewer_subject_type,reviewer_subject_id,reviewer_user_id,status)
               VALUES ($1,$2,$3,$4,$5,'USER',$6,$6,$7)`,
            [reviewId, orgId, projectId, versionId, stage, reviewerUserId, status],
          );
        }
        return { documentId, versionId, objectId, requirementId, reviewA, reviewB };
      }

      async function state(ids: Awaited<ReturnType<typeof createVersion>>) {
        const [version, doc, requirement, reviewRows, audit] = await Promise.all([
          admin.query('SELECT review_status, row_version FROM document_versions WHERE id=$1', [ids.versionId]),
          admin.query('SELECT current_approved_version_id FROM documents WHERE id=$1', [ids.documentId]),
          admin.query('SELECT status FROM requirements WHERE id=$1', [ids.requirementId]),
          admin.query('SELECT id,status,decision,row_version,decided_at FROM reviews WHERE document_version_id=$1 ORDER BY stage_key', [ids.versionId]),
          admin.query(`SELECT action FROM audit_events
                       WHERE org_id=$1 AND entity_type='DOCUMENT_VERSION' AND entity_id=$2
                         AND action IN ('REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED')`,
            [orgId, ids.versionId]),
        ]);
        return {
          version: version.rows[0], document: doc.rows[0],
          requirement: requirement.rows[0], reviews: reviewRows.rows, audits: audit.rows,
        };
      }

      // Serial reproduction of R38: a later REJECT must never reverse APPROVE.
      const serial = await createVersion('SERIAL');
      await expect(service.decideReview(contexts[0], serial.reviewA, {
        decision: 'APPROVE', expectedRowVersion: 1,
      })).resolves.toMatchObject({ status: 'OK', decision: 'APPROVE' });
      await expect(service.decideReview(contexts[1], serial.reviewB, {
        decision: 'REJECT', comment: 'Please revise this document', expectedRowVersion: 1,
      })).rejects.toThrow();
      const approved = await state(serial);
      expect(approved.version.review_status).toBe('APPROVED');
      expect(approved.document.current_approved_version_id).toBe(serial.versionId);
      expect(approved.requirement.status).toBe('APPROVED');
      expect(approved.reviews.map(r => r.status).sort()).toEqual(['APPROVED', 'CANCELLED']);
      expect(approved.reviews.find(r => r.status === 'CANCELLED')?.row_version).toBe(2);
      expect(approved.audits).toHaveLength(1);
      const acceptedReadiness = await new TenantDbService(app).withTenantContext(
        contexts[0], async client => evaluateReadinessInTransaction(client, orgId, projectId),
      );
      expect(acceptedReadiness.readyWithoutOverride).toBe(true);
      expect(acceptedReadiness.blockers.missingMandatoryCount).toBe(0);
      await expect(service.submitReview(contexts[0], serial.requirementId, {
        documentVersionId: serial.versionId,
      })).rejects.toThrow(ConflictException);
      expect((await state(serial)).audits).toHaveLength(1);

      // Parallel decisions against different assignments must have one winner;
      // second command must observe the first committed terminal state.
      for (const [tag, competing] of [
        ['PARALLEL-REJECT', 'REJECT'],
        ['PARALLEL-CHANGES', 'REQUEST_CHANGES'],
      ] as const) {
        const ids = await createVersion(tag);
        const attempts = await Promise.allSettled([
          service.decideReview(contexts[0], ids.reviewA, {
            decision: 'APPROVE', expectedRowVersion: 1,
          }),
          service.decideReview(contexts[1], ids.reviewB, {
            decision: competing, comment: 'Please correct submitted equipment evidence',
            expectedRowVersion: 1,
          }),
        ]);
        expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
        const current = await state(ids);
        expect(current.audits).toHaveLength(1);
        const winner = current.reviews.find(r => r.status !== 'CANCELLED');
        expect(winner).toBeDefined();
        expect(current.reviews.filter(r => r.status === 'CANCELLED')).toHaveLength(1);
        expect(current.reviews.filter(r => r.decided_at !== null)).toHaveLength(1);
        expect(current.version.review_status).toBe(winner?.status);
        if (winner?.status === 'APPROVED') {
          expect(current.document.current_approved_version_id).toBe(ids.versionId);
          expect(current.requirement.status).toBe('APPROVED');
        } else {
          expect(current.document.current_approved_version_id).toBeNull();
          expect(current.requirement.status).toBe(winner?.status);
        }
        // Version-targeted alias must not produce a second terminal outcome.
        await expect(service.recordVersionReview(contexts[0], projectId, {
          documentVersionId: ids.versionId, decision: 'APPROVE', expectedRowVersion: 1,
        })).rejects.toThrow();
      }

      // Deterministic sequential negative outcome: a rejected version cannot
      // acquire a later approval pointer through any sibling assignment.
      const declined = await createVersion('DECLINED');
      await service.decideReview(contexts[1], declined.reviewB, {
        decision: 'REJECT', comment: 'Evidence is not satisfactory', expectedRowVersion: 1,
      });
      await expect(service.decideReview(contexts[0], declined.reviewA, {
        decision: 'APPROVE', expectedRowVersion: 1,
      })).rejects.toThrow();
      const rejected = await state(declined);
      expect(rejected.version.review_status).toBe('REJECTED');
      expect(rejected.document.current_approved_version_id).toBeNull();
      expect(rejected.requirement.status).toBe('REJECTED');
      expect(rejected.reviews.map(r => r.status).sort()).toEqual(['CANCELLED','REJECTED']);
      expect(rejected.audits).toHaveLength(1);
      const rejectedReadiness = await new TenantDbService(app).withTenantContext(
        contexts[0], async client => evaluateReadinessInTransaction(client, orgId, projectId),
      );
      expect(rejectedReadiness.readyWithoutOverride).toBe(false);
      expect(rejectedReadiness.blockers.missingMandatory.some(
        (row: any) => row.id === declined.requirementId && !row.hasApprovedEvidence,
      )).toBe(true);

      // Commit-acknowledgement loss: PostgreSQL COMMIT succeeds, but the
      // application never receives a successful response. A different
      // terminal retry must fail without a second audit event or pointer
      // reversal, even though the first caller observed an exception.
      const uncertain = await createVersion('ACK-LOST');
      let dropped = false;
      const lostCommitPool: any = {
        connect: async () => {
          const realClient = await app.connect();
          return {
            query: async (sql: string, params?: unknown[]) => {
              const result = await realClient.query(sql, params);
              if (!dropped && sql === 'COMMIT') {
                dropped = true;
                throw new Error('COMMIT_ACKNOWLEDGEMENT_LOST');
              }
              return result;
            },
            release: () => realClient.release(),
          };
        },
      };
      const lostCommitService = new ReviewsService(new TenantDbService(lostCommitPool));
      await expect(lostCommitService.decideReview(contexts[0], uncertain.reviewA, {
        decision: 'APPROVE', expectedRowVersion: 1,
      })).rejects.toThrow('COMMIT_ACKNOWLEDGEMENT_LOST');
      expect(dropped).toBe(true);
      const committed = await state(uncertain);
      expect(committed.version.review_status).toBe('APPROVED');
      expect(committed.document.current_approved_version_id).toBe(uncertain.versionId);
      expect(committed.reviews.map(x => x.status).sort()).toEqual(['APPROVED', 'CANCELLED']);
      expect(committed.audits).toHaveLength(1);
      await expect(service.decideReview(contexts[1], uncertain.reviewB, {
        decision: 'REJECT', comment: 'Reverse after lost acknowledgement',
        expectedRowVersion: 1,
      })).rejects.toThrow();
      await expect(service.decideReview(contexts[0], uncertain.reviewA, {
        decision: 'APPROVE', expectedRowVersion: 1,
      })).rejects.toThrow();
      const replayed = await state(uncertain);
      expect(replayed.document.current_approved_version_id).toBe(uncertain.versionId);
      expect(replayed.audits).toHaveLength(1);
    });
  });
  it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'WITHDRAWN'])(
    'legacy external decision helper rejects already terminal version %s without writes',
    async (status) => {
      const statements: string[] = [];
      const client = {
        query: jest.fn(async (sql: string) => {
          statements.push(sql);
          if (sql.includes('SELECT dv.id')) {
            return { rows: [{
              id: uuidv7(), document_id: uuidv7(), version_no: 1,
              file_status: 'READY', review_status: status, uploaded_by: uuidv7(),
              row_version: 1, current_approved_version_id: null,
            }] };
          }
          return { rows: [] };
        }),
      };
      await expect(executeReviewDecision(client as any, {
        userId: uuidv7(), activeOrgId: uuidv7(), orgRole: 'R-QC',
        projectRoles: ['R-QC'], ip: '127.0.0.1', userAgent: 'test',
        requestId: 'phase3-legacy',
      }, {
        projectId: uuidv7(), documentVersionId: uuidv7(), expectedRowVersion: 1,
        method: 'EXTERNAL', decision: 'APPROVE',
      })).rejects.toThrow(ConflictException);
      expect(statements).toContain('ROLLBACK');
      expect(statements.some(sql => sql.startsWith('UPDATE '))).toBe(false);
      expect(statements).not.toContain('COMMIT');
    },
  );

  it.each(['NOT_SUBMITTED', 'WITHDRAWN'])(
    'external response cannot create acceptance from a %s version',
    async (reviewStatus) => {
      const statements: string[] = [];
      const query = jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT * FROM document_versions')) {
          return { rows: [{ id: uuidv7(), row_version: 1, review_status: reviewStatus }] };
        }
        return { rows: [] };
      });
      const service = new ReviewsService({
        withTenantContext: async (_ctx: unknown, work: any) => work({ query }),
      } as any);
      await expect(service.recordExternalApproval({
        orgId: uuidv7(), userId: uuidv7(), actorType: 'USER', requestId: 'phase3-external',
      }, uuidv7(), {
        externalPartyId: uuidv7(), externalApproverName: 'Consultant',
        externalApproverRole: 'Engineer', externalReference: 'Evidence-1',
        decidedAt: '2026-11-10T00:00:00.000Z',
        proofVersionId: uuidv7(), decision: 'APPROVE', externalMethod: 'EMAIL',
      } as any, 1)).rejects.toThrow(ConflictException);
      expect(statements.filter(sql => /UPDATE |INSERT INTO /i.test(sql))).toEqual([]);
    },
  );

  it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'WITHDRAWN'])(
    'external approval cannot re-decide an already terminal version %s',
    async (reviewStatus) => {
      const statements: string[] = [];
      const query = jest.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes('SELECT * FROM document_versions')) {
          return { rows: [{ id: uuidv7(), row_version: 1, review_status: reviewStatus }] };
        }
        return { rows: [] };
      });
      const service = new ReviewsService({
        withTenantContext: async (_ctx: unknown, callback: any) => callback({ query }),
      } as any);
      await expect(service.recordExternalApproval({
        orgId: uuidv7(), userId: uuidv7(), actorType: 'USER', requestId: 'phase3-external',
      }, uuidv7(), {
        externalPartyId: uuidv7(), externalApproverName: 'Consultant',
        externalApproverRole: 'Engineer', externalReference: 'Evidence-1',
        decidedAt: '2026-11-10T00:00:00.000Z',
        proofVersionId: uuidv7(), decision: 'APPROVE', externalMethod: 'EMAIL',
      } as any, 1)).rejects.toThrow(ConflictException);
      expect(statements.filter(sql => /UPDATE |INSERT INTO /i.test(sql))).toEqual([]);
      expect(statements.filter(sql => sql.includes('SELECT * FROM document_versions'))).toHaveLength(1);
    },
  );
});
