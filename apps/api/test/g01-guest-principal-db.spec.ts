import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { PartiesService } from '../src/modules/parties/parties.service';
import { TenantDbService } from '../src/database/tenant-db.service';

jest.setTimeout(180_000);

describe('G01: guest session identity, supersession and proven provenance', () => {
  it('guest has its own principal; old OTP proof cannot authenticate after resend',async()=>{
    const oldDebug = process.env.ENABLE_DEBUG_OTP;
    process.env.ENABLE_DEBUG_OTP = 'true';
    try {
      await withDisposableDatabase(async ({ admin, app }) => {
        const issuer=uuidv7(), org=uuidv7(), project=uuidv7(),party=uuidv7(), grant=uuidv7();
        const inviteToken='f'.repeat(64);
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Invitation Issuer','ACTIVE')",[issuer]);
        await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
            VALUES($1,'Auth Guest HVAC','Auth Guest HVAC','KA','ACTIVE')`,[org]);
        await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
            VALUES($1,$2,'G01-GUEST','Guest identity','ACTIVE',$3)`,[project,org,issuer]);
        await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
            VALUES($1,$2,'Client Identity',ARRAY['CLIENT']::text[],'ACTIVE')`,[party,org]);
        await admin.query(`INSERT INTO guest_grants(
           id,org_id,project_id,party_id,grant_type,role,capabilities,
           token_hash,target_email,status,expires_at,created_by)
           VALUES($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',ARRAY['document.read']::text[],
             $5,'recipient@g01.example','ACTIVE',now()+interval '1 day',$6)`,
           [grant,org,project,party,createHash('sha256').update(inviteToken).digest('hex'),issuer]);

        const svc=new PartiesService(new TenantDbService(app));
        const first=await svc.requestGuestOtp(inviteToken);
        const second=await svc.requestGuestOtp(inviteToken);
        await expect(svc.verifyGuestOtp(inviteToken,first.debugOtp!,first.challengeId))
          .rejects.toThrow();
        const login=await svc.verifyGuestOtp(inviteToken,second.debugOtp!,second.challengeId);
        expect(login.grantId).toBe(grant);
        expect(login.csrfToken).toMatch(/^[0-9a-f]{64}$/);
        const {rows}=await admin.query(`SELECT s.user_id, gg.created_by,gg.principal_user_id
            FROM sessions s JOIN guest_grants gg ON gg.id=s.guest_grant_id
            WHERE s.guest_grant_id=$1`,[grant]);
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).not.toBe(issuer);
        expect(rows[0].user_id).toBe(rows[0].principal_user_id);
        expect(rows[0].created_by).toBe(issuer);
        await expect(svc.verifyGuestOtp(inviteToken,second.debugOtp!,second.challengeId))
          .rejects.toThrow();
      });
    }finally{
      if(oldDebug===undefined)delete process.env.ENABLE_DEBUG_OTP;
      else process.env.ENABLE_DEBUG_OTP=oldDebug;
    }
  });
  it('does not claim delayed provider delivery succeeded after a newer guest OTP superseded it', async () => {
    const priorDebug = process.env.ENABLE_DEBUG_OTP;
    process.env.ENABLE_DEBUG_OTP = 'false';
    try {
      await withDisposableDatabase(async ({ admin, app }) => {
        const issuer=uuidv7(), org=uuidv7(), project=uuidv7(),party=uuidv7(),grant=uuidv7();
        const inviteToken='e'.repeat(64);
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Invitation Issuer','ACTIVE')",[issuer]);
        await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
          VALUES($1,'Delayed Guest HVAC','Delayed Guest HVAC','KA','ACTIVE')`,[org]);
        await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
          VALUES($1,$2,'G01-DELAY','Guest delivery race','ACTIVE',$3)`,[project,org,issuer]);
        await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
          VALUES($1,$2,'Client Recipient',ARRAY['CLIENT']::text[],'ACTIVE')`,[party,org]);
        await admin.query(`INSERT INTO guest_grants(
          id,org_id,project_id,party_id,grant_type,role,capabilities,
          token_hash,target_email,status,expires_at,created_by)
          VALUES($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',ARRAY['document.read']::text[],
          $5,'guest-race@g01.example','ACTIVE',now()+interval '1 day',$6)`,
          [grant,org,project,party,createHash('sha256').update(inviteToken).digest('hex'),issuer]);

        let startSending!: () => void;
        let finishSending!: () => void;
        const started = new Promise<void>(resolve => { startSending=resolve; });
        const delayed = new Promise<void>(resolve => { finishSending=resolve; });
        const gateway = {sendOtpEmail: jest.fn()
          .mockImplementationOnce(async () => { startSending(); await delayed; })
          .mockResolvedValue(undefined)};
        const svc=new PartiesService(new TenantDbService(app), undefined, gateway as any);
        const firstPromise=svc.requestGuestOtp(inviteToken);
        await started;
        const second=await svc.requestGuestOtp(inviteToken);
        finishSending();
        await expect(firstPromise).rejects.toMatchObject({
          response: expect.objectContaining({
            code:'GUEST_OTP_CHALLENGE_SUPERSEDED',
          }),
        });
        const statuses=(await admin.query(
          `SELECT id,delivery_status,consumed_at FROM otp_challenges
            WHERE guest_grant_id=$1 ORDER BY created_at`,[grant])).rows;
        expect(statuses).toHaveLength(2);
        const first=statuses.find((x:any)=>x.id!==second.challengeId);
        const latest=statuses.find((x:any)=>x.id===second.challengeId);
        expect(first.consumed_at).toBeTruthy();
        expect(latest.delivery_status).toBe('SENT');
        expect(latest.consumed_at).toBeNull();
        expect(gateway.sendOtpEmail).toHaveBeenCalledTimes(2);
        const latestCode=gateway.sendOtpEmail.mock.calls[1][1] as string;
        const login=await svc.verifyGuestOtp(inviteToken,latestCode,second.challengeId);
        expect(login.grantId).toBe(grant);
      });
    } finally {
      if (priorDebug===undefined) delete process.env.ENABLE_DEBUG_OTP;
      else process.env.ENABLE_DEBUG_OTP=priorDebug;
    }
  });

});
