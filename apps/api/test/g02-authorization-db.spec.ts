import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { withTenantTransaction } from '@tradecloseout/db/tenant-tx';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { HandoverController } from '../src/modules/handover/handover.controller';
import { HandoverService } from '../src/modules/handover/handover.service';
import { AssetsService } from '../src/modules/assets/assets.service';
import { ChecklistsService } from '../src/modules/checklists/checklists.service';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(180_000);
type Seed={org:string;user:string;guest:string;projectA:string;projectB:string;
  assetA:string;assetB:string;reqA:string;reqB:string;party:string};

async function seed(admin:any):Promise<Seed>{
  const org=uuidv7(),user=uuidv7(),guest=uuidv7();
  const projectA=uuidv7(),projectB=uuidv7(),assetA=uuidv7(),assetB=uuidv7();
  const reqA=uuidv7(),reqB=uuidv7(),party=uuidv7();
  await admin.query(
    `INSERT INTO users(id,name,status) VALUES
      ($1,'G02 assigned user','ACTIVE'),($2,'G02 guest principal','ACTIVE')`,
    [user,guest],
  );
  await admin.query(
    `INSERT INTO organisations(id,legal_name,display_name,state,status)
     VALUES($1,'G02 Tenant','G02 Tenant','KA','ACTIVE')`,[org],
  );
  await admin.query(
    `INSERT INTO projects(id,org_id,code,name,status,created_by) VALUES
      ($1,$3,'G02-A','Project A','ACTIVE',$4),
      ($2,$3,'G02-B','Project B','ACTIVE',$4)`,
    [projectA,projectB,org,user],
  );
  await admin.query(
    `INSERT INTO memberships(id,org_id,user_id,role,status)
       VALUES($1,$2,$3,'R-REVIEWER','ACTIVE')`,
    [uuidv7(),org,user],
  );
  await admin.query(
    `INSERT INTO project_members(id,org_id,project_id,user_id,role,scope_json,status,added_by)
       VALUES($1,$2,$3,$4,'R-REVIEWER',$5::jsonb,'ACTIVE',$4)`,
    [uuidv7(),org,projectA,user,JSON.stringify({
      assetIds:[assetA],requirementIds:[reqA],readOnly:true,
    })],
  );
  await admin.query(
    `INSERT INTO parties(id,org_id,name,types,status)
      VALUES($1,$2,'G02 supplier party',ARRAY['SUPPLIER']::text[],'ACTIVE')`,
    [party,org],
  );
  for(const [id,project,tag] of [[assetA,projectA,'G02-A-ASSET'],[assetB,projectA,'G02-B-ASSET']]){
    await admin.query(
      `INSERT INTO assets(id,org_id,project_id,tag,name,category_key,status,created_by)
        VALUES($1,$2,$3,$4,$4,'HVAC','ACTIVE',$5)`,
      [id,org,project,tag,user],
    );
  }
  for(const [id,key,status] of [[reqA,'G02-RA','NOT_STARTED'],[reqB,'G02-RB','NOT_STARTED']]){
    await admin.query(
      `INSERT INTO requirements
        (id,org_id,project_id,requirement_key,title,group_key,doc_type_key,mandatory,status)
       VALUES($1,$2,$3,$4,$4,'HVAC','DT-001',true,$5)`,
      [id,org,projectA,key,status],
    );
  }
  return {org,user,guest,projectA,projectB,assetA,assetB,reqA,reqB,party};
}
function actor(s:Seed,role='R-REVIEWER'){
  return {orgId:s.org,userId:s.user,actorType:'MEMBER' as const,
    projectId:s.projectA,orgRole:role,projectRole:'R-REVIEWER',
    projectScope:{assetIds:[s.assetA],requirementIds:[s.reqA],readOnly:true},
    requestId:uuidv7(),ip:'192.0.2.11',userAgent:'G02 test'};
}
function context(s:Seed,role='R-REVIEWER'):any{
  const a=actor(s,role);
  return {...a,actorType:'USER'};
}

describe('G02 actual PostgreSQL16 with restricted tc_app, FORCE RLS',()=>{
  it('G02-001/011/015: direct ID across another project is denied before package detail, and emits a capped redacted event',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const s=await seed(admin);
      const packageA=uuidv7(),packageB=uuidv7();
      for(const [id,p] of [[packageA,s.projectA],[packageB,s.projectB]]){
        await admin.query(
          `INSERT INTO handover_packages
            (id,org_id,project_id,version_no,status,package_purpose,snapshot_checksum,requested_by)
           VALUES($1,$2,$3,1,'QUEUED','FULL_HANDOVER',$5,$4)`,
          [id,s.org,p,s.user,'c'.repeat(64)],
        );
      }
      const guard=new PermissionGuard(new Reflector(),app);
      const evaluate=async(id:string)=>{
        const req:any={method:'GET',path:`/api/v1/packages/${id}`,
          params:{id},user:{userId:s.user,orgId:s.org,orgRole:'R-REVIEWER'},
          userContext:context(s),ip:'192.0.2.44'};
        await guard.canActivate({
          getHandler:()=>HandoverController.prototype.getPackage,
          getClass:()=>HandoverController,
          switchToHttp:()=>({getRequest:()=>req}),
        } as any);
        return req;
      };
      await expect(evaluate(packageB)).rejects.toThrow(NotFoundException);
      const permitted=await evaluate(packageA);
      expect(permitted.userContext.projectId).toBe(s.projectA);
      expect(permitted.userContext.permission).toBe('package.download');
      expect((await admin.query(
        `SELECT COUNT(*)::int AS n FROM auth_security_events
         WHERE actor_user_id=$1 AND event_type='AUTHORIZATION_DENIED'`,
        [s.user],
      )).rows[0].n).toBeGreaterThan(0);
    });
  });

  it('G02-002/009: member asset subset and transaction-held membership revoke fail closed',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const s=await seed(admin);
      const svc=new AssetsService(app);
      const ctx=actor(s);
      const rows=await svc.listAssets(ctx,s.projectA);
      expect(rows.map((r:any)=>r.id)).toEqual([s.assetA]);
      await expect(svc.getAsset(ctx,s.projectA,s.assetB))
        .rejects.toThrow(NotFoundException);
      expect((await svc.getAsset(ctx,s.projectA,s.assetA)).id).toBe(s.assetA);
      // The session guard ran before the offboarding transaction committed.
      // The service must wait for the current project_members row lock and
      // refuse any stale authorization after its removal.
      const other=await admin.connect();
      try {
        await other.query('BEGIN');
        await other.query(
          "UPDATE project_members SET status='REMOVED' WHERE project_id=$1 AND user_id=$2",
          [s.projectA,s.user],
        );
        const pending=withTenantTransaction(app,ctx,async client=>{
          await client.query(
            'UPDATE assets SET name=$1 WHERE org_id=$2 AND id=$3',
            ['stale-authority-mutation',s.org,s.assetA],
          );
        });
        await new Promise(resolve=>setTimeout(resolve,60));
        await other.query('COMMIT');
        await expect(pending).rejects.toThrow(/G02_PROJECT_AUTHORITY_CHANGED/);
      }finally{
        await other.query('ROLLBACK').catch(()=>{});
        other.release();
      }
      expect((await admin.query(
        'SELECT name FROM assets WHERE id=$1',[s.assetA],
      )).rows[0].name).not.toBe('stale-authority-mutation');
    });
  });

  it('G02-003: guest supplier can list only grant-assigned requirements, never the other same-project row',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const s=await seed(admin);
      const grant=uuidv7();
      const scope={requirementIds:[s.reqA],projectId:s.projectA};
      await admin.query(
        `INSERT INTO guest_grants
          (id,org_id,project_id,party_id,principal_user_id,
           grant_type,role,capabilities,scope_json,token_hash,target_email,
           status,expires_at,created_by)
         VALUES($1,$2,$3,$4,$5,'SUPPLIER_UPLOAD','R-SUPPLIER-OEM',
           ARRAY['document.upload']::text[],$6::jsonb,$7,
           'supplier@example.test','ACTIVE',now()+interval '1 day',$8)`,
        [grant,s.org,s.projectA,s.party,s.guest,JSON.stringify(scope),
          't'.repeat(64),s.user],
      );
      const ctx:any={orgId:s.org,userId:s.guest,actorType:'GUEST',
        guestGrantId:grant,projectId:s.projectA,guestScope:scope,
        requestId:uuidv7(),ip:'192.0.2.10',userAgent:'g02'};
      const found=await new ChecklistsService(app).listRequirements(ctx,s.projectA);
      expect(found.map((r:any)=>r.id)).toEqual([s.reqA]);
      const changed={...ctx,guestScope:{requirementIds:[s.reqA,s.reqB]}};
      await expect(new ChecklistsService(app).listRequirements(changed,s.projectA))
        .rejects.toThrow('G02_GUEST_SCOPE_CHANGED');
      await admin.query(
        "UPDATE guest_grants SET status='REVOKED' WHERE id=$1",[grant],
      );
      await expect(new ChecklistsService(app).listRequirements(ctx,s.projectA))
        .rejects.toThrow('G02_GUEST_AUTHORITY_CHANGED');
    });
  });

  it('G02-014: owner export is reasoned, hourly limited and attributable, while non-owner direct call is denied',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const s=await seed(admin);
      const svc=new HandoverService(app,{} as any);
      const owner={...actor(s,'R-OWNER'),orgRole:'R-OWNER',
        projectRole:'R-OWNER',projectScope:undefined};
      await expect(svc.exportProjectArchive(actor(s),s.projectA,
        {purpose:'Unauthorised export attempt'})).rejects.toThrow();
      const result=await svc.exportProjectArchive(owner,s.projectA,{
        purpose:'Documented G02 security acceptance export',
      });
      expect(result.status).toBe('MANIFEST_ONLY');
      await expect(svc.exportProjectArchive(owner,s.projectA,{
        purpose:'Repeated archive export within the hour',
      })).rejects.toMatchObject({
        response:expect.objectContaining({code:'EXPORT_HOURLY_LIMIT'}),
      });
      const {rows}=await admin.query(
        'SELECT created_by,status FROM archive_exports WHERE org_id=$1 AND project_id=$2',
        [s.org,s.projectA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({created_by:s.user,status:'MANIFEST_ONLY'});
    });
  });
});
