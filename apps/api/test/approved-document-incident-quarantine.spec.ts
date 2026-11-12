import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(120_000);

describe('PH5-G28-001 approved-document incident quarantine on real PG16', () => {
  it('quarantines immutable backing object without violating an APPROVED version constraint', async () => {
    await withDisposableDatabase(async ({ admin }) => {
      const org = uuidv7();
      const project = uuidv7();
      const document = uuidv7();
      const version = uuidv7();
      const object = uuidv7();
      const operatorUser = uuidv7();
      const approverUser = uuidv7();
      const approval = uuidv7();
      const reason = 'Quarantine incident evidence after independent security review';
      await admin.query(
        `INSERT INTO users(id, name, status) VALUES
           ($1, 'Incident operator', 'ACTIVE'),
           ($2, 'Independent approver', 'ACTIVE')`,
        [operatorUser, approverUser],
      );
      await admin.query(
        `INSERT INTO organisations(id, legal_name, display_name, state)
         VALUES ($1, 'Approved Version Incident Tenant', 'Incident Tenant', 'TS')`,
        [org],
      );
      await admin.query(
        `INSERT INTO projects(id, org_id, code, name, status, created_by)
         VALUES ($1, $2, 'INC-001', 'Security Test Project', 'ACTIVE', $3)`,
        [project, org, operatorUser],
      );
      await admin.query(
        `INSERT INTO storage_objects(id, org_id, bucket, object_key, mime, size_bytes,
                                     sha256, status, provider_version_id)
         VALUES ($1, $2, 'test-vault', $3, 'application/pdf', 512,
                 $4, 'READY', 'test-immutable-v1')`,
        [object, org, `incident/${org}/evidence.pdf`, 'a'.repeat(64)],
      );
      await admin.query(
        `INSERT INTO documents(id, org_id, project_id, title, doc_type_key,
                               category_key, status, created_by)
         VALUES ($1, $2, $3, 'Approved Security Evidence', 'PHOTO', 'DEFECT', 'ACTIVE', $4)`,
        [document, org, project, operatorUser],
      );
      await admin.query(
        `INSERT INTO document_versions(id, org_id, project_id, document_id,
                    version_no, revision_code, object_id, file_status,
                    review_status, issue_date, uploaded_by)
         VALUES($1, $2, $3, $4, 1, 'R0', $5,
                'READY', 'APPROVED', CURRENT_DATE, $6)`,
        [version, org, project, document, object, operatorUser],
      );
      await admin.query(
        `INSERT INTO incident_runbook_approvals(
           id, org_id, code, entity_id, operator_db_login, operator_user_id,
           approved_by_user_id, reason, expires_at
         ) VALUES($1, $2, 'RB-09', $3, current_user, $4, $5, $6,
                  now() + interval '10 minutes')`,
        [approval, org, version, operatorUser, approverUser, reason],
      );

      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE tc_incident_operator');
          const { rows: [result] } = await client.query(
            `SELECT matched_targets, changed_targets
             FROM public.execute_approved_incident_runbook(
               $1::uuid,$2::uuid,'RB-09',$3::uuid,$4::uuid,$5::text,true
             )`,
            [approval, org, version, operatorUser, reason],
          );
          expect(result).toEqual({ matched_targets: 1, changed_targets: 1 });
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        }
      } finally {
        client.release();
      }

      const { rows: [result] } = await admin.query(
        `SELECT dv.review_status, dv.file_status, so.status AS storage_status
         FROM document_versions dv
         JOIN storage_objects so ON so.id = dv.object_id AND so.org_id = dv.org_id
         WHERE dv.org_id = $1 AND dv.id = $2`,
        [org, version],
      );
      expect(result).toEqual({
        review_status: 'APPROVED',
        file_status: 'READY',
        storage_status: 'QUARANTINED',
      });
      const { rows: [audit] } = await admin.query(
        `SELECT count(*)::int AS n FROM admin_audit_events
         WHERE org_id = $1 AND action = 'INCIDENT_RB-09'`,
        [org],
      );
      expect(audit.n).toBe(1);
    });
  }, 120_000);
});
