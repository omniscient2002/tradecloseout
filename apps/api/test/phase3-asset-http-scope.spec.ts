import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { AssetsController } from '../src/modules/assets/assets.controller';
import { AssetsService } from '../src/modules/assets/assets.service';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

/**
 * HTTP contract for PH3-G08-002 with a deliberately pre-authorized, stale
 * request context. Authn/authz guard verification is owned by G01/G02; this
 * test proves that routing cannot bypass the service's live DB authority.
 */
describe('PH3-G08-002 HTTP routes — asset scope and live revocation', () => {
  it('hides unknown and out-of-scope assets across read and write routes', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const userId = fixture.userId;
      const visibleId = uuidv7();
      const hiddenId = uuidv7();
      const actor: any = {
        orgId, userId, actorType: 'MEMBER', orgRole: 'R-SITE',
        projectRole: 'R-SITE', requestId: 'phase3-asset-http',
        ip: '127.0.0.1', userAgent: 'phase3-asset-http-test',
      };
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
           VALUES ($1, $2, $3, 'R-SITE', 'ACTIVE')`,
        [uuidv7(), orgId, userId],
      );
      await admin.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id,
             role, scope_json, status, added_by)
           VALUES ($1, $2, $3, $4, 'R-SITE', $5::jsonb, 'ACTIVE', $4)`,
        [uuidv7(), orgId, projectId, userId, JSON.stringify({ assetIds: [visibleId] })],
      );
      for (const [id, tag] of [[visibleId, 'AHU-VISIBLE'], [hiddenId, 'AHU-HIDDEN']]) {
        await admin.query(
          `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
             VALUES ($1, $2, $3, $4, 'Air handling unit', 'AHU', $5)`,
          [id, orgId, projectId, tag, userId],
        );
      }

      const testModule = await Test.createTestingModule({
        controllers: [AssetsController],
        providers: [
          { provide: AssetsService, useValue: new AssetsService(app) },
        ],
      })
        // Guard classes from @UseGuards are registered as enhancers by Nest;
        // override their actual enhancer tokens rather than adding providers.
        .overrideGuard(SessionCsrfGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().userContext = actor;
            return true;
          },
        })
        // Simulate a previously successful guard decision. The service must
        // recheck the current DB role and scope inside the transaction.
        .overrideGuard(PermissionGuard)
        .useValue({ canActivate: () => true })
        .compile();
      const httpApp = testModule.createNestApplication();
      try {
        await httpApp.listen(0, '127.0.0.1');
        const address = httpApp.getHttpServer().address() as AddressInfo;
        const base = `http://127.0.0.1:${address.port}/api/v1/projects/${projectId}/assets`;
        const call = (route: string, method = 'GET', body?: unknown) =>
          fetch(base + route, {
            method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });

        const listed = await call('');
        expect(listed.status).toBe(200);
        expect((await listed.json() as any[]).map((a: any) => a.id)).toEqual([visibleId]);

        const exported = await call('/export');
        expect(exported.status).toBe(200);
        expect((await exported.json() as any).data.map((a: any) => a.id)).toEqual([visibleId]);

        const matched = await call('/match-candidates', 'POST', {
          text: 'AHU-VISIBLE AHU-HIDDEN',
        });
        expect(matched.status).toBe(201);
        const matches = await matched.json() as any;
        expect(matches.totalMatches).toBe(1);
        expect(matches.candidates.map((a: any) => a.assetId)).toEqual([visibleId]);

        for (const route of [
          `/${hiddenId}`, `/${hiddenId}/history`,
          `/${hiddenId}/passport`,
        ]) {
          expect((await call(route)).status).toBe(404);
        }
        expect((await call(`/${hiddenId}`, 'PATCH', { name: 'Unauthorized' })).status).toBe(404);
        expect((await call(`/${hiddenId}`, 'DELETE')).status).toBe(404);
        expect((await call(
          `/${hiddenId}/revalidations/${uuidv7()}`, 'PATCH',
          { status: 'CONFIRMED', expectedRowVersion: 1 },
        )).status).toBe(404);
        expect((await call('/import?dryRun=true', 'POST', {
          items: [{ tag: 'AHU-NEW', name: 'Not permitted', categoryKey: 'AHU' }],
        })).status).toBe(404);

        // Live revocation of the previously allowed asset must win over the
        // stale session/guard result across every exposed endpoint.
        await admin.query(
          `UPDATE project_members SET scope_json = $4::jsonb
             WHERE org_id = $1 AND project_id = $2 AND user_id = $3`,
          [orgId, projectId, userId, JSON.stringify({ assetIds: [hiddenId] })],
        );
        expect((await call(`/${visibleId}`)).status).toBe(404);
        expect((await call(`/${visibleId}`, 'DELETE')).status).toBe(404);
        expect((await call(`/${hiddenId}`)).status).toBe(200);

        await admin.query(
          `UPDATE project_members SET scope_json = $4::jsonb
             WHERE org_id = $1 AND project_id = $2 AND user_id = $3`,
          [orgId, projectId, userId,
            JSON.stringify({ assetIds: [hiddenId], mode: 'READ_ONLY' })],
        );
        expect((await call(`/${hiddenId}`)).status).toBe(200);
        expect((await call(`/${hiddenId}`, 'PATCH', { name: 'Unauthorized' })).status).toBe(403);
        expect((await call(`/${hiddenId}`, 'DELETE')).status).toBe(403);

        await admin.query(
          `UPDATE memberships SET role = 'R-REVIEWER'
             WHERE org_id = $1 AND user_id = $2`, [orgId, userId],
        );
        await admin.query(
          `UPDATE project_members
             SET role = 'R-REVIEWER', scope_json = $4::jsonb
             WHERE org_id = $1 AND project_id = $2 AND user_id = $3`,
          [orgId, projectId, userId, JSON.stringify({ assetIds: [hiddenId] })],
        );
        expect((await call(`/${hiddenId}`)).status).toBe(200);
        expect((await call(`/${hiddenId}`, 'DELETE')).status).toBe(403);
        const preserved = await admin.query(
          'SELECT status, deleted_at, name FROM assets WHERE org_id = $1 AND id = $2',
          [orgId, hiddenId],
        );
        expect(preserved.rows[0].status).toBe('ACTIVE');
        expect(preserved.rows[0].deleted_at).toBeNull();
        expect(preserved.rows[0].name).toBe('Air handling unit');
      } finally {
        await httpApp.close();
      }
    });
  });
});
