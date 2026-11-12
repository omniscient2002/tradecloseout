import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { TenantDbService } from '../src/database/tenant-db.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);

describe('PH2-G20-009 / G05-001: financial exposure and actual overdue indicators', () => {
  it('uses exact active contracts, excludes future/superseded work, and never invents money withheld', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId=uuidv7(), owner=uuidv7(), other=uuidv7();
      await admin.query(
        `INSERT INTO users(id,name,status)
           VALUES ($1,'Commercial owner','ACTIVE'),($2,'Other member','ACTIVE')`,
        [owner,other],
      );
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state)
           VALUES ($1,'Digest Test Tenant','Digest Test Tenant','AP')`,
        [orgId],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
         VALUES ($1,$2,$3,'R-OWNER','ACTIVE'),($4,$2,$5,'R-SITE','ACTIVE')`,
        [uuidv7(),orgId,owner,uuidv7(),other],
      );
      const ctx: any={
        orgId,userId:owner,orgRole:'R-OWNER',actorType:'MEMBER',requestId:uuidv7(),
        ip:'127.0.0.1',userAgent:'phase2-owner-digest',
      };
      const service=new ProjectsService(app);
      const project=await service.createProject(ctx,{
        code:'PH2-DIGEST',name:'Exact digest commercial data',
        contractValuePaise:'123456789012345678',
      });
      const digest=new NotificationsService(new TenantDbService(app));
      const ownerCtx:any={orgId,userId:owner,orgRole:'R-OWNER',actorType:'USER',requestId:uuidv7()};
      const first=await digest.getOwnerDigest(ownerCtx,project.projectId);
      const dashboard=await service.getProjectDashboard(ctx,project.projectId);
      expect(first.contractValuePaise).toBe('123456789012345678');
      expect(first.contractValueInr).toBeNull(); // never truncate unsafe integer INR
      expect(first.financialSummaryBasis).toBe('PROJECT_ESTIMATE');
      expect(first.retentionMoneyGatedPaise).toBeNull();
      expect(first.informationalRetentionExposurePaise).toBe(dashboard.retentionAtRiskPaise);

      const snapshotId=uuidv7();
      await admin.query(
        `INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,status,
          resolved_payload_json,provenance_json,source_json,checksum,created_by)
         VALUES($1,$2,$3,1,'ACTIVE','{}','{}','{}',$4,$5)`,
        [snapshotId,orgId,project.projectId,'test-checksum',owner],
      );
      const entries=[
        ['FUTURE','NOT_STARTED','7 days'],
        ['LATE','NOT_STARTED','-2 days'],
        ['MARKED-EXPIRED','EXPIRED','7 days'],
        ['WAIVED','WAIVED','-2 days'],
        ['CLOSED','APPROVED','-2 days'],
        ['SUPERSEDED','EXPIRED','-2 days'],
      ] as const;
      for(const [key,status,offset] of entries) {
        await admin.query(
          `INSERT INTO requirements(id,org_id,project_id,current_snapshot_id,requirement_key,
            group_key,title,doc_type_key,milestone_key,mandatory,due_at,status,superseded_at)
           VALUES($1,$2,$3,$4,$5,'TEST',$5,'DT-001','HANDOVER',true,
             now()+($6::text)::interval,$7,
             CASE WHEN $5='SUPERSEDED' THEN now() ELSE NULL END)`,
          [uuidv7(),orgId,project.projectId,snapshotId,key,offset,status],
        );
      }
      const qualified=await digest.getOwnerDigest(ownerCtx,project.projectId);
      expect(qualified.overdueOrExpiredRequirementsByMilestone).toEqual([
        expect.objectContaining({milestone_key:'HANDOVER',count:2}),
      ]);

      await service.createContract(ctx,project.projectId,{
        contractRef:'BIG',title:'Confirmed package',valuePaise:60000000000000000n,retentionBps:250,
      });
      await service.createContract(ctx,project.projectId,{
        contractRef:'SMALL',title:'Small package',valuePaise:10000n,retentionBps:1000,
      });
      const active=await digest.getOwnerDigest(ownerCtx,project.projectId);
      const current=await service.getProjectDashboard(ctx,project.projectId);
      expect(active.financialSummaryBasis).toBe('ACTIVE_CONTRACTS');
      expect(active.contractValuePaise).toBe('60000000000010000');
      expect(active.informationalRetentionExposurePaise).toBe('1500000000001000');
      expect(active.informationalRetentionExposurePaise).toBe(current.retentionAtRiskPaise);
      expect(active.retentionMoneyGatedPaise).toBeNull();

      const unpriced=await service.createContract(ctx,project.projectId,{
        contractRef:'UNPRICED',title:'Unpriced pending package',
      });
      expect(unpriced.value_paise).toBeNull();
      const unknown=await digest.getOwnerDigest(ownerCtx,project.projectId);
      expect(unknown.financialSummaryBasis).toBe('UNKNOWN');
      expect(unknown.contractValuePaise).toBeNull();
      expect(unknown.informationalRetentionExposurePaise).toBeNull();
      expect((await service.getProjectDashboard(ctx,project.projectId)).retentionAtRiskPaise)
        .toBeNull();

      await admin.query(
        `INSERT INTO project_members(id,org_id,project_id,user_id,role,added_by)
          VALUES($1,$2,$3,$4,'R-SITE',$5)`,
        [uuidv7(),orgId,project.projectId,other,owner],
      );
      // Project list/detail are distinct HTTP surfaces from the dashboard:
      // arbitrary settings_json and site_json must not reveal financial data
      // through a shared project.read grant.
      await admin.query(
        `UPDATE projects
          SET settings_json=$2::jsonb,site_json=$3::jsonb
          WHERE id=$1`,
        [project.projectId,
          JSON.stringify({ internal_contract_value_paise:'SECRET-CONTRACT-DO-NOT-EXPOSE' }),
          JSON.stringify({ retention_percent:'SECRET-RETENTION-DO-NOT-EXPOSE' })],
      );
      const siteCtx:any={
        ...ctx,userId:other,orgRole:'R-SITE',projectRole:'R-SITE',
        projectId:project.projectId,requestId:uuidv7(),
      };
      const listed=await service.listProjects(siteCtx);
      const row=listed.find((item:any)=>item.id===project.projectId);
      expect(row).toBeDefined();
      expect(row.contractValuePaise).toBeNull();
      expect(row.contract_value_paise).toBeNull();
      expect(JSON.stringify(row)).not.toContain('SECRET-');
      expect(JSON.stringify(row)).not.toContain('60000000000010000');

      const restrictedDetail=await service.getProject(siteCtx,project.projectId);
      expect(restrictedDetail.contract_value_paise).toBeNull();
      expect(restrictedDetail.site_json).toEqual({});
      expect(restrictedDetail.settings_json).toEqual({});
      expect(JSON.stringify(restrictedDetail)).not.toContain('SECRET-');

      const ownerDetail=await service.getProject(ctx,project.projectId);
      expect(ownerDetail.contract_value_paise).toBe('123456789012345678');
      expect(ownerDetail.settings_json).toMatchObject({
        internal_contract_value_paise:'SECRET-CONTRACT-DO-NOT-EXPOSE',
      });

      const siteView = await service.getProjectDashboard({
        ...ctx,userId:other,orgRole:'R-SITE',projectRole:'R-SITE',projectId:project.projectId,
        requestId:uuidv7(),
      },project.projectId);
      expect(siteView.counts).toBeDefined(); // project progress remains visible
      expect(siteView.contractValuePaise).toBeNull();
      expect(siteView.retentionAtRiskPaise).toBeNull();
      expect(siteView.financialSummaryBasis).toBe('RESTRICTED');

      await expect(digest.getOwnerDigest({...ownerCtx,userId:other,orgRole:'R-SITE'},project.projectId))
        .rejects.toMatchObject({response:expect.objectContaining({code:'OWNER_DIGEST_RESTRICTED'})});
    });
  });
});
