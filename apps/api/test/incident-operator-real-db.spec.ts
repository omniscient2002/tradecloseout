import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

describe('PH5-G28-001 restricted operator real-Postgres incident containment', () => {
  it('quarantines only the explicitly scoped organisation and never gains tenant read/write access', async () => {
    await withDisposableDatabase(async ({ admin }) => {
      const orgA = uuidv7();
      const orgB = uuidv7();
      const objectA = uuidv7();
      const objectB = uuidv7();
      for (const [id, suffix] of [[orgA, 'A'], [orgB, 'B']]) {
        await admin.query(
          `INSERT INTO organisations(id, legal_name, display_name, state)
           VALUES ($1, $2, $3, 'TS')`,
          [id, `Incident Tenant ${suffix}`, `Tenant ${suffix}`],
        );
      }
      for (const [id, org, suffix] of [
        [objectA, orgA, 'a'], [objectB, orgB, 'b'],
      ]) {
        await admin.query(
          `INSERT INTO storage_objects
             (id, org_id, bucket, object_key, mime, size_bytes, sha256, status)
           VALUES ($1, $2, 'incident-test', $3, 'application/pdf',
                   1024, $4, 'READY')`,
          [id, org, `test/${suffix}/evidence.pdf`, suffix.repeat(64)],
        );
      }
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL ROLE tc_incident_operator');
          await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgA]);

          const sameTenant = await client.query(
            'SELECT id FROM storage_objects WHERE org_id = $1 AND id = $2', [orgA, objectA]);
          expect(sameTenant.rowCount).toBe(1);

          const crossTenant = await client.query(
            'SELECT id FROM storage_objects WHERE org_id = $1 AND id = $2', [orgB, objectB]);
          expect(crossTenant.rowCount).toBe(0);

          const denied = await client.query(
            `UPDATE storage_objects SET status = 'QUARANTINED'
             WHERE org_id = $1 AND id = $2 RETURNING id`,
            [orgB, objectB],
          );
          expect(denied.rowCount).toBe(0);

          const allowed = await client.query(
            `UPDATE storage_objects SET status = 'QUARANTINED'
             WHERE org_id = $1 AND id = $2 RETURNING id`,
            [orgA, objectA],
          );
          expect(allowed.rowCount).toBe(1);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      } finally {
        client.release();
      }

      const { rows } = await admin.query(
        'SELECT id, status FROM storage_objects WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[objectA, objectB]],
      );
      const result = new Map(rows.map((row) => [row.id, row.status]));
      expect(result.get(objectA)).toBe('QUARANTINED');
      expect(result.get(objectB)).toBe('READY');
    });
  }, 120_000);
});
