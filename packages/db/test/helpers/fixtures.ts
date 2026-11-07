import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

export async function seedTenants(admin: Pool) {
  const userId = randomUUID();
  await admin.query(`INSERT INTO users (id, name, status) VALUES ($1, 'Test owner', 'ACTIVE')`, [userId]);
  const tenants: { orgId: string; projectIds: string[] }[] = [];
  for (const label of ['A', 'B']) {
    const orgId = randomUUID();
    await admin.query(`INSERT INTO organisations (id, legal_name, display_name, state) VALUES ($1, $2, $2, 'MH')`, [orgId, `Tenant ${label}`]);
    const projectIds = [randomUUID(), randomUUID()];
    for (const [index, projectId] of projectIds.entries()) {
      await admin.query(`INSERT INTO projects (id, org_id, code, name, created_by, status) VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [projectId, orgId, `PROJECT_${index}`, `Project ${label}${index}`, userId]);
    }
    tenants.push({ orgId, projectIds });
  }
  return { userId, tenants };
}

export async function scoped<T>(pool: Pool, orgId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [orgId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
