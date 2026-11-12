import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(120_000);

describe('PH5-G28-001 single-use independent incident approvals on PostgreSQL', () => {
  it('binds exact operator, org, operation and reason; dry run preserves approval; execute consumes once', async () => {
    await withDisposableDatabase(async ({ admin }) => {
      const org = uuidv7();
      const otherOrg = uuidv7();
      const operatorUser = uuidv7();
      const approverUser = uuidv7();
      const approval = uuidv7();
      const reason = 'Independent security incident response approval';
      await admin.query(
        `INSERT INTO users(id, name, status)
         VALUES ($1, 'Test Incident Operator', 'ACTIVE'),
                ($2, 'Independent Test Approver', 'ACTIVE')`,
        [operatorUser, approverUser],
      );
      for (const [id, suffix] of [[org, 'A'], [otherOrg, 'B']]) {
        await admin.query(
          `INSERT INTO organisations(id, legal_name, display_name, state)
           VALUES ($1, $2, $3, 'TS')`,
          [id, `Security Containment Tenant ${suffix}`, `Incident Tenant ${suffix}`],
        );
      }
      // In production a separate reviewer records this before the operator
      // can even inspect the approved runbook's target count.
      await admin.query(
        `INSERT INTO incident_runbook_approvals
          (id, org_id, code, entity_id, operator_db_login, operator_user_id,
           approved_by_user_id, reason, expires_at)
         VALUES ($1, $2, 'RB-08', NULL, current_user, $3, $4, $5,
                 now() + interval '10 minutes')`,
        [approval, org, operatorUser, approverUser, reason],
      );
      const { rows: [access] } = await admin.query(
        `SELECT
           has_table_privilege('tc_app','incident_runbook_approvals','SELECT') AS app_read,
           has_table_privilege('tc_incident_operator','incident_runbook_approvals','SELECT') AS operator_read,
           has_function_privilege('tc_incident_operator',
             'claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)','EXECUTE') AS manual_claim,
           has_function_privilege('tc_incident_operator',
             'execute_approved_incident_runbook(uuid,uuid,text,uuid,uuid,text,boolean)',
             'EXECUTE') AS guarded_execution`,
      );
      expect(access).toEqual({
        app_read: false, operator_read: false, manual_claim: false,
        guarded_execution: true,
      });

      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE tc_incident_operator');
          const run = async (targetOrg: string, explanation: string, execute: boolean) => {
            const { rows } = await client.query(
              `SELECT matched_targets, changed_targets
                 FROM public.execute_approved_incident_runbook(
                   $1::uuid,$2::uuid,'RB-08',NULL,$3::uuid,$4::text,$5::boolean
                 )`,
              [approval, targetOrg, operatorUser, explanation, execute],
            );
            return rows[0];
          };
          await client.query('SAVEPOINT no_authorization');
          await expect(run(otherOrg, reason, true))
            .rejects.toThrow('INCIDENT_APPROVAL_MISSING_EXPIRED_OR_USED');
          await client.query('ROLLBACK TO SAVEPOINT no_authorization');

          await client.query('SAVEPOINT incorrect_reason');
          await expect(run(org, 'Incorrect incident reason', true))
            .rejects.toThrow('INCIDENT_APPROVAL_MISSING_EXPIRED_OR_USED');
          await client.query('ROLLBACK TO SAVEPOINT incorrect_reason');

          expect(await run(org, reason, false)).toEqual({
            matched_targets: 0, changed_targets: 0,
          });
          expect(await run(org, reason, true)).toEqual({
            matched_targets: 0, changed_targets: 0,
          });
          await client.query('SAVEPOINT replay');
          await expect(run(org, reason, true))
            .rejects.toThrow('INCIDENT_APPROVAL_MISSING_EXPIRED_OR_USED');
          await client.query('ROLLBACK TO SAVEPOINT replay');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      } finally {
        client.release();
      }

      const { rows: [receipt] } = await admin.query(
        `SELECT a.consumed_at,
                (SELECT count(*)::int FROM admin_audit_events
                 WHERE org_id = $2 AND action = 'INCIDENT_RB-08') AS admin_events,
                (SELECT count(*)::int FROM audit_events
                 WHERE org_id = $2 AND action = 'RUNBOOK_RB-08') AS audit_events
           FROM incident_runbook_approvals a WHERE a.id = $1`,
        [approval, org],
      );
      expect(receipt.consumed_at).not.toBeNull();
      expect(receipt.admin_events).toBe(1);
      expect(receipt.audit_events).toBe(1);
    });
  }, 120_000);
});
