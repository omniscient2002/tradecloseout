import { randomUUID } from 'node:crypto';
import { firstValueFrom, from } from 'rxjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { organisations, orgProfiles } from '@tradecloseout/db';
import { IdempotencyInterceptor } from '../src/common/interceptors/idempotency.interceptor';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants, scoped } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120000);
it('queries the corrected organisation/profile ORM projections against actual migrated PostgreSQL', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { tenants: [a] } = await seedTenants(admin);
    await admin.query('INSERT INTO org_profiles(org_id) VALUES($1)', [a.orgId]);
    await admin.query('UPDATE organisations SET doc_controller_org_wide_download=true WHERE id=$1', [a.orgId]);
    await scoped(app, a.orgId, async client => {
      const db = drizzle(client);
      const orgs = await db.select().from(organisations);
      expect(orgs.find(row => row.id === a.orgId)?.docControllerOrgWideDownload).toBe(true);
      const profiles = await db.select().from(orgProfiles);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].orgId).toBe(a.orgId);
    });
  });
});

it('retains a command claim after a real domain COMMIT whose acknowledgement is lost', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const { userId, tenants: [a] } = await seedTenants(admin);
    const key = randomUUID(); const projectId = a.projectIds[0];
    const req = { method: 'POST', headers: { 'idempotency-key': key }, baseUrl: '/api/v1', route: { path: '/fixture' },
      body: {}, params: {}, auth: { activeOrgId: a.orgId, userId } };
    const context = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode: 201 }) }), getHandler: () => ({}), getClass: () => ({}) } as any;
    const interceptor = new IdempotencyInterceptor(app, { getAllAndOverride: () => false } as any);
    const lostAck = new Error('INJECTED_COMMIT_ACK_LOSS');
    const handler = { handle: jest.fn(() => from((async () => {
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)", [a.orgId]);
        await client.query('UPDATE projects SET row_version=row_version+1 WHERE id=$1', [projectId]);
        await client.query('COMMIT');
        throw lostAck; // domain commit completed; HTTP handler cannot observe its acknowledgement
      } finally { client.release(true); }
    })())) };
    await expect(firstValueFrom(await interceptor.intercept(context, handler))).rejects.toBe(lostAck);
    await admin.query("UPDATE idempotency_keys SET expires_at=now()-interval '1 day' WHERE key=$1", [key]);
    await expect(interceptor.intercept(context, handler)).rejects.toMatchObject({ response: { code: 'REQUEST_IN_PROGRESS' } });
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect((await admin.query('SELECT row_version FROM projects WHERE id=$1', [projectId])).rows[0].row_version).toBe(2);
    expect((await admin.query('SELECT response_status FROM idempotency_keys WHERE key=$1', [key])).rows).toEqual([{ response_status: 0 }]);
  });
});
