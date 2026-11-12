import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { OrganisationsService } from '../src/modules/organisations/organisations.service';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';

jest.setTimeout(180_000);

describe('PH2-G03/G05: organisation dashboard has live scoped, financial-safe projections', () => {
  it('preserves owner-wide SQL, scopes site projects and revokes stale owner access', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const orgId=uuidv7(), owner=uuidv7(), site=uuidv7(), one=uuidv7(), two=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status)
        VALUES($1,'Dashboard owner','ACTIVE'),($2,'Dashboard site','ACTIVE')`,[owner,site]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Phase 2 Dashboard Tenant','Phase 2 Dashboard Tenant','AP')`,[orgId]);
      const ownerMembership=uuidv7();
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE'),($4,$2,$5,'R-SITE','ACTIVE')`,
        [ownerMembership,orgId,owner,uuidv7(),site]);
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by,contract_value_paise)
        VALUES($1,$2,'PH2-DASH-A','Assigned project','ACTIVE',$3,10000),
              ($4,$2,'PH2-DASH-B','Private project','ACTIVE',$3,20000)`,
        [one,orgId,owner,two]);
      await admin.query(`INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by)
        VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$5)`,
        [uuidv7(),orgId,one,site,owner]);
      const service=new OrganisationsService(app);
      const ctx=(userId:string,orgRole:string):TenantActorContext=>({
        orgId,userId,orgRole,actorType:'MEMBER',requestId:uuidv7(),
        ip:'127.0.0.1',userAgent:'phase2-org-dashboard',
      });
      // Full-tenant queries have only one SQL parameter. The old implementation
      // supplied two and PostgreSQL could reject the bind message.
      const ownerView=await service.getDashboard(ctx(owner,'R-OWNER'),'current');
      expect(ownerView.projects).toHaveLength(2);
      expect(ownerView.projects.map((p:any)=>p.contractValuePaise)).toEqual(
        expect.arrayContaining(['10000','20000']),
      );
      expect(ownerView.kpis.totalRetentionAtRiskPaise).not.toBeNull();

      const siteView=await service.getDashboard(ctx(site,'R-SITE'),'current');
      expect(siteView.projects).toHaveLength(1);
      expect(siteView.projects[0]?.id).toBe(one);
      expect(siteView.projects[0]?.contractValuePaise).toBeNull();
      expect(siteView.projects[0]?.retentionAtRiskPaise).toBeNull();
      expect(siteView.kpis.totalRetentionAtRiskPaise).toBeNull();

      await admin.query(`UPDATE memberships SET role='R-SITE' WHERE id=$1`,[ownerMembership]);
      const stale=await service.getDashboard(ctx(owner,'R-OWNER'),'current');
      expect(stale.projects).toHaveLength(0);
      expect(stale.kpis.totalRetentionAtRiskPaise).toBeNull();
      await expect(service.getDashboard(ctx(site,'R-SITE'),uuidv7())).rejects.toThrow();
    });
  });
});
