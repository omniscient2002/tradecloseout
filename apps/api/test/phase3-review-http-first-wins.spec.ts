import { createHash } from 'crypto';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { uuidv7 } from 'uuidv7';
import { ReviewsController } from '../src/modules/reviews/reviews.controller';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Exercises real guards and routes, not an injected pre-authorized context. */
describe('PH3-G11-001 authenticated HTTP: a single terminal reviewer decision wins', () => {
  it('serializes aliases and rejects changed permissions, stale sessions and conflicting retry', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const actorA = fixture.userId;
      const actorB = uuidv7();
      const uploader = uuidv7();
      const documentId = uuidv7();
      const versionId = uuidv7();
      const storageId = uuidv7();
      const snapshotId = uuidv7();
      const requirementId = uuidv7();
      const reviewA = uuidv7();
      const reviewB = uuidv7();
      const tokens = ['reviewer-session-a', 'reviewer-session-b'];
      const csrfTokens = ['reviewer-csrf-a', 'reviewer-csrf-b'];
      const actors = [actorA, actorB];

      for (const [id, name] of [[actorB, 'Second reviewer'], [uploader, 'Independent uploader']]) {
        await admin.query('INSERT INTO users (id, name, status) VALUES ($1, $2, $3)',
          [id, name, 'ACTIVE']);
      }
      for (const [idx, actor] of actors.entries()) {
        await admin.query(
          `INSERT INTO memberships (id, org_id, user_id, role, status)
             VALUES ($1, $2, $3, 'R-QC', 'ACTIVE')`,
          [uuidv7(), orgId, actor],
        );
        await admin.query(
          `INSERT INTO project_members
             (id, org_id, project_id, user_id, role, status, scope_json, added_by)
             VALUES ($1, $2, $3, $4, 'R-QC', 'ACTIVE', '{}'::jsonb, $4)`,
          [uuidv7(), orgId, projectId, actor],
        );
        await admin.query(
          `INSERT INTO sessions
             (id,user_id,token_hash,csrf_token_hash,active_org_id,expires_at)
             VALUES ($1,$2,$3,$4,$5,now()+interval '1 day')`,
          [uuidv7(), actor, sha(tokens[idx]), sha(csrfTokens[idx]), orgId],
        );
      }
      await admin.query(
        `INSERT INTO storage_objects
           (id,org_id,bucket,object_key,size_bytes,observed_size_bytes,mime,sha256,status,provider_version_id)
           VALUES ($1,$2,'fixture',$3,100,100,'application/pdf',$4,'READY','immutable-review-1')`,
        [storageId, orgId, `http/review/${versionId}`, 'a'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO documents
           (id,org_id,project_id,title,doc_type_key,category_key,status,created_by)
           VALUES ($1,$2,$3,'HTTP review race','DT-999','HVAC','ACTIVE',$4)`,
        [documentId, orgId, projectId, uploader],
      );
      await admin.query(
        `INSERT INTO document_versions
           (id,org_id,project_id,document_id,version_no,revision_code,object_id,
            issue_date,file_status,review_status,uploaded_by)
           VALUES ($1,$2,$3,$4,1,'R0',$5,CURRENT_DATE,'READY','IN_REVIEW',$6)`,
        [versionId, orgId, projectId, documentId, storageId, uploader],
      );
      await admin.query(
        'UPDATE documents SET latest_version_id=$1 WHERE id=$2',
        [versionId, documentId],
      );
      await admin.query(
        `INSERT INTO checklist_snapshots
           (id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by)
           VALUES ($1,$2,$3,1,'ACTIVE','{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$4,$5)`,
        [snapshotId, orgId, projectId, 'b'.repeat(64), actorA],
      );
      await admin.query(
        `INSERT INTO requirements
           (id,org_id,project_id,current_snapshot_id,requirement_key,scope_key,group_key,title,doc_type_key,
            reviewer_role,status)
           VALUES ($1,$2,$3,$4,'PH3-REVIEW-HTTP','project','QA','Equipment acceptance','DT-999','R-QC','IN_REVIEW')`,
        [requirementId, orgId, projectId, snapshotId],
      );
      await admin.query(
        `INSERT INTO document_requirements (id,org_id,project_id,document_id,requirement_id)
           VALUES ($1,$2,$3,$4,$5)`,
        [uuidv7(), orgId, projectId, documentId, requirementId],
      );
      for (const [reviewId, userId, stage] of [
        [reviewA, actorA, 'TECHNICAL'], [reviewB, actorB, 'FINAL'],
      ]) {
        await admin.query(
          `INSERT INTO reviews
             (id,org_id,project_id,document_version_id,stage_key,
              reviewer_subject_type,reviewer_subject_id,reviewer_user_id,status)
             VALUES ($1,$2,$3,$4,$5,'USER',$6,$6,'IN_REVIEW')`,
          [reviewId, orgId, projectId, versionId, stage, userId],
        );
      }

      const module = await Test.createTestingModule({
        controllers: [ReviewsController],
        providers: [
          { provide: Pool, useValue: app },
          Reflector,
          SessionCsrfGuard,
          PermissionGuard,
          { provide: ReviewsService, useValue: new ReviewsService(new TenantDbService(app)) },
        ],
      }).compile();
      const http = module.createNestApplication();
      try {
        await http.listen(0, '127.0.0.1');
        const { port } = http.getHttpServer().address() as AddressInfo;
        const base = `http://127.0.0.1:${port}/api/v1`;
        const request = (user: 0 | 1, route: string, decision: string, comment?: string, csrf = csrfTokens[user]) =>
          fetch(base + route, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${tokens[user]}`,
              'x-csrf-token': csrf,
              'content-type': 'application/json',
              'if-match': '"1"',
            },
            body: JSON.stringify({
              method: 'IN_APP', decision, comment,
              documentVersionId: versionId, expectedRowVersion: 1,
            }),
          });

        // Real CSRF and bearer-token guards must execute before any state changes.
        expect((await request(0, `/reviews/${reviewA}/decisions`, 'APPROVE', undefined, 'wrong-csrf')).status).toBe(403);
        expect((await fetch(base + `/reviews/${reviewA}/decisions`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'APPROVE' }),
        })).status).toBe(401);

        // Parallel requests use distinct, authenticated reviewers and route
        // aliases, but must serialize on the SAME document version row.
        const [a, b] = await Promise.all([
          request(0, `/reviews/${reviewA}/decisions`, 'APPROVE'),
          request(1, `/projects/${projectId}/document-versions/${versionId}/decision`,
            'REJECT', 'Insufficient commissioning evidence'),
        ]);
        expect([a.status, b.status].filter(x => x < 300)).toHaveLength(1);
        expect([a.status, b.status].filter(x => x >= 400)).toHaveLength(1);

        const [version, doc, reviews, audit] = await Promise.all([
          admin.query('SELECT review_status,row_version FROM document_versions WHERE id=$1', [versionId]),
          admin.query('SELECT current_approved_version_id FROM documents WHERE id=$1', [documentId]),
          admin.query('SELECT status,decision FROM reviews WHERE document_version_id=$1', [versionId]),
          admin.query(`SELECT action FROM audit_events
                       WHERE entity_type='DOCUMENT_VERSION' AND entity_id=$1
                         AND action IN ('REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED')`, [versionId]),
        ]);
        expect(audit.rows).toHaveLength(1);
        expect(reviews.rows.filter((r: any) => r.status === 'CANCELLED')).toHaveLength(1);
        expect(reviews.rows.filter((r: any) => ['APPROVED','REJECTED','CHANGES_REQUESTED'].includes(r.status))).toHaveLength(1);
        expect(version.rows[0].row_version).toBe(2);
        if (version.rows[0].review_status === 'APPROVED') {
          expect(doc.rows[0].current_approved_version_id).toBe(versionId);
        } else {
          expect(doc.rows[0].current_approved_version_id).toBeNull();
        }

        // Stale replay through ALL decision endpoints, including old project
        // form aliases and bulk, must not produce a second terminal event.
        const retries = [
          () => request(0, `/reviews/${reviewA}/decisions`, 'REJECT', 'Try to reverse approval'),
          () => request(1, `/projects/${projectId}/reviews/${versionId}`, 'APPROVE'),
          () => request(1, `/projects/${projectId}/reviews/${versionId}/decision`, 'APPROVE'),
          () => request(1, `/projects/${projectId}/reviews`, 'APPROVE'),
        ];
        for (const retry of retries) expect((await retry()).status).toBeGreaterThanOrEqual(400);
        const after = await admin.query(
          `SELECT count(*)::int AS count FROM audit_events
             WHERE entity_type='DOCUMENT_VERSION' AND entity_id=$1
               AND action IN ('REVIEW_APPROVED','REVIEW_REJECTED','REVIEW_CHANGES_REQUESTED')`,
          [versionId],
        );
        expect(after.rows[0].count).toBe(1);

        // A changed permission is checked by the actual HTTP guard, not a
        // simulated userContext. Replaying a completed decision cannot bypass it.
        await admin.query(
          `UPDATE memberships SET role='R-AUDITOR' WHERE org_id=$1 AND user_id=$2`,
          [orgId, actorB],
        );
        await admin.query(
          `UPDATE project_members SET role='R-CONSULTANT' WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
          [orgId, projectId, actorB],
        );
        // Consultant has scoped decide permission; revoke project membership
        // entirely to guarantee a denied operation without alternative grants.
        await admin.query(
          `UPDATE project_members SET status='REVOKED'
             WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
          [orgId, projectId, actorB],
        );
        expect((await request(1, `/projects/${projectId}/document-versions/${versionId}/decision`, 'APPROVE')).status)
          .toBeGreaterThanOrEqual(400);
      } finally {
        await http.close();
      }
    });
  });
});
