import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertAssetInScope, validateAssetProjectScope } from '../src/modules/assets/asset-scope';
import { AssetsService } from '../src/modules/assets/assets.service';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

const orgId = '01991688-0e04-7a2d-b6ff-cfc3462a00a1';
const userId = '01991688-0e04-7a2d-b6ff-cfc3462a00a2';
const projectId = '01991688-0e04-7a2d-b6ff-cfc3462a00a3';
const allowedId = '01991688-0e04-7a2d-b6ff-cfc3462a00a4';
const hiddenId = '01991688-0e04-7a2d-b6ff-cfc3462a00a5';
const ctx: any = {
  orgId, userId, actorType: 'MEMBER', orgRole: 'R-SITE', projectRole: 'SITE',
  requestId: 'phase3-asset-test', ip: '127.0.0.1', userAgent: 'test',
};
const target = (id: string) => ({
  id, categoryKey: 'AHU', createdAt: new Date('2026-11-01T12:00:00.000Z'),
});

describe('PH3-G08-002 — live asset visibility and mutation scope', () => {
  it('denies invisible IDs and categories for both reads and mutations', () => {
    expect(() => assertAssetInScope({ assetIds: [allowedId] }, target(allowedId), true)).not.toThrow();
    expect(() => assertAssetInScope({ assetIds: [allowedId] }, target(hiddenId), false)).toThrow(NotFoundException);
    expect(() => assertAssetInScope({ assetIds: [allowedId] }, target(hiddenId), true)).toThrow(NotFoundException);
    expect(() => assertAssetInScope({ assetCategories: ['CHILLER'] }, target(allowedId), true)).toThrow(NotFoundException);
    expect(() => assertAssetInScope({ assetIds: [allowedId] }, null, true, 'AHU')).toThrow(NotFoundException);
  });

  it('rejects READ_ONLY writes, stale dates and invalid stored scope', () => {
    expect(() => assertAssetInScope({ mode: 'READ_ONLY' }, target(allowedId), true)).toThrow(ForbiddenException);
    expect(() => assertAssetInScope({ readOnly: true }, target(allowedId), false)).not.toThrow();
    expect(() => assertAssetInScope({ startDate: '2026-11-02' }, target(allowedId), false)).toThrow(NotFoundException);
    expect(() => validateAssetProjectScope({ unexpected: true })).toThrow(ForbiddenException);
    expect(() => validateAssetProjectScope({ assetIds: 'all' })).toThrow(ForbiddenException);
    expect(() => validateAssetProjectScope({ mode: 'ADMIN' })).toThrow(ForbiddenException);
    expect(() => validateAssetProjectScope({ endDate: '2026-02-30' })).toThrow(ForbiddenException);
  });

  it('reads current DB scope before retirement and never attempts an UPDATE for hidden assets', async () => {
    const sql: string[] = [];
    const query = jest.fn(async (statement: string) => {
      sql.push(statement);
      if (statement.includes('FROM memberships')) return { rows: [{ role: 'R-SITE' }] };
      if (statement.includes('FROM project_members')) return { rows: [{ scope_json: { assetIds: [allowedId] } }] };
      if (statement.includes('SELECT id, category_key, created_at FROM assets')) {
        return { rows: [{ id: hiddenId, category_key: 'AHU', created_at: new Date() }] };
      }
      return { rows: [] };
    });
    const client = { query, release: jest.fn() };
    const pool = { connect: jest.fn(async () => client) } as any;
    await expect(new AssetsService(pool).deleteOrRetireAsset(ctx, projectId, hiddenId))
      .rejects.toThrow(NotFoundException);
    expect(sql.some((statement) => statement.includes('UPDATE assets'))).toBe(false);
    expect(sql.some((statement) => statement.includes('ROLLBACK'))).toBe(true);
  });

  it('filters hidden rows before returning list results', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM memberships')) return { rows: [{ role: 'R-SITE' }] };
      if (sql.includes('FROM project_members')) return { rows: [{ scope_json: { assetIds: [allowedId] } }] };
      if (sql.includes('SELECT * FROM assets')) return { rows: [
        { id: allowedId, tag: 'AHU-1', category_key: 'AHU', created_at: new Date('2026-11-01') },
        { id: hiddenId, tag: 'AHU-2', category_key: 'AHU', created_at: new Date('2026-11-01') },
      ] };
      return { rows: [] };
    });
    const pool = { connect: jest.fn(async () => ({ query, release: jest.fn() })) } as any;
    const result = await new AssetsService(pool).listAssets(ctx, projectId);
    expect(result.map((item: any) => item.id)).toEqual([allowedId]);
  });

  it('PH3-G08-001: rolls back one shared import transaction if a later insert fails', async () => {
    let inserted = 0;
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (statement: string) => {
        statements.push(statement);
        if (statement.includes('FROM memberships')) return { rows: [{ role: 'R-OWNER' }] };
        if (statement.includes('FROM projects')) return { rows: [{ status: 'ACTIVE' }] };
        if (statement.includes('INSERT INTO assets')) {
          inserted += 1;
          if (inserted === 2) throw new Error('injected second row failure');
          return { rows: [{ id: allowedId, tag: 'AHU-01' }] };
        }
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(async () => client) } as any;
    const service = new AssetsService(pool);
    await expect(service.importAssets(
      ctx, projectId,
      [{ tag: 'AHU-01', name: 'Unit One', categoryKey: 'AHU' },
       { tag: 'AHU-02', name: 'Unit Two', categoryKey: 'AHU' }],
      false, { atomic: true, conflictStrategy: 'FAIL' },
    )).rejects.toThrow('injected second row failure');
    expect(inserted).toBe(2);
    // Preview uses a separate read transaction, but the two writes share one.
    expect(pool.connect).toHaveBeenCalledTimes(2);
    expect(statements.filter((s) => s === 'ROLLBACK')).toHaveLength(1);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(1);
  });
  it('PH3-G08-002: restricted PostgreSQL enforces live asset scope after narrowing', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const seeded = await seedTenants(admin);
      const org = seeded.tenants[0].orgId;
      const project = seeded.tenants[0].projectIds[0];
      const actor = seeded.userId;
      const allowed = uuidv7();
      const hidden = uuidv7();
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES ($1, $2, $3, 'R-SITE', 'ACTIVE')`,
        [uuidv7(), org, actor],
      );
      await admin.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, scope_json, status, added_by)
          VALUES ($1, $2, $3, $4, 'R-SITE', $5::jsonb, 'ACTIVE', $4)`,
        [uuidv7(), org, project, actor, JSON.stringify({ assetIds: [allowed] })],
      );
      for (const [id, tag] of [[allowed, 'AHU-001'], [hidden, 'AHU-002']]) {
        await admin.query(
          `INSERT INTO assets (id, org_id, project_id, tag, name, category_key, created_by)
            VALUES ($1, $2, $3, $4, 'AHU Equipment', 'AHU', $5)`,
          [id, org, project, tag, actor],
        );
      }
      const current: any = { ...ctx, orgId: org, userId: actor };
      const service = new AssetsService(app);
      const listed = await service.listAssets(current, project);
      expect(listed.map((a: any) => a.id)).toEqual([allowed]);
      await expect(service.getAsset(current, project, hidden)).rejects.toThrow(NotFoundException);
      await expect(service.deleteOrRetireAsset(current, project, hidden)).rejects.toThrow(NotFoundException);
      const hiddenRow = await admin.query(
        'SELECT status, deleted_at FROM assets WHERE org_id = $1 AND id = $2',
        [org, hidden],
      );
      expect(hiddenRow.rows[0].status).toBe('ACTIVE');
      expect(hiddenRow.rows[0].deleted_at).toBeNull();

      // A scope change after an earlier successful read must apply to the
      // next transaction; previous guard/context snapshots are not authority.
      await admin.query(
        `UPDATE project_members SET scope_json = $4::jsonb
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3`,
        [org, project, actor, JSON.stringify({ assetIds: [hidden] })],
      );
      await expect(service.deleteOrRetireAsset(current, project, allowed)).rejects.toThrow(NotFoundException);
      const narrowed = await service.listAssets(current, project);
      expect(narrowed.map((a: any) => a.id)).toEqual([hidden]);
    });
  });

});
