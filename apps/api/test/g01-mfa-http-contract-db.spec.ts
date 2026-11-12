import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { MfaController } from '../src/modules/identity/mfa.controller';
import { TenantDbService } from '../src/database/tenant-db.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120_000);
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function otp(secret: string): string {
  let bits=0, acc=0;
  const bytes: number[]=[];
  for(const c of secret) {
    acc=(acc<<5)|ALPHABET.indexOf(c);
    bits+=5;
    if(bits>=8){bytes.push((acc >>> (bits-=8)) & 255); acc&=(1<<bits)-1;}
  }
  const buf=Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const digest=createHmac('sha1',Buffer.from(bytes)).update(buf).digest();
  return String((digest.readUInt32BE(digest[19]&15)&0x7fffffff)%1_000_000).padStart(6,'0');
}

describe('PH1-G01-002/003 MFA controller and real restricted database', () => {
  it('enrolls and rotates cookies atomically, rejects replay and consumes recovery once', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants:[a] }=await seedTenants(admin);
      await admin.query(
        "INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      const sessionId=randomUUID(), initialToken=randomBytes(32).toString('hex');
      await admin.query(
        `INSERT INTO sessions (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [sessionId,userId,a.orgId,createHash('sha256').update(initialToken).digest('hex'),'a'.repeat(64)],
      );
      const service=new MfaController(new TenantDbService(app));
      const request=(token:string):any=>({
        auth:{userId,activeOrgId:a.orgId,sessionId,mfaVerified:false},
        userContext:{actorType:'USER'},
        cookies:{tc_session:token},
      });
      const response=():any=>({
        cookie:jest.fn(),
        setHeader:jest.fn(),
      });
      const initialRequest=request(initialToken);
      const startRes=response();
      const proposal=await service.begin(initialRequest,startRes);
      expect(proposal).toMatchObject({
        proposalId:expect.any(String),manualSetupKey:expect.any(String),
        periodSeconds:30,digits:6,
      });
      expect(startRes.setHeader).toHaveBeenCalledWith('Cache-Control','no-store');
      expect(startRes.cookie).not.toHaveBeenCalled();

      const confirmRes=response();
      const activated=await service.confirm(
        initialRequest,{proposalId:proposal.proposalId,code:otp(proposal.manualSetupKey)},confirmRes,
      );
      expect(activated.enrolled).toBe(true);
      expect(activated.mfaVerified).toBe(true);
      expect(activated.recoveryCodes).toHaveLength(8);
      const cookie=confirmRes.cookie.mock.calls[0];
      expect(cookie[0]).toBe('tc_session');
      expect(cookie[1]).not.toBe(initialToken);
      expect(cookie[2]).toMatchObject({httpOnly:true,sameSite:'lax',path:'/'});
      expect(activated.csrfToken).toMatch(/^[a-f0-9]{48}$/);

      const afterEnrollment=request(cookie[1]);
      await expect(service.verify(
        afterEnrollment,{code:otp(proposal.manualSetupKey)},response(),
      )).rejects.toMatchObject({response:{code:'MFA_CODE_INVALID_OR_REPLAYED'}});
      const recoveryResponse=response();
      const recovered=await service.recover(
        afterEnrollment,{recoveryCode:activated.recoveryCodes[0]},recoveryResponse,
      );
      expect(recovered.mfaVerified).toBe(true);
      const afterRecovery=request(recoveryResponse.cookie.mock.calls[0][1]);
      await expect(service.recover(
        afterRecovery,{recoveryCode:activated.recoveryCodes[0]},response(),
      )).rejects.toMatchObject({response:{code:'RECOVERY_CODE_INVALID'}});

      const {rows:security}=await admin.query(
        "SELECT token_hash,csrf_token_hash,mfa_verified FROM sessions WHERE id=$1",[sessionId],
      );
      expect(security[0].token_hash).toBe(
        createHash('sha256').update(recoveryResponse.cookie.mock.calls[0][1]).digest('hex'),
      );
      expect(security[0].mfa_verified).toBe(true);
      const {rows:recovery}=await admin.query(
        "SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NOT NULL",
        [userId],
      );
      expect(recovery[0].n).toBe(1);
    });
  });

  it('rejects guest or bearer-only enrollment without touching the factor store', async () => {
    const service=new MfaController({} as TenantDbService);
    const guest:any={
      auth:{userId:randomUUID(),activeOrgId:randomUUID(),sessionId:randomUUID()},
      userContext:{actorType:'GUEST'},cookies:{tc_session:'x'.repeat(64)},
    };
    const res:any={setHeader:jest.fn(),cookie:jest.fn()};
    await expect(service.begin(guest,res)).rejects.toMatchObject({
      response:{code:'MFA_MEMBER_ONLY'},
    });
    guest.userContext.actorType='USER';
    delete guest.cookies.tc_session;
    await expect(service.begin(guest,res)).rejects.toMatchObject({
      response:{code:'SESSION_COOKIE_REQUIRED'},
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
