import { randomUUID, createHash } from 'crypto';
import { Pool } from 'pg';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';
import { AssetsService } from '../src/modules/assets/assets.service';
import { assetProjectAuthority, parseAssetScope } from '../src/modules/assets/asset-authority';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../src/common/guards/permission.guard';

jest.setTimeout(120000);
async function fixture(admin: Pool, app: Pool) {
  const {userId,tenants:[tenant,other]}=await seedTenants(admin);const projectId=tenant.projectIds[0];const orgId=tenant.orgId;
  const owner=randomUUID();await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Fixture owner','ACTIVE')",[owner]);
  for(const [id,role] of [[userId,'R-SITE'],[owner,'R-OWNER']])await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),orgId,id,role]);
  const a=randomUUID(),b=randomUUID();
  for(const [id,tag,category] of [[a,'AHU-01','AHU'],[b,'CH-01','CHILLER']])await admin.query("INSERT INTO assets(id,org_id,project_id,tag,name,category_key,created_by) VALUES($1,$2,$3,$4,$4,$5,$6)",[id,orgId,projectId,tag,category,userId]);
  await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,scope_json,added_by) VALUES($1,$2,$3,$4,'R-SITE','ACTIVE',$5,$6)",[randomUUID(),orgId,projectId,userId,JSON.stringify({assetIds:[a]}),owner]);
  const ctx={orgId,userId,actorType:'MEMBER' as const,orgRole:'R-OWNER',projectRole:'R-SITE',ip:'127.0.0.1',userAgent:'fixture',requestId:randomUUID()};
  return {orgId,projectId,otherProjectId:other.projectIds[0],a,b,userId,owner,ctx,ownerCtx:{...ctx,userId:owner},svc:new AssetsService(app)};
}

it('enforces asset scope on mutation, detail, list, export, matches, history and passport without trusting a stale Owner context',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const f=await fixture(admin,app);const {svc,ctx,projectId,a,b}=f;
  await svc.updateAsset(ctx,projectId,a,{name:'Allowed current member'});
  await expect(svc.updateAsset(ctx,projectId,b,{name:'Forbidden'})).rejects.toMatchObject({response:{code:'ASSET_NOT_FOUND'}});
  expect((await svc.listAssets(ctx,projectId)).map(x=>x.id)).toEqual([a]);
  expect((await svc.exportAssets(ctx,projectId)).count).toBe(1);
  const candidates=await svc.matchAssetCandidates(ctx,projectId,{text:'AHU-01 CH-01'});
  expect(JSON.stringify(candidates)).toContain(a);expect(JSON.stringify(candidates)).not.toContain(b);
  for(const method of ['getAsset','getAssetIdentityHistory','getEquipmentPassport'] as const)await expect(svc[method](ctx,projectId,b)).rejects.toMatchObject({response:{code:'ASSET_NOT_FOUND'}});
  await admin.query('UPDATE project_members SET scope_json=$1 WHERE org_id=$2 AND user_id=$3',[JSON.stringify({mode:'READ_ONLY',assetIds:[a]}),f.orgId,f.userId]);
  await expect(svc.updateAsset(ctx,projectId,a,{name:'Read-only bypass'})).rejects.toMatchObject({response:{code:'ASSET_AUTHORITY_CHANGED'}});
  expect((await svc.getAsset(ctx,projectId,a)).name).toBe('Allowed current member');
  await expect(svc.deleteAsset(ctx,projectId,a)).rejects.toThrow();
  await expect(svc.createAsset(ctx,projectId,{tag:'NEW-01',name:'Scoped creation',categoryKey:'AHU'})).rejects.toThrow();
  const orgPm=randomUUID();
  await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Org-wide PM fixture','ACTIVE')",[orgPm]);
  await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-PM','ACTIVE')",[randomUUID(),f.orgId,orgPm]);
  expect((await svc.listAssets({...ctx,userId:orgPm},projectId)).length).toBe(2);
  await expect(svc.getAsset(f.ownerCtx,f.otherProjectId,a)).rejects.toThrow();
  await expect(svc.listAssets({...ctx,actorType:'GUEST',guestGrantId:randomUUID()},projectId)).rejects.toThrow();
  for (const [scope,expectedIds] of [
    [{categoryKeys:['AHU'],startDate:'2020-01-01',endDate:'2099-12-31'},[a]],
    [{assetIds:[]},[]],
    [{startDate:'2099-01-01'},[]],
  ] as const) {
    await admin.query('UPDATE project_members SET scope_json=$1 WHERE org_id=$2 AND user_id=$3',[JSON.stringify(scope),f.orgId,f.userId]);
    expect((await svc.listAssets(ctx,projectId)).map(x=>x.id)).toEqual(expectedIds);
  }
  await admin.query('UPDATE project_members SET scope_json=$1 WHERE org_id=$2 AND user_id=$3',[JSON.stringify({readOnly:'false'}),f.orgId,f.userId]);
  await expect(svc.listAssets(ctx,projectId)).rejects.toThrow();
 });
});

it('denies a command admitted by real session/permission guards after project-member removal; CLOSED writes and unqualified revalidation fail',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const f=await fixture(admin,app);const token='fixture-token-'.repeat(4),csrf='fixture-csrf';
  await admin.query("INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 day')",[randomUUID(),f.userId,f.orgId,createHash('sha256').update(token).digest('hex'),createHash('sha256').update(csrf).digest('hex')]);
  const req:any={method:'PATCH',path:`/api/v1/projects/${f.projectId}/assets/${f.a}`,params:{projectId:f.projectId,id:f.a},headers:{'x-csrf-token':csrf},cookies:{tc_session:token}};
  const context:any={switchToHttp:()=>({getRequest:()=>req}),getHandler:()=>({}),getClass:()=>({})};
  await new SessionCsrfGuard(app).canActivate(context);await new PermissionGuard({getAllAndOverride:()=> 'asset.manage'} as any,app).canActivate(context);
  await admin.query("UPDATE project_members SET status='REMOVED' WHERE org_id=$1 AND user_id=$2",[f.orgId,f.userId]);
  await expect(f.svc.updateAsset(req.userContext,f.projectId,f.a,{name:'Revoked write'})).rejects.toThrow();
  await admin.query("UPDATE project_members SET status='ACTIVE',scope_json='{}' WHERE org_id=$1 AND user_id=$2",[f.orgId,f.userId]);
  await expect(f.svc.revalidateEvidence(req.userContext,f.projectId,f.a,randomUUID(),{status:'CONFIRMED',expectedRowVersion:1})).rejects.toMatchObject({response:{code:'QUALIFIED_REVALIDATOR_REQUIRED'}});
  for(const status of ['CLOSED','SUSPENDED','CANCELLED','ARCHIVED','DRAFT']) {
   await admin.query('UPDATE projects SET status=$1 WHERE id=$2',[status,f.projectId]);
   await expect(f.svc.updateAsset(f.ownerCtx,f.projectId,f.a,{name:'Invalid lifecycle'})).rejects.toThrow();
   await expect(f.svc.createAsset(f.ownerCtx,f.projectId,{tag:'NEW-01',name:'Bad lifecycle',categoryKey:'AHU'})).rejects.toThrow();
  }
  expect((await admin.query('SELECT name FROM assets WHERE id=$1',[f.a])).rows[0].name).toBe('AHU-01');
 });
});

it('holds the shared project and membership locks through the admitted write boundary',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const f=await fixture(admin,app);const admitted=await app.connect(),opposing=await admin.connect();
  try {
   await admitted.query('BEGIN');await admitted.query("SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)",[f.orgId]);
   await assetProjectAuthority(admitted,f.ctx,f.projectId,true);
   for(const sql of ["UPDATE project_members SET status='REMOVED' WHERE org_id=$1", "UPDATE projects SET status='CLOSED' WHERE org_id=$1"]) {
    await opposing.query('BEGIN');await opposing.query("SET LOCAL lock_timeout='100ms'");
    await expect(opposing.query(sql,[f.orgId])).rejects.toMatchObject({code:'55P03'});await opposing.query('ROLLBACK');
   }
   await admitted.query('COMMIT');
   await admin.query("UPDATE project_members SET status='REMOVED' WHERE org_id=$1",[f.orgId]);
   await expect(f.svc.updateAsset(f.ctx,f.projectId,f.a,{name:'Post-revocation'})).rejects.toThrow();
  } finally {await admitted.query('ROLLBACK');await opposing.query('ROLLBACK');admitted.release();opposing.release();}
 });
});

it('atomic import uses one connection, commits together, and rolls back earlier assets/audit/outbox if a later insert fails',async()=>{
 await withDisposableDatabase(async({admin,app,name})=>{
  const f=await fixture(admin,app);const url=new URL(process.env.APP_DATABASE_URL!);url.pathname='/'+name;
  const single=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:1000});
  try {
   const svc=new AssetsService(single);
   const good=await svc.importAssets(f.ownerCtx,f.projectId,[{tag:'IM-01',name:'Import 1',categoryKey:'AHU'},{tag:'IM-02',name:'Import 2',categoryKey:'AHU'}]);
   if (!('importedCount' in good)) throw new Error('Expected committed import receipt');
   expect(good.importedCount).toBe(2);
   const before=(await admin.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n;
   await admin.query(`CREATE FUNCTION fixture_reject_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tag='FAIL-02' THEN RAISE EXCEPTION 'INJECTED_SECOND_ROW_FAILURE'; END IF;RETURN NEW;END $$;CREATE TRIGGER fixture_reject BEFORE INSERT ON assets FOR EACH ROW EXECUTE FUNCTION fixture_reject_asset()`);
   await expect(svc.importAssets(f.ownerCtx,f.projectId,[{tag:'ROLL-01',name:'Must rollback',categoryKey:'AHU'},{tag:'FAIL-02',name:'Fails',categoryKey:'AHU'}])).rejects.toThrow('INJECTED_SECOND_ROW_FAILURE');
   expect((await admin.query("SELECT id FROM assets WHERE tag='ROLL-01'")).rowCount).toBe(0);
   expect((await admin.query('SELECT count(*)::int AS n FROM audit_events')).rows[0].n).toBe(before);
  } finally {await single.end();}
 });
});

it.each([null,[],{readOnly:'true'},{assetIds:['bad']},{categoryKeys:[3]},{unknown:true},{startDate:'2026-02-30'},{assetIds:[randomUUID(),null]}])('rejects invalid restrictive scope without widening: %j',scope=>expect(()=>parseAssetScope(scope)).toThrow());
