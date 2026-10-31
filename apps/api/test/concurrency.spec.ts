// apps/api/test/concurrency.spec.ts
// Concurrency & Row-Locking Test: SELECT ... FOR UPDATE & Plan Limit Verification
// @traces('FR-REV-001', 'FR-REV-002', 'FR-REV-003', 'FR-REV-004', 'FR-PRJ-001', 'FR-PRJ-002', 'NFR-CON-001', 'NFR-CON-002')

import { TenantDbService, ExecutionContext } from '../src/database/tenant-db.service';
import { uuidv7 } from 'uuidv7';
import { Pool } from 'pg';

describe('Concurrency Suite: FOR UPDATE Row Locking & Race Condition Prevention', () => {
  let db: TenantDbService;
  let migratorPool: Pool;
  const orgId = uuidv7();
  const userId = uuidv7();

  beforeAll(async () => {
    db = new TenantDbService();

    migratorPool = new Pool({
      host: '127.0.0.1',
      port: 5432,
      database: 'tradecloseout',
      user: 'tc_migrator',
      password: 'migrator_local_pw',
    });

    // Seed test organisation
    await migratorPool.query(
      `INSERT INTO organisations (id, legal_name, display_name, entity_type, trade, country, state, status)
       VALUES ($1, 'Concurrency Corp', 'Conc Corp', 'PRIVATE_LIMITED', 'HVAC', 'IN', 'MH', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [orgId],
    );

    // Seed test user
    await migratorPool.query(
      `INSERT INTO users (id, name, email_display, status)
       VALUES ($1, 'Conc User', 'conc@test.org', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [userId],
    );

    // Seed usage_counter inside org transaction
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      await client.query(
        `INSERT INTO usage_counters (id, org_id, metric, period, value)
         VALUES ($1, $2, 'ACTIVE_PROJECTS', 'ALL_TIME', 9)
         ON CONFLICT (org_id, metric, period) DO UPDATE SET value = 9`,
        [uuidv7(), orgId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await migratorPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [orgId]);
      await client.query(`DELETE FROM projects WHERE org_id = $1`, [orgId]);
      await client.query(`DELETE FROM usage_counters WHERE org_id = $1`, [orgId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    await migratorPool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await migratorPool.query(`DELETE FROM organisations WHERE id = $1`, [orgId]);
    await migratorPool.end();
    await db.getPool().end();
  });

  it('FOR UPDATE lock serializes concurrent increments and enforces plan limit', async () => {
    const ctx: ExecutionContext = {
      orgId,
      userId,
      actorType: 'USER',
      requestId: uuidv7(),
    };

    const maxAllowed = 10; // Current count is 9, so only 1 can succeed

    const tryCreateProject = async (projCode: string) => {
      return db.withTenantContext(ctx, async (client) => {
        // Lock usage counter row
        const counterRes = await client.query(
          `SELECT value FROM usage_counters
           WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'
           FOR UPDATE`,
          [orgId],
        );

        const currentVal = Number(counterRes.rows[0].value);
        if (currentVal >= maxAllowed) {
          throw new Error('PLAN_LIMIT_EXCEEDED');
        }

        // Simulate tiny processing latency to verify serialization
        await new Promise((r) => setTimeout(r, 50));

        await client.query(
          `UPDATE usage_counters SET value = value + 1
           WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'`,
          [orgId],
        );

        const projId = uuidv7();
        await client.query(
          `INSERT INTO projects (id, org_id, code, name, created_by, status)
           VALUES ($1, $2, $3, $4, $5, 'DRAFT')`,
          [projId, orgId, projCode, `Project ${projCode}`, userId],
        );

        return projId;
      });
    };

    // Run 2 parallel requests
    const results = await Promise.allSettled([
      tryCreateProject('CONC-PRJ-1'),
      tryCreateProject('CONC-PRJ-2'),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must be rejected with PLAN_LIMIT_EXCEEDED
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect((failures[0] as PromiseRejectedResult).reason.message).toContain('PLAN_LIMIT_EXCEEDED');

    // Verify database counter is exactly 10
    await db.withTenantContext(ctx, async (client) => {
      const finalCounter = await client.query(
        `SELECT value FROM usage_counters WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'`,
        [orgId],
      );
      expect(Number(finalCounter.rows[0].value)).toBe(10);
    });
  });
});
