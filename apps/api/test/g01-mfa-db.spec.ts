import { createHash, createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { MfaController } from '../src/modules/identity/mfa.controller';

jest.setTimeout(180_000);

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function otp(secret: string, clockMs: number): string {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const letter of secret) {
    value = (value << 5) | alphabet.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(clockMs / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function seed(admin: Pool) {
  const userId = uuidv7(), orgId = uuidv7(), sessionId = uuidv7();
  const rawToken = 'mfa_test_' + uuidv7();
  await admin.query(
    `INSERT INTO users(id,name,status) VALUES($1,'Security Owner','ACTIVE')`,
    [userId],
  );
  await admin.query(
    `INSERT INTO organisations(id,legal_name,display_name,state,status)
       VALUES($1,'Test MEP Org','Test MEP Org','KA','ACTIVE')`,
    [orgId],
  );
  await admin.query(
    `INSERT INTO memberships(id,user_id,org_id,role,status)
      VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,
    [uuidv7(),userId,orgId],
  );
  await admin.query(
    `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
      VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
    [sessionId,userId,orgId,createHash('sha256').update(rawToken).digest('hex'),'a'.repeat(64)],
  );
  const req:any = { auth: { sessionId, userId, activeOrgId: orgId, mfaVerified: false },
    userContext: { actorType: 'USER' } };
  return { orgId,userId,sessionId,req };
}

describe('G01 MFA real PostgreSQL control plane', () => {
  const keyBefore = process.env.AUTH_MFA_ENCRYPTION_KEY;
  afterAll(() => {
    if (keyBefore === undefined) delete process.env.AUTH_MFA_ENCRYPTION_KEY;
    else process.env.AUTH_MFA_ENCRYPTION_KEY = keyBefore;
  });

  it('binds enrollment, factor replay, single-use backup recovery and audited reset', async () => {
    process.env.AUTH_MFA_ENCRYPTION_KEY = Buffer.alloc(32,22).toString('base64');
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, sessionId, req } = await seed(admin);
      const ctrl = new MfaController(app);
      const res:any = { cookie: jest.fn() };
      const started = await ctrl.beginEnrollment(req);
      expect(started.manualSetupKey).toMatch(/^[A-Z2-7]{32}$/);
      const now = Date.now();
      const firstCode = otp(started.manualSetupKey, now);
      const confirmed = await ctrl.confirmEnrollment(req,{code:firstCode},res);
      expect(confirmed.mfaVerified).toBe(true);
      expect(confirmed.recoveryCodes).toHaveLength(8);
      expect(res.cookie).toHaveBeenCalledWith('tc_session', expect.any(String), expect.objectContaining({ httpOnly: true }));
      const row=(await admin.query('SELECT mfa_totp_secret,mfa_totp_pending_secret,mfa_enabled_at FROM users WHERE id=$1',[userId])).rows[0];
      expect(row.mfa_totp_secret).not.toContain(started.manualSetupKey);
      expect(row.mfa_totp_pending_secret).toBeNull();
      expect(row.mfa_enabled_at).toBeTruthy();
      expect((await app.query('SELECT mfa_verified FROM sessions WHERE id=$1',[sessionId])).rows[0].mfa_verified).toBe(true);
      await expect(ctrl.verifyFactor(req,{code:firstCode},res)).rejects.toThrow();
      const backup=confirmed.recoveryCodes[0];
      const recovered=await ctrl.recoverFactor(req,{recoveryCode:backup},res);
      expect(recovered.mfaVerified).toBe(true);
      await expect(ctrl.recoverFactor(req,{recoveryCode:backup},res)).rejects.toThrow();
      expect((await app.query(
        'SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id=$1 AND consumed_at IS NOT NULL',
        [userId])).rows[0].n).toBe(1);
      req.auth.mfaVerified = true;
      const reset=await ctrl.resetEnrollment(req);
      expect(reset).toMatchObject({ enrolled: false, mfaVerified: false });
      expect((await app.query('SELECT mfa_verified FROM sessions WHERE id=$1',[sessionId])).rows[0].mfa_verified).toBe(false);
      const { rows: events }=await app.query(
        `SELECT event_type FROM auth_security_events WHERE actor_user_id=$1`,[userId]);
      expect(events.map(x=>x.event_type)).toEqual(expect.arrayContaining([
        'MFA_ENROLLED','MFA_RECOVERY_USED','MFA_RESET',
      ]));
    });
  });
});
