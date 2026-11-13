import { randomUUID } from 'crypto';
import { MfaController } from '../src/modules/identity/mfa.controller';
import { PermissionGuard } from '../src/common/guards/permission.guard';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { AssetsService } from '../src/modules/assets/assets.service';

it.each([null, [], 123, '', 'x'.repeat(5000), '12345', '1234567'])('rejects malformed authenticator/recovery input before budget/SQL: %j',async value=>{
 const db={withUserContext:jest.fn()};const controller=new MfaController(db as any);
 const req:any={cookies:{tc_session:'a'.repeat(64)},auth:{userId:randomUUID(),sessionId:randomUUID(),activeOrgId:randomUUID()}};
 await expect(controller.verify(req,{code:value} as any,{} as any)).rejects.toThrow();
 await expect(controller.recover(req,{recoveryCode:value} as any,{} as any)).rejects.toThrow();
 expect(db.withUserContext).not.toHaveBeenCalled();
});

it.each([null,[], 'invalid',[randomUUID(),'bad'],[null],Array(101).fill(randomUUID())])('rejects malformed bulk identities before authorization SQL: %j',async ids=>{
 const pool={query:jest.fn(),connect:jest.fn()};const req={params:{},body:{reviewIds:ids},user:{orgRole:'R-QC'}};
 const guard=new PermissionGuard({getAllAndOverride:()=> 'review.decide'} as any,pool as any);
 await expect(guard.canActivate({getHandler:()=>({}),getClass:()=>({}),switchToHttp:()=>({getRequest:()=>req})} as any)).rejects.toMatchObject({response:{code:'INVALID_REVIEW_IDS'}});
 expect(pool.connect).not.toHaveBeenCalled();expect(pool.query).not.toHaveBeenCalled();
});

it.each([{name:{}},{tag:'A.*'},{name:' '},{status:'UNKNOWN'},{changeType:'UNREVIEWED'},{replacesAssetId:'invalid'},{installDate:'2026-02-30'},{warrantyStartBasis:'CLOSURE'}])('rejects malformed asset mutations before checkout: %j',async body=>{
 const pool={connect:jest.fn()};const svc=new AssetsService(pool as any);
 await expect(svc.updateAsset({} as any,randomUUID(),randomUUID(),body as any)).rejects.toMatchObject({response:{code:'INVALID_ASSET_INPUT'}});
 expect(pool.connect).not.toHaveBeenCalled();
});

for(const branch of ['member','guest','project'])for(const phase of ['BEGIN','COMMIT','ROLLBACK']) {
 it(`destroys an uncertain auth ${branch} connection after ${phase} without masking primary errors`,async()=>{
  const primary=new Error('PRIMARY_AUTH_FIXTURE');let count=0;const released: boolean[]=[];const projectId=randomUUID();
  const pool={
   query:async()=>({rows:[{session_id:randomUUID(),user_id:randomUUID(),active_org_id:randomUUID(),guest_grant_id:branch==='guest'?randomUUID():null,user_status:'ACTIVE',org_status:'ACTIVE',expires_at:'2099-01-01',mfa_verified:false}]}),
   connect:async()=>{
    const target=branch==='project'?++count===2:true;
    return {query:async(sql:string)=>{
     if(target && (sql.startsWith(phase)||phase==='ROLLBACK'&&sql.includes('set_config')))throw primary;
     if(sql.includes('FROM memberships'))return{rows:[{org_role:'R-SITE',membership_status:'ACTIVE'}]};
     return{rows:[]};
    },release:(discard:boolean)=>{if(target)released.push(discard);}};
   },
  };
  const req={method:'GET',path:'/api/v1/projects/'+projectId,params:branch==='project'?{projectId}:{},headers:{},cookies:{tc_session:'opaque'}};
  const promise=new SessionCsrfGuard(pool as any).canActivate({switchToHttp:()=>({getRequest:()=>req})} as any);
  if(branch==='project')await expect(promise).rejects.toMatchObject({response:{code:'PROJECT_AUTHORITY_LOOKUP_FAILED'}});else await expect(promise).rejects.toBe(primary);
  expect(released).toEqual([true]);
 });
}
