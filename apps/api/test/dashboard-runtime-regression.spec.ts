import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';

jest.setTimeout(180_000);

test('dashboard executes real scoped and org-wide queries and computes retention from the migrated schema', async () => {
  await withDisposableDatabase(async ({ admin, app }) => {
    const orgId = uuidv7(), otherOrgId = uuidv7(), userId = uuidv7();
    const projectId = uuidv7(), hiddenProjectId = uuidv7();
    await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'Dashboard reviewer','ACTIVE')`, [userId]);
    for (const id of [orgId, otherOrgId]) {
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state) VALUES($1,'Dashboard Test','Dashboard Test','TS')`, [id]);
    }
    await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')`, [uuidv7(), orgId, userId]);
    for (const id of [projectId, hiddenProjectId]) {
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by,contract_value_paise,retention_bps)
        VALUES($1,$2,$3,'Dashboard Project','ACTIVE',$4,100000,500)`, [id,orgId,id === projectId ? 'DASH-01' : 'DASH-02',userId]);
    }
    await admin.query(`INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by)
      VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$4)`, [uuidv7(),orgId,projectId,userId]);
    const service = new OrganisationsService(app);
    const ctx = { orgId,userId,orgRole:'R-OWNER',actorType:'MEMBER' as const,requestId:uuidv7(),ip:'127.0.0.1',userAgent:'dashboard-regression' };
    const dashboard = await service.getDashboard(ctx, 'current');
    expect(dashboard.projects).toHaveLength(2);
    expect(dashboard.kpis.totalRetentionAtRiskPaise).toBe('10000');
    await admin.query(`INSERT INTO contracts(id,org_id,project_id,value_paise,retention_bps,status)
      VALUES($1,$2,$3,200000,1000,'ACTIVE'),($4,$2,$3,999999,1000,'SUPERSEDED')`, [uuidv7(),orgId,projectId,uuidv7()]);
    const scoped = await service.getDashboard({ ...ctx,orgRole:'R-SITE' }, 'current');
    expect(scoped.projects.map(project => project.id)).toEqual([projectId]);
    expect(scoped.kpis.totalRetentionAtRiskPaise).toBe('20000');
    await expect(service.getDashboard(ctx,otherOrgId)).rejects.toThrow('ORGANISATION_NOT_FOUND');
    await expect(service.getDashboard({ ...ctx,guestGrantId:uuidv7() },'current')).rejects.toThrow('ORGANISATION_NOT_FOUND');
  });
});
