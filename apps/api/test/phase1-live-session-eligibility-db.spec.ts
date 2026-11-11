import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { withTenantTransaction } from '@tradecloseout/db/tenant-tx';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(180_000);

describe('PH1-G01-004 / PH1-G26-004: live account, tenant, membership and session authority', () => {
  it('denies inactive/changed authority before the callback and serializes concurrent suspension', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const userId=uuidv7(),orgId=uuidv7(),sessionId=uuidv7();
      await admin.query(`INSERT INTO users(id,name,status) VALUES($1,'Session eligibility','ACTIVE')`,[userId]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
        VALUES($1,'Session Eligibility','Session Eligibility','KA','ACTIVE')`,[orgId]);
      await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
        VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,userId]);
      const {rows}=await admin.query(`INSERT INTO sessions
         (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day') RETURNING auth_generation`,
        [sessionId,userId,orgId,'d'.repeat(64),'c'.repeat(64)]);
      const ctx={orgId,userId,sessionId,orgRole:'R-OWNER',actorType:'MEMBER' as const,
        authGeneration:String(rows[0].auth_generation),
        ip:'127.0.0.1',userAgent:'live-eligibility-test',requestId:'session-live'};
      const db=new TenantDbService(app);
      let callbackCount=0;
      const invokeWriter=()=>withTenantTransaction(app,ctx,async()=>{
        callbackCount++;return 'accepted';
      });
      const invokeService=()=>db.withTenantContext({...ctx,actorType:'USER'},async()=>{
        callbackCount++;return 'accepted';
      });
      for(const invoke of [invokeWriter,invokeService]){
        await expect(invoke()).resolves.toBe('accepted');
      }
      const expectDenied=async(code:string)=>{
        const before=callbackCount;
        for(const invoke of [invokeWriter,invokeService]){
          await expect(invoke()).rejects.toThrow(code);
        }
        expect(callbackCount).toBe(before);
      };

      await admin.query(`UPDATE organisations SET status='SUSPENDED' WHERE id=$1`,[orgId]);
      await expectDenied('AUTH_ORGANISATION_INACTIVE');
      await admin.query(`UPDATE organisations SET status='ACTIVE' WHERE id=$1`,[orgId]);

      await admin.query(`UPDATE users SET status='SUSPENDED' WHERE id=$1`,[userId]);
      await expectDenied('AUTH_ACCOUNT_INACTIVE');
      await admin.query(`UPDATE users SET status='ACTIVE' WHERE id=$1`,[userId]);

      await admin.query(`UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2`,
        [orgId,userId]);
      await expectDenied('AUTH_MEMBERSHIP_INACTIVE');
      await admin.query(`UPDATE memberships SET status='ACTIVE',role='R-ADMIN'
        WHERE org_id=$1 AND user_id=$2`,[orgId,userId]);
      await expectDenied('AUTH_ORG_ROLE_CHANGED');
      await admin.query(`UPDATE memberships SET role='R-OWNER' WHERE org_id=$1 AND user_id=$2`,
        [orgId,userId]);

      let finish!:()=>void,started!:()=>void;
      const release=new Promise<void>(resolve=>{finish=resolve;});
      const begun=new Promise<void>(resolve=>{started=resolve;});
      const inflight=withTenantTransaction(app,ctx,async()=>{
        started();await release;
      });
      await begun;
      const blocker=await admin.connect();
      try {
        for(const [query,params] of [
          [`UPDATE users SET status='SUSPENDED' WHERE id=$1`,[userId]],
          [`UPDATE organisations SET status='SUSPENDED' WHERE id=$1`,[orgId]],
          [`UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2`,[orgId,userId]],
        ] as const){
          await blocker.query('BEGIN');
          await blocker.query(`SET LOCAL lock_timeout='250ms'`);
          await expect(blocker.query(query,[...params])).rejects.toMatchObject({code:'55P03'});
          await blocker.query('ROLLBACK');
        }
      } finally {
        finish();blocker.release();
      }
      await inflight;
      await admin.query(`UPDATE sessions SET revoked_at=now() WHERE id=$1`,[sessionId]);
      await expectDenied('AUTH_SESSION_CONTEXT_CHANGED');
    });
  });
});
