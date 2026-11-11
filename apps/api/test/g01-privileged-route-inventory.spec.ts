import { createHash } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { registeredHttpRoutes } from '../src/common/security/route-inventory';
import { SessionCsrfGuard } from '../src/common/guards/session-csrf.guard';
import { PermissionGuard } from '../src/common/guards/permission.guard';

describe('G01-019 complete registered HTTP route/MFA inventory',()=>{
  const routes=registeredHttpRoutes(AppModule);
  const publicRoutes=new Set([
    'GET /health','GET /api/v1/health','GET /api/v1/billing/plans',
    'GET /api/v1/signatures/verify/:code','POST /api/v1/webhooks/razorpay',
    'POST /api/v1/auth/otp/request','POST /api/v1/auth/otp/verify','POST /api/v1/auth/delivery/receipts',
    'GET /api/v1/guest/:token','POST /api/v1/guest/:token/otp/request',
    'POST /api/v1/guest/:token/otp/verify','POST /api/v1/guest/:token/session',
  ]);
  const preMfa=new Set([
    'GET /api/v1/auth/me','GET /api/v1/auth/orgs','GET /api/v1/auth/session/bootstrap',
    'POST /api/v1/auth/switch-org','POST /api/v1/auth/logout','POST /api/v1/auth/sessions/revoke-all',
    'POST /api/v1/auth/sessions/:sessionId/revoke','GET /api/v1/auth/mfa/status',
    'POST /api/v1/auth/mfa/enroll/start','POST /api/v1/auth/mfa/enroll/confirm',
    'POST /api/v1/auth/mfa/verify','POST /api/v1/auth/mfa/recovery','POST /api/v1/auth/mfa/reset',
  ]);
  it('every registered nonpublic route has session protection and explicit business permission',()=>{
    expect(routes.length).toBeGreaterThan(100);
    const unguarded=routes.filter(r=>!r.guards.includes(SessionCsrfGuard)).map(r=>r.method+' '+r.path);
    expect(new Set(unguarded)).toEqual(publicRoutes);
    for(const route of routes.filter(r=>r.guards.includes(SessionCsrfGuard))){
      if(route.path.startsWith('/api/v1/auth/') || route.path==='/api/v1/guest/me/context')continue;
      expect({route:route.method+' '+route.path,protected:route.guards.includes(PermissionGuard),permission:route.permission})
        .toEqual({route:route.method+' '+route.path,protected:true,permission:expect.any(String)});
    }
  });

  it.each(['R-OWNER','R-ADMIN'])('%s must step up on every privileged registered route, including aliases',async role=>{
    const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try {
      const csrf='fixture-csrf',generation='019a6f40-e041-7000-8000-000000000001';
      const session:any={session_id:'s1',user_id:'u1',active_org_id:'o1',user_name:'Fixture',
        csrf_token_hash:createHash('sha256').update(csrf).digest('hex'),auth_generation:generation,
        expires_at:new Date(Date.now()+3600000),absolute_expires_at:new Date(Date.now()+3600000),
        last_activity_at:new Date(),user_status:'ACTIVE',org_status:'ACTIVE',guest_grant_id:null,
        mfa_verified:false,mfa_verified_at:null};
      const client={query:jest.fn(async(sql:string)=>({rows:sql.includes('FROM memberships')?[{org_role:role,membership_status:'ACTIVE'}]:[]})),release:jest.fn()};
      const pool:any={query:jest.fn(async()=>({rows:[session]})),connect:jest.fn(async()=>client)};
      const guard=new SessionCsrfGuard(pool);
      for(const route of routes.filter(r=>r.guards.includes(SessionCsrfGuard))){
        const path=route.path.replace(/:[A-Za-z0-9]+/g,'019a6f40-e041-7000-8000-000000000002');
        const req={method:route.method,path,params:{},cookies:{tc_session:'fixture-cookie'},
          headers:{'x-csrf-token':csrf,'x-auth-generation':generation},ip:'192.0.2.33'};
        const context:any={switchToHttp:()=>({getRequest:()=>req})};
        session.mfa_verified=false;session.mfa_verified_at=null;
        if(preMfa.has(route.method+' '+route.path))await expect(guard.canActivate(context)).resolves.toBe(true);
        else await expect(guard.canActivate(context)).rejects.toMatchObject({response:expect.objectContaining({code:'MFA_STEP_UP_REQUIRED'})});
        session.mfa_verified=true;session.mfa_verified_at=new Date();
        await expect(guard.canActivate(context)).resolves.toBe(true);
      }
    }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}
  });
});
