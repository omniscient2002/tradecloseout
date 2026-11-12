import { BadRequestException, NotFoundException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { WorkItemsService } from '../src/modules/work-items/work-items.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

describe('PH3-G21-001/004/006 — actionable work queue resource isolation', () => {
  it('scopes both items and totals to the current actor after membership narrowing', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const fixture = await seedTenants(admin);
      const orgId = fixture.tenants[0].orgId;
      const projectId = fixture.tenants[0].projectIds[0];
      const userId = fixture.userId;
      const assetA = uuidv7();
      const assetB = uuidv7();
      const defectA = uuidv7();
      const defectB = uuidv7();
      const ctx: any = { orgId, userId, orgRole: 'R-OWNER', projectRole: 'R-PM',
        actorType: 'MEMBER', requestId: 'phase3-work-r19' };

      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status)
          VALUES ($1,$2,$3,'R-SITE','ACTIVE')`,
        [uuidv7(),orgId,userId],
      );
      await admin.query(
        `INSERT INTO project_members
          (id,org_id,project_id,user_id,role,scope_json,status,added_by)
          VALUES ($1,$2,$3,$4,'R-SITE',$5::jsonb,'ACTIVE',$4)`,
        [uuidv7(),orgId,projectId,userId,JSON.stringify({ assetIds: [assetA] })],
      );
      for (const [asset, tag] of [[assetA,'AHU-ONE'],[assetB,'AHU-TWO']]) {
        await admin.query(
          `INSERT INTO assets (id,org_id,project_id,tag,name,category_key,created_by)
            VALUES ($1,$2,$3,$4,'Air handling unit','AHU',$5)`,
          [asset,orgId,projectId,tag,userId],
        );
      }
      for (const [defect,asset,tag] of [
        [defectA,assetA,'AHU-ONE'],[defectB,assetB,'AHU-TWO'],
      ]) {
        await admin.query(
          `INSERT INTO defects
             (id,org_id,project_id,asset_id,title,description,status,severity,
              raised_by,assigned_user_id,due_at)
           VALUES ($1,$2,$3,$4,$5,'Needs remedy','OPEN','HIGH',$6,$6,$7)`,
          [defect,orgId,projectId,asset,tag,userId,'2026-12-03T00:00:00.000Z'],
        );
      }
      const service = new WorkItemsService(app);
      const first = await service.listWorkItems(ctx, { type: 'DEFECT_ACTION', limit: 1 });
      expect(first.counts).toMatchObject({
        total: 1, defects: 1, reviews: 0, supplierObligations: 0,
      });
      expect(first.items.map((item) => item.entityId)).toEqual([defectA]);
      expect(first.pagination.hasMore).toBe(false);
      expect(first.items[0].entityVersion).toBe(1);
      expect(first.items[0].dueAt).toBeTruthy();
      expect(first.items[0].nextCommand.path).toContain(defectA);
      expect(JSON.stringify(first)).not.toContain('AHU-TWO');
      expect(JSON.stringify(first)).not.toContain(defectB);

      // Remove the restriction and verify deterministic pagination before
      // narrowing it again; counts and items must use the SAME scoped set.
      await admin.query(
        `UPDATE project_members SET scope_json = '{}'::jsonb
           WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
        [orgId,projectId,userId],
      );
      const unscoped = await service.listWorkItems(ctx, { type:'DEFECT_ACTION', limit:1 });
      expect(unscoped.counts.total).toBe(2);
      expect(unscoped.pagination.hasMore).toBe(true);
      const secondPage = await service.listWorkItems(ctx, { type:'DEFECT_ACTION', limit:1, offset:1 });
      expect(secondPage.counts.total).toBe(2);
      expect(secondPage.items).toHaveLength(1);
      expect(new Set([unscoped.items[0].entityId,secondPage.items[0].entityId]).size).toBe(2);

      await admin.query(
        `UPDATE project_members SET scope_json = $4::jsonb
           WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
        [orgId,projectId,userId,JSON.stringify({ assetIds:[assetB] })],
      );
      const narrowed = await service.listWorkItems(ctx,{});
      expect(narrowed.counts.total).toBe(1);
      expect(narrowed.items.map((item) => item.entityId)).toEqual([defectB]);
      // A forged stale owner JWT must not widen current R-SITE permissions.

      await admin.query(
        `UPDATE project_members SET scope_json = $4::jsonb
           WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
        [orgId,projectId,userId,JSON.stringify({ assetIds:[assetB], readOnly:true })],
      );
      const readOnly = await service.listWorkItems(ctx,{});
      expect(readOnly).toMatchObject({ items: [], counts:{ total:0, defects:0 } });

      await admin.query(
        `UPDATE project_members SET scope_json = '{}'::jsonb, status='REMOVED'
           WHERE org_id=$1 AND project_id=$2 AND user_id=$3`,
        [orgId,projectId,userId],
      );
      const revoked = await service.listWorkItems(ctx,{});
      expect(revoked).toMatchObject({ items: [], counts:{ total:0 } });
      await expect(service.listWorkItems({ ...ctx, actorType:'GUEST', guestGrantId: uuidv7() },{}))
        .rejects.toThrow(NotFoundException);
    });
  });

  it('rejects malformed filters without querying any tenant data', async () => {
    const pool = { connect: jest.fn() } as any;
    const service = new WorkItemsService(pool);
    const ctx: any = { orgId: uuidv7(), userId: uuidv7(), actorType: 'MEMBER' };
    await expect(service.listWorkItems(ctx, { limit: Number.NaN })).rejects.toThrow(BadRequestException);
    await expect(service.listWorkItems(ctx, { offset: -1 })).rejects.toThrow(BadRequestException);
    await expect(service.listWorkItems(ctx, { projectId: '../other' })).rejects.toThrow(BadRequestException);
    await expect(service.listWorkItems(ctx, { type: 'INTERNAL_SECRET' })).rejects.toThrow(BadRequestException);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
