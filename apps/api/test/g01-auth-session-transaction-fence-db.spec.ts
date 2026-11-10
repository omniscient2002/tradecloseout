import { uuidv7 } from 'uuidv7';
import { withTenantTransaction } from '@tradecloseout/db/tenant-tx';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);

describe('G01 authenticated transaction generation fencing',()=>{
  it('denies revoked and stale-generation sessions before any tenant write',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const user=uuidv7(),org=uuidv7(),session=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'G01 Fenced','ACTIVE')",[user]);
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state,status)
          VALUES($1,'Fenced Org','Fenced Org','KA','ACTIVE')`,[org],
      );
      await admin.query(
        `INSERT INTO memberships(id,org_id,user_id,role,status)
          VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),org,user],
      );
      const {rows}=await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,now()+interval '1 day')
          RETURNING auth_generation`,
        [session,user,org,'d'.repeat(64),'c'.repeat(64)],
      );
      const ctx:any={
        orgId:org,userId:user,actorType:'MEMBER',ip:'127.0.0.1',
        userAgent:'g01-tx-test',requestId:'g01-session-fence',
        sessionId:session,authGeneration:String(rows[0].auth_generation),
      };
      const first=await withTenantTransaction(app,ctx,async client=>{
        const {rows:found}=await client.query(
          `SELECT id FROM memberships WHERE org_id=$1 AND user_id=$2`,[org,user],
        );
        return found.length;
      });
      expect(first).toBe(1);
      let callbackEntered=false;
      await expect(withTenantTransaction(app,{...ctx,authGeneration:uuidv7()},async()=>{
        callbackEntered=true;
      })).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(callbackEntered).toBe(false);

      await admin.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[session]);
      await expect(withTenantTransaction(app,ctx,async()=>{
        callbackEntered=true;
      })).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(callbackEntered).toBe(false);
      await expect(withTenantTransaction(app,{...ctx,authGeneration:undefined},async()=>{
        callbackEntered=true;
      })).rejects.toThrow('AUTH_SESSION_CONTEXT_INCOMPLETE');
      expect(callbackEntered).toBe(false);
    });
  });
});
