import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { IdentityController } from '../src/modules/identity/identity.controller';

jest.setTimeout(180_000);

describe('G01 device-session revocation', () => {
  it('revokes only owned sessions, records the security decision, and clears the current cookie', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const owner=uuidv7(),other=uuidv7(),org=uuidv7();
      for(const uid of [owner,other]){
        await admin.query(
          `INSERT INTO users(id,name,status) VALUES($1,'Device Session User','ACTIVE')`,[uid],
        );
      }
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state,status)
          VALUES($1,'Device Session Org','Device Session Org','KA','ACTIVE')`,[org],
      );
      const current=uuidv7(),second=uuidv7(),foreign=uuidv7();
      for(const [id,userId] of [[current,owner],[second,owner],[foreign,other]]){
        await admin.query(
          `INSERT INTO sessions(id,user_id,active_org_id,token_hash,
            csrf_token_hash,expires_at,mfa_verified,mfa_verified_at)
           VALUES($1,$2,$3,$4,$5,now()+interval '1 day',true,now())`,
          [id,userId,org,createHash('sha256').update(id).digest('hex'),'f'.repeat(64)],
        );
      }
      const controller=new IdentityController(app,{} as any,{} as any,{} as any);
      const request:any={auth:{userId:owner,sessionId:current}};
      const res:any={clearCookie:jest.fn()};

      await expect(controller.revokeDeviceSession(foreign,request,res))
        .rejects.toMatchObject({
          response:expect.objectContaining({code:'SESSION_NOT_FOUND'}),
        });
      await expect(controller.revokeDeviceSession('not-a-uuid',request,res))
        .rejects.toMatchObject({
          response:expect.objectContaining({code:'SESSION_NOT_FOUND'}),
        });
      expect((await admin.query(
        'SELECT revoked_at FROM sessions WHERE id=$1',[foreign],
      )).rows[0].revoked_at).toBeNull();

      await expect(controller.revokeDeviceSession(second,request,res))
        .resolves.toBeUndefined();
      expect(res.clearCookie).not.toHaveBeenCalled();
      expect((await admin.query(
        'SELECT revoked_at,mfa_verified FROM sessions WHERE id=$1',[second],
      )).rows[0]).toMatchObject({
        revoked_at:expect.any(Date),mfa_verified:false,
      });
      await expect(controller.revokeDeviceSession(second,request,res))
        .rejects.toThrow();

      await expect(controller.revokeDeviceSession(current,request,res))
        .resolves.toBeUndefined();
      expect(res.clearCookie).toHaveBeenCalledWith('tc_session',
        expect.objectContaining({httpOnly:true,path:'/'}));
      expect((await admin.query(
        'SELECT revoked_at FROM sessions WHERE id=$1',[foreign],
      )).rows[0].revoked_at).toBeNull();
      expect((await admin.query(
        `SELECT COUNT(*)::int AS n FROM auth_security_events
         WHERE actor_user_id=$1 AND event_type='DEVICE_SESSION_REVOKED'`,[owner],
      )).rows[0].n).toBe(2);
    });
  });
});
