import { createHash } from 'node:crypto';
import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);
const VALID_ORG=uuidv7();

describe('G01-R1/R2: org switch validation and connection cleanup',()=>{
  it('rejects bearer-only authenticated switches before acquiring a database connection, repeatedly',async()=>{
    const pool:any={connect:jest.fn(()=>{throw new Error('DB_ACQUIRED');})};
    const controller=new IdentityController(pool,{} as any,{} as any,{} as any);
    const req:any={auth:{userId:uuidv7(),sessionId:uuidv7(),authGeneration:uuidv7()},cookies:{},headers:{authorization:'Bearer valid-fixture'}};
    for(let n=0;n<120;n++){
      await expect(controller.switchActiveOrg({targetOrgId:VALID_ORG},req,{} as any))
        .rejects.toThrow(UnauthorizedException);
    }
    expect(pool.connect).not.toHaveBeenCalled();
    // A production request without a response writer also cannot acquire a
    // connection to perform an uncompletable session-token rotation.
    const mode=process.env.NODE_ENV;
    try{
      process.env.NODE_ENV='production';
      const withCookie={...req,cookies:{tc_session:'a'.repeat(64)}};
      await expect(controller.switchActiveOrg({targetOrgId:VALID_ORG},withCookie))
        .rejects.toThrow(UnauthorizedException);
      expect(pool.connect).not.toHaveBeenCalled();
    }finally{
      if(mode===undefined)delete process.env.NODE_ENV;
      else process.env.NODE_ENV=mode;
    }
  });

  it('rejects malformed runtime UUIDs before database use, including coercible arrays',async()=>{
    const pool:any={connect:jest.fn(()=>{throw new Error('DB_ACQUIRED');})};
    const controller=new IdentityController(pool,{} as any,{} as any,{} as any);
    const req:any={auth:{userId:uuidv7(),sessionId:uuidv7(),authGeneration:uuidv7()},
      cookies:{tc_session:'b'.repeat(64)}};
    for(const value of [[VALID_ORG],{toString:()=>VALID_ORG},42,null,true,[],{},'',VALID_ORG+'x']){
      await expect(controller.switchActiveOrg({targetOrgId:value} as any,req,{} as any))
        .rejects.toThrow(UnprocessableEntityException);
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('releases the acquired client when the membership query fails; valid switch still succeeds',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),orgA=uuidv7(),orgB=uuidv7(),session=uuidv7();
      const raw='q'.repeat(64),generation=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Switch User','ACTIVE')",[user]);
      for(const id of [orgA,orgB]){
        await admin.query("INSERT INTO organisations(id,legal_name,display_name,state,status) VALUES($1,'Org','Org','KA','ACTIVE')",[id]);
        await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-PM','ACTIVE')",[uuidv7(),id,user]);
      }
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,auth_generation,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 day')`,
        [session,user,orgA,createHash('sha256').update(raw).digest('hex'),'0'.repeat(64),generation],
      );
      const controller=new IdentityController(app,{} as any,{} as any,{} as any);
      const req:any={auth:{userId:user,sessionId:session,authGeneration:generation},
        cookies:{tc_session:raw}};
      const res:any={cookie:jest.fn()};
      await expect(controller.switchActiveOrg({targetOrgId:uuidv7()},req,res))
        .rejects.toThrow();
      const switched=await controller.switchActiveOrg({targetOrgId:orgB},req,res);
      expect(switched).toMatchObject({activeOrgId:orgB,authGeneration:expect.any(String)});
      expect(res.cookie).toHaveBeenCalledWith('tc_session',expect.any(String),expect.objectContaining({httpOnly:true}));
      const row=(await admin.query('SELECT active_org_id FROM sessions WHERE id=$1',[session])).rows[0];
      expect(row.active_org_id).toBe(orgB);
      expect(app.waitingCount).toBe(0);
    });
  });
});
