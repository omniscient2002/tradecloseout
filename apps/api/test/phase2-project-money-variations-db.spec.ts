import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import type { TenantActorContext } from '@tradecloseout/db/tenant-tx';
import { ProjectsService } from '../src/modules/projects/projects.service';

jest.setTimeout(180_000);

describe('PH2-G05-001/002/005 canonical money and variation integrity', () => {
  it('preserves unknown, zero and large exact paise, and never auto-approves a variation', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId = uuidv7(), owner = uuidv7();
      await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'Finance owner','ACTIVE')`, [owner]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
        VALUES($1,'Phase2 Money Tenant','Phase2 Money Tenant','AP','ACTIVE')`, [orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE')`, [uuidv7(),orgId,owner]);

      const ctx: TenantActorContext = {
        orgId,userId:owner,actorType:'MEMBER',requestId:uuidv7(),
        ip:'127.0.0.1',userAgent:'phase2-contract-test',orgRole:'R-OWNER',
      };
      const service = new ProjectsService(app);
      const zero = await service.createProject(ctx,{
        code:'PH2-ZERO',name:'Explicit zero contract',contractValuePaise:'0',
      });
      const large = await service.createProject(ctx,{
        code:'PH2-LARGE',name:'Large integer contract',contractValuePaise:'123456789012345678',
      });
      const unknown = await service.createProject(ctx,{
        code:'PH2-UNKNOWN',name:'Unknown contract amount',
      });

      expect((await service.getProject(ctx,zero.projectId)).contract_value_paise).toBe('0');
      expect((await service.getProject(ctx,large.projectId)).contract_value_paise).toBe('123456789012345678');
      expect((await service.getProject(ctx,unknown.projectId)).contract_value_paise).toBeNull();

      const directory = await service.listProjects(ctx);
      expect(directory.find((project: any) => project.id === zero.projectId)?.contractValuePaise).toBe('0');
      expect(directory.find((project: any) => project.id === large.projectId)?.contractValuePaise)
        .toBe('123456789012345678');
      expect(directory.find((project: any) => project.id === unknown.projectId)?.contractValuePaise).toBeNull();

      // With no contract register records the dashboard uses the exact
      // canonical project value and retention basis points, not settings JSON.
      const summary = await service.getProjectDashboard(ctx,large.projectId);
      expect(summary.retentionAtRiskPaise).toBe(
        ((123456789012345678n * 500n) / 10000n).toString(),
      );

      const contract = await service.createContract(ctx,large.projectId,{
        contractRef:'MAIN-01',title:'Main mechanical package',valuePaise:500000n,
      });
      const variation = await service.createVariation(ctx,large.projectId,contract.id,{
        variationRef:'VAR-DRAFT-01',title:'Proposed valve change',
        costDeltaPaise:-200n,
      });
      expect(variation.status).toBe('DRAFT');
      expect(variation.approved_by).toBeNull();
      expect(variation.scope_delta_json).toEqual({});
      const {rows:[persisted]} = await admin.query(
        `SELECT status,approved_by,cost_delta_paise,scope_delta_json
           FROM variations WHERE org_id=$1 AND id=$2`,[orgId,variation.id],
      );
      expect(persisted).toMatchObject({
        status:'DRAFT',approved_by:null,cost_delta_paise:'-200',scope_delta_json:{},
      });

      const updated = await service.updateProject(ctx,large.projectId,{
        name:'Large integer contract amended',
      });
      expect(updated.name).toBe('Large integer contract amended');
      const specification = await service.createSpecification(ctx,large.projectId,{
        specNumber:'SPEC-001',title:'Reviewed mechanical specification',
      });
      expect(specification.spec_number).toBe('SPEC-001');
      // Domain events and immutable audit rows are created in the SAME
      // committed tenant transaction as each commercial/metadata mutation.
      const { rows: audit } = await admin.query(
        `SELECT action,COUNT(*)::int AS count FROM audit_events
          WHERE org_id=$1 AND project_id=$2 AND action=ANY($3::text[])
          GROUP BY action`,
        [orgId,large.projectId,[
          'PROJECT_METADATA_UPDATED','CONTRACT_CREATED',
          'VARIATION_DRAFT_CREATED','PROJECT_SPECIFICATION_ADDED',
        ]],
      );
      expect(Object.fromEntries(audit.map((row: any) => [row.action,row.count]))).toEqual({
        PROJECT_METADATA_UPDATED:1,CONTRACT_CREATED:1,
        VARIATION_DRAFT_CREATED:1,PROJECT_SPECIFICATION_ADDED:1,
      });

      // A globally valid foreign party ID is not authority to link another
      // organisation's commercial records to this project.
      const foreignOrg=uuidv7(),foreignParty=uuidv7();
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Foreign Owner','Foreign Owner','KA')`,[foreignOrg]);
      await admin.query(`INSERT INTO parties(id,org_id,name,types)
        VALUES($1,$2,'Foreign Supplier',ARRAY['SUPPLIER']::text[])`,[foreignParty,foreignOrg]);
      await expect(service.createContract(ctx,large.projectId,{
        contractRef:'FOREIGN-01',title:'Wrong tenant contract',partyId:foreignParty,
      })).rejects.toThrow('CONTRACT_PARTY_NOT_FOUND');
      await expect(service.createContract(ctx,large.projectId,{
        contractRef:'BAD-RET',title:'Invalid retention',retentionBps:10001,
      })).rejects.toMatchObject({
        response:expect.objectContaining({code:'INVALID_RETENTION_BPS'}),
      });
      await expect(service.createSpecification(ctx,large.projectId,{
        specNumber:'BAD-DOC',title:'Unverified document link',documentId:uuidv7(),
      })).rejects.toThrow('SPECIFICATION_DOCUMENT_NOT_FOUND');

      // A replayed successful handover is a no-op, not another lifecycle
      // transition, version increment or outbox/audit event.
      await admin.query(`UPDATE projects SET status='ACTIVE' WHERE id=$1`,[large.projectId]);
      const previousVersion = Number((await admin.query(
        'SELECT row_version FROM projects WHERE id=$1',[large.projectId],
      )).rows[0].row_version);
      expect(await service.handoverProject(ctx,large.projectId)).toMatchObject({
        projectId:large.projectId,status:'HANDOVER',
      });
      expect(await service.handoverProject(ctx,large.projectId)).toMatchObject({
        projectId:large.projectId,status:'HANDOVER',
      });
      const { rows: [handoverState] }=await admin.query(
        'SELECT status,row_version FROM projects WHERE id=$1',[large.projectId],
      );
      expect(handoverState).toMatchObject({
        status:'HANDOVER',row_version:previousVersion+1,
      });
      expect((await admin.query(
        `SELECT COUNT(*)::int AS n FROM audit_events
          WHERE org_id=$1 AND project_id=$2 AND action='PROJECT_HANDOVER_INITIATED'`,
        [orgId,large.projectId],
      )).rows[0].n).toBe(1);

      await expect(service.createContract(ctx,large.projectId,{
        contractRef:'LATE-01',title:'Handover contract mutation',
      })).rejects.toMatchObject({
        response:expect.objectContaining({code:'PROJECT_COMMERCIAL_WRITES_LOCKED'}),
      });
      await expect(service.updateProject(ctx,large.projectId,{name:'Unsafe handover edit'}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'PROJECT_IMMUTABLE'})});

      await expect(service.createVariation(ctx,large.projectId,contract.id,{
        variationRef:'VAR-INVALID',title:'Invalid scope',costDeltaPaise:1n,
        scopeDeltaJson:[] as any,
      })).rejects.toMatchObject({
        response:expect.objectContaining({code:'INVALID_VARIATION_SCOPE'}),
      });
    });
  });

  it('rejects imprecise and invalid money, project names and calendar dates before SQL', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const orgId=uuidv7(), owner=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'Owner','ACTIVE')`,[owner]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
        VALUES($1,'Validation Tenant','Validation Tenant','AP','ACTIVE')`,[orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,owner]);
      const ctx:TenantActorContext={orgId,userId:owner,actorType:'MEMBER',
        requestId:uuidv7(),ip:'127.0.0.1',userAgent:'phase2',orgRole:'R-OWNER'};
      const service=new ProjectsService(app);
      for(const invalid of ['-1','12.4','1e3','9223372036854775808',1.1,Number.MAX_SAFE_INTEGER+3]) {
        await expect(service.createProject(ctx,{
          code:'PH2-BAD',name:'Invalid money',contractValuePaise:invalid as any,
        })).rejects.toMatchObject({
          response:expect.objectContaining({code:'INVALID_MONEY_PAISE'}),
        });
      }
      await expect(service.createProject(ctx,{code:'PH2-NAME',name:'  '}))
        .rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_PROJECT_NAME'})});
      await expect(service.createDraftProject(ctx,{
        code:'PH2-DATE',name:'Bad date',startDate:'2026-02-30',
      })).rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_PROJECT_DATE'})});
      await expect(service.createDraftProject(ctx,{
        code:'PH2-ORDER',name:'Backwards dates',
        startDate:'2026-12-01',targetHandoverDate:'2026-01-01',
      })).rejects.toMatchObject({response:expect.objectContaining({code:'INVALID_PROJECT_DATE_ORDER'})});
      expect((await admin.query('SELECT count(*)::int AS count FROM projects WHERE org_id=$1',[orgId]))
        .rows[0].count).toBe(0);
    });
  });
});
