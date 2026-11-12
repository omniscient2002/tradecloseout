import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(120_000);

describe('PH5-G28-001 single-use independent incident approvals on PostgreSQL', () => {
  it('binds exact operator, organisation, action, target and reason, and consumes only once', async () => {
    await withDisposableDatabase(async ({ admin }) => {
      const org = uuidv7();
      const target = uuidv7();
      const badTarget = uuidv7();
      const operatorUser = uuidv7();
      const approverUser = uuidv7();
      const approval = uuidv7();
      const reason = 'Independent security incident response approval';
      await admin.query(
        `INSERT INTO users(id, name, status)
         VALUES ($1, 'Test Incident Operator', 'ACTIVE'), ($2, 'Independent Test Approver', 'ACTIVE')`,
        [operatorUser, approverUser],
      );
      await admin.query(
        `INSERT INTO organisations(id, legal_name, display_name, state)
         VALUES ($1, 'Security Containment Test Tenant', 'Incident Tenant', 'TS')`,
        [org],
      );
      // The fixture inserts an approval through the database owner. Production
      // approvals must use a separate, auditable administrator workflow.
      await admin.query(
        `INSERT INTO incident_runbook_approvals
          (id, org_id, code, entity_id, operator_db_login, operator_user_id,
           approved_by_user_id, reason, expires_at)
         VALUES ($1, $2, 'RB-09', $3, current_user, $4, $5, $6, now() + interval '10 minutes')`,
        [approval, org, target, operatorUser, approverUser, reason],
      );
      const access = await admin.query(
        `SELECT
           has_table_privilege('tc_app', 'incident_runbook_approvals', 'SELECT') AS app_read,
           has_table_privilege('tc_app', 'incident_runbook_approvals', 'INSERT') AS app_write,
           has_table_privilege('tc_incident_operator', 'incident_runbook_approvals', 'SELECT') AS operator_read,
           has_table_privilege('tc_incident_operator', 'incident_runbook_approvals', 'UPDATE') AS operator_edit,
           has_function_privilege(
             'tc_incident_operator',
             'claim_incident_runbook_approval(uuid,uuid,text,uuid,uuid,text)',
             'EXECUTE'
           ) AS can_claim`,
      );
      expect(access.rows[0]).toEqual({
        app_read: false, app_write: false, operator_read: false,
        operator_edit: false, can_claim: true,
      });

      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE tc_incident_operator');
        const claim = async (targetId: string, explanation: string) => {
          const { rows } = await client.query(
            `SELECT public.claim_incident_runbook_approval(
               $1::uuid,$2::uuid,'RB-09',$3::uuid,$4::uuid,$5::text
             ) AS permitted`,
            [approval, org, targetId, operatorUser, explanation],
          );
          return rows[0]?.permitted;
        };
        expect(await claim(badTarget, reason)).toBe(false);
        expect(await claim(target, 'Incorrect reason for this incident')).toBe(false);
        expect(await claim(target, reason)).toBe(true);
        expect(await claim(target, reason)).toBe(false);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      const { rows } = await admin.query(
        'SELECT consumed_at FROM incident_runbook_approvals WHERE id = $1',
        [approval],
      );
      expect(rows[0]?.consumed_at).not.toBeNull();
    });
  });
});
