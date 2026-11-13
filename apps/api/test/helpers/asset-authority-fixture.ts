/** Explicit authority fixtures for older domain-only unit tests. Real authority/race
 * assertions live in phase1-next-asset-authority.spec.ts against restricted PG. */
export function withAssetAuthorityFixture(pool: any): any {
  return { ...pool, connect: async () => {
    const client = await pool.connect();
    return { ...client, query: async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT m.role AS org_role FROM users u JOIN memberships')) return { rows: [{ org_role: 'R-OWNER' }] };
      if (sql.startsWith('SELECT status FROM projects')) return { rows: [{ status: 'ACTIVE' }] };
      if (sql.includes('SELECT id,category_key,created_at FROM assets')) return { rows: [{ id: params?.[2], category_key: 'AHU', created_at: new Date() }] };
      return client.query(sql, params);
    } };
  } };
}
