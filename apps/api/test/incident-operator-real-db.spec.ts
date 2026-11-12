import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(120_000);

describe('PH5-G28-001 restricted operator real-Postgres incident containment', () => {
  it('requires a DB approval and revokes sessions only for the approved tenant, with no direct SELECT', async () => {
    await withDisposableDatabase(async ({ admin }) => {
      const orgA = uuidv7();
      const orgB = uuidv7();
      const operatorUser = uuidv7();
      const approverUser = uuidv7();
      const sessionUser = uuidv7();
      const sessionA = uuidv7();
      const sessionB = uuidv7();
      const approval = uuidv7();
      const reason = 'Revoke compromised sessions within Tenant A';
      await admin.query(
        `INSERT INTO users(id, name, status) VALUES
           ($1, 'Incident operator', 'ACTIVE'),
           ($2, 'Separate incident approver', 'ACTIVE'),
           ($3, 'Affected user', 'ACTIVE')`,
        [operatorUser, approverUser, sessionUser],
      );
      for (const [id, suffix] of [[orgA, 'A'], [orgB, 'B']]) {
        await admin.query(
          `INSERT INTO organisations(id, legal_name, display_name, state)
           VALUES ($1, $2, $3, 'TS')`,
          [id, `Incident Tenant ${suffix}`, `Tenant ${suffix}`],
        );
      }
      for (const [id, org, suffix] of [
        [sessionA, orgA, 'a'], [sessionB, orgB, 'b'],
      ]) {
        await admin.query(
          `INSERT INTO sessions
             (id, user_id, token_hash, csrf_token_hash, active_org_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
          [id, sessionUser, `token-${suffix}-${id}`, `csrf-${suffix}`, org],
        );
      }
      // Fixture approval is inserted by the migration owner. Real approvals
      // must come from an independent operational process.
      await admin.query(
        `INSERT INTO incident_runbook_approvals
          (id, org_id, code, entity_id, operator_db_login, operator_user_id,
           approved_by_user_id, reason, expires_at)
         VALUES ($1, $2, 'RB-08', NULL, current_user, $3, $4, $5,
                 now() + interval '10 minutes')`,
        [approval, orgA, operatorUser, approverUser, reason],
      );

      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE tc_incident_operator');
          // No raw access even to a local session; a compromised operator
          // credential cannot enumerate session hashes or bypass approvals.
          await client.query('SAVEPOINT privilege_negative');
          await expect(client.query('SELECT token_hash FROM sessions LIMIT 1'))
            .rejects.toThrow();
          await client.query('ROLLBACK TO SAVEPOINT privilege_negative');

          const { rows: [run] } = await client.query(
            `SELECT matched_targets, changed_targets
               FROM public.execute_approved_incident_runbook(
                 $1::uuid,$2::uuid,'RB-08',NULL,$3::uuid,$4::text,true
               )`,
            [approval, orgA, operatorUser, reason],
          );
          expect(run).toEqual({ matched_targets: 1, changed_targets: 1 });
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      } finally {
        client.release();
      }

      const { rows } = await admin.query(
        'SELECT id, revoked_at FROM sessions WHERE id = ANY($1::uuid[])',
        [[sessionA, sessionB]],
      );
      const result = new Map(rows.map((row) => [row.id, row.revoked_at]));
      expect(result.get(sessionA)).toBeInstanceOf(Date);
      expect(result.get(sessionB)).toBeNull();
    });
  }, 120_000);
});
