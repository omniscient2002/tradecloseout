// apps/api/test/rls-isolation.spec.ts
// Spike 1 & RT-005: Fail-Closed Tenant RLS Isolation Acceptance Test
// @traces('FR-ORG-001', 'FR-ORG-002', 'FR-ORG-003', 'NFR-SEC-001', 'NFR-SEC-002')

import { TenantDbService, ExecutionContext } from '../src/database/tenant-db.service';
import { uuidv7 } from 'uuidv7';
import { Pool } from 'pg';

describe('Spike 1: RLS Tenant Isolation Acceptance Suite', () => {
  let db: TenantDbService;
  let adminClient: any;
  let migratorPool: Pool;
  const orgAId = uuidv7();
  const orgBId = uuidv7();
  const userAId = uuidv7();
  const userBId = uuidv7();
  const projectAId = uuidv7();
  const projectBId = uuidv7();

  beforeAll(async () => {
    db = new TenantDbService();

    // Use tc_migrator connection to set up initial seed data
    migratorPool = new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'tradecloseout',
      user: process.env.DB_MIGRATOR_USER || 'tc_migrator',
      password: process.env.DB_MIGRATOR_PASSWORD || 'migrator_local_pw',
    });

    // Seed Org A and Org B (global table)
    await migratorPool.query(
      `INSERT INTO organisations (id, legal_name, display_name, entity_type, trade, country, state, status)
       VALUES ($1, 'Tenant Alpha Pvt Ltd', 'Tenant Alpha', 'PRIVATE_LIMITED', 'HVAC', 'IN', 'MH', 'ACTIVE'),
              ($2, 'Tenant Beta Pvt Ltd', 'Tenant Beta', 'PRIVATE_LIMITED', 'HVAC', 'IN', 'DL', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [orgAId, orgBId],
    );

    // Seed Users for Org A and B (global table)
    await migratorPool.query(
      `INSERT INTO users (id, name, email_display, status)
       VALUES ($1, 'Alice Alpha', 'alice@alpha.test', 'ACTIVE'),
              ($2, 'Bob Beta', 'bob@beta.test', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [userAId, userBId],
    );

    // Seed Org A tenant records inside Org A context
    const clientA = await migratorPool.connect();
    try {
      await clientA.query('BEGIN');
      await clientA.query("SELECT set_config('app.current_org', $1, true)", [orgAId]);
      await clientA.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
         VALUES ($1, $2, $3, 'R-OWNER', 'ACTIVE')`,
        [uuidv7(), orgAId, userAId],
      );
      await clientA.query(
        `INSERT INTO projects (id, org_id, code, name, created_by, status)
         VALUES ($1, $2, 'PRJ-A', 'Alpha Project', $3, 'ACTIVE')`,
        [projectAId, orgAId, userAId],
      );
      await clientA.query('COMMIT');
    } finally {
      clientA.release();
    }

    // Seed Org B tenant records inside Org B context
    const clientB = await migratorPool.connect();
    try {
      await clientB.query('BEGIN');
      await clientB.query("SELECT set_config('app.current_org', $1, true)", [orgBId]);
      await clientB.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
         VALUES ($1, $2, $3, 'R-OWNER', 'ACTIVE')`,
        [uuidv7(), orgBId, userBId],
      );
      await clientB.query(
        `INSERT INTO projects (id, org_id, code, name, created_by, status)
         VALUES ($1, $2, 'PRJ-B', 'Beta Project', $3, 'ACTIVE')`,
        [projectBId, orgBId, userBId],
      );
      await clientB.query('COMMIT');
    } finally {
      clientB.release();
    }
  });

  afterAll(async () => {
    // Clean up seeded test records using scoped transactions
    const cleanClientA = await migratorPool.connect();
    try {
      await cleanClientA.query('BEGIN');
      await cleanClientA.query("SELECT set_config('app.current_org', $1, true)", [orgAId]);
      await cleanClientA.query(`DELETE FROM projects WHERE id = $1`, [projectAId]);
      await cleanClientA.query(`DELETE FROM memberships WHERE org_id = $1`, [orgAId]);
      await cleanClientA.query('COMMIT');
    } finally {
      cleanClientA.release();
    }

    const cleanClientB = await migratorPool.connect();
    try {
      await cleanClientB.query('BEGIN');
      await cleanClientB.query("SELECT set_config('app.current_org', $1, true)", [orgBId]);
      await cleanClientB.query(`DELETE FROM projects WHERE id = $1`, [projectBId]);
      await cleanClientB.query(`DELETE FROM memberships WHERE org_id = $1`, [orgBId]);
      await cleanClientB.query('COMMIT');
    } finally {
      cleanClientB.release();
    }

    await migratorPool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userAId, userBId]);
    await migratorPool.query(`DELETE FROM organisations WHERE id IN ($1, $2)`, [orgAId, orgBId]);
    await migratorPool.end();
    await db.getPool().end();
  });

  it('FAIL-CLOSED: Unscoped query as tc_app returns 0 rows across tenant tables', async () => {
    const pool = db.getPool();

    // Direct query without withTenantContext / set_config returns 0 rows due to FORCE RLS
    const projectsRes = await pool.query('SELECT * FROM projects');
    expect(projectsRes.rows.length).toBe(0);

    const membershipsRes = await pool.query('SELECT * FROM memberships');
    expect(membershipsRes.rows.length).toBe(0);
  });

  it('TENANT A CONTEXT: Returns only Org A records and blocks cross-tenant access', async () => {
    const ctxA: ExecutionContext = {
      orgId: orgAId,
      userId: userAId,
      actorType: 'USER',
      requestId: uuidv7(),
    };

    await db.withTenantContext(ctxA, async (client) => {
      // Should see Org A project
      const ownProjects = await client.query('SELECT * FROM projects');
      expect(ownProjects.rows.length).toBe(1);
      expect(ownProjects.rows[0].id).toBe(projectAId);
      expect(ownProjects.rows[0].code).toBe('PRJ-A');

      // Attempt to query Org B project directly by ID returns 0 rows
      const crossProject = await client.query('SELECT * FROM projects WHERE id = $1', [projectBId]);
      expect(crossProject.rows.length).toBe(0);

      // Attempt to update Org B project returns 0 affected rows
      const updateCross = await client.query(
        "UPDATE projects SET name = 'Hacked' WHERE id = $1",
        [projectBId],
      );
      expect(updateCross.rowCount).toBe(0);
    });
  });

  it('TENANT B CONTEXT: Returns only Org B records and blocks cross-tenant access', async () => {
    const ctxB: ExecutionContext = {
      orgId: orgBId,
      userId: userBId,
      actorType: 'USER',
      requestId: uuidv7(),
    };

    await db.withTenantContext(ctxB, async (client) => {
      // Should see Org B project
      const ownProjects = await client.query('SELECT * FROM projects');
      expect(ownProjects.rows.length).toBe(1);
      expect(ownProjects.rows[0].id).toBe(projectBId);
      expect(ownProjects.rows[0].code).toBe('PRJ-B');

      // Attempt to query Org A project directly by ID returns 0 rows
      const crossProject = await client.query('SELECT * FROM projects WHERE id = $1', [projectAId]);
      expect(crossProject.rows.length).toBe(0);
    });
  });

  it('CONTEXT CLEANUP: Session parameters do not leak between pooled client transactions', async () => {
    const pool = db.getPool();

    // Query immediately outside tenant context on same pool
    const res = await pool.query("SELECT current_setting('app.current_org', true) as org");
    expect(['', null]).toContain(res.rows[0].org);
  });
});
