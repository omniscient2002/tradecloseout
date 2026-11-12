import { randomUUID, createHmac } from 'node:crypto';
import { TenantDbService } from '../src/database/tenant-db.service';
import { MfaEnrollmentStore } from '../src/modules/identity/mfa-enrollment-store';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(180_000);
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function totp(secret: string): string {
  let accum = 0, bits = 0;
  const bytes: number[] = [];
  for (const symbol of secret) {
    accum = (accum << 5) | B32.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accum >>> (bits -= 8)) & 255);
      accum &= (1 << bits) - 1;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

describe('PH1-G01-003: MFA enrollment proposal is expiring and bound to exact session generation', () => {
  it('upgrades an existing database, replaces older proposals and confirms only current session once', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const firstSessionId = randomUUID(), secondSessionId = randomUUID();
      const firstHash = 'a'.repeat(64), secondHash = 'b'.repeat(64);
      for (const [sessionId, tokenHash] of [
        [firstSessionId, firstHash], [secondSessionId, secondHash],
      ]) {
        await admin.query(
          `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
           VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
          [sessionId, userId, a.orgId, tokenHash, randomUUID().replace(/-/g, '').padEnd(64,'0')],
        );
      }
      const firstCtx = { userId, sessionId: firstSessionId, sessionTokenHash: firstHash };
      const secondCtx = { userId, sessionId: secondSessionId, sessionTokenHash: secondHash };
      const store = new MfaEnrollmentStore(new TenantDbService(app));

      const superseded = await store.begin(firstCtx);
      const active = await store.begin(firstCtx);
      expect(active.proposalId).not.toBe(superseded.proposalId);
      expect(active.manualSetupKey).toMatch(/^[A-Z2-7]{32}$/);
      expect(new Date(active.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(new Date(active.expiresAt).getTime()).toBeLessThanOrEqual(Date.now()+600_000);
      const { rows: secrets } = await admin.query(
        "SELECT id,status,encrypted_secret FROM mfa_enrollment_proposals WHERE user_id=$1 ORDER BY created_at,id",
        [userId],
      );
      expect(secrets).toHaveLength(2);
      expect(secrets.filter(row => row.status === 'PENDING')).toHaveLength(1);
      expect(secrets.find(row => row.id === superseded.proposalId)).toMatchObject({
        status: 'REPLACED', encrypted_secret: null,
      });
      const pending = secrets.find(row => row.id === active.proposalId);
      expect(pending.encrypted_secret).toMatch(/^v2:/);
      expect(pending.encrypted_secret).not.toContain(active.manualSetupKey);

      await expect(store.confirm(firstCtx, superseded.proposalId, totp(superseded.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_NOT_PENDING' } });
      await expect(store.confirm(secondCtx, active.proposalId, totp(active.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_NOT_PENDING' } });
      await expect(store.confirm(firstCtx, active.proposalId, '0000000'))
        .rejects.toMatchObject({ response: { code: 'MFA_CODE_INVALID' } });

      const enrolled = await store.confirm(firstCtx, active.proposalId, totp(active.manualSetupKey));
      expect(enrolled.confirmed).toBe(true);
      expect(new Set(enrolled.recoveryCodes).size).toBe(8);
      expect(enrolled.recoveryCodes).toHaveLength(8);
      await expect(store.confirm(firstCtx, active.proposalId, totp(active.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ALREADY_ENROLLED' } });
      await expect(store.begin(firstCtx))
        .rejects.toMatchObject({ response: { code: 'MFA_ALREADY_ENROLLED' } });
      const { rows: result } = await admin.query(
        `SELECT p.status,p.encrypted_secret,u.mfa_totp_secret,u.mfa_enabled_at,
             (SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id=$2) AS recovery_count
           FROM mfa_enrollment_proposals p JOIN users u ON u.id=p.user_id
          WHERE p.id=$1`,
        [active.proposalId, userId],
      );
      expect(result[0].status).toBe('CONFIRMED');
      expect(result[0].encrypted_secret).toBeNull();
      expect(result[0].mfa_totp_secret).toMatch(/^v2:/);
      expect(result[0].mfa_totp_secret).not.toContain(active.manualSetupKey);
      expect(result[0].mfa_enabled_at).toBeTruthy();
      expect(result[0].recovery_count).toBe(8);
      for (const code of enrolled.recoveryCodes) {
        expect(JSON.stringify(result)).not.toContain(code);
      }
    }, { baselineThrough: '0022_phase1_audit_sequence_trusted_order.sql' });
  });

  it('cancels, expires, revokes and rotates credentials without confirming any old proposal', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const sessionId = randomUUID(), tokenHash = 'c'.repeat(64);
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [sessionId, userId, a.orgId, tokenHash, 'd'.repeat(64)],
      );
      const ctx = { userId, sessionId, sessionTokenHash: tokenHash };
      const store = new MfaEnrollmentStore(new TenantDbService(app));
      const cancelled = await store.begin(ctx);
      await store.cancel(ctx, cancelled.proposalId);
      await expect(store.confirm(ctx, cancelled.proposalId, totp(cancelled.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_NOT_PENDING' } });

      const expired = await store.begin(ctx);
      await admin.query(
        `UPDATE mfa_enrollment_proposals
            SET created_at=now()-interval '15 minutes',
                expires_at=now()-interval '5 minutes'
          WHERE id=$1`, [expired.proposalId],
      );
      await expect(store.confirm(ctx, expired.proposalId, totp(expired.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_NOT_PENDING' } });

      const rotated = await store.begin(ctx);
      await admin.query("UPDATE sessions SET token_hash=$2 WHERE id=$1", [sessionId, 'e'.repeat(64)]);
      await expect(store.confirm(ctx, rotated.proposalId, totp(rotated.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'SESSION_CONTEXT_CHANGED' } });
      await expect(store.confirm({ ...ctx, sessionTokenHash: 'e'.repeat(64) }, rotated.proposalId, totp(rotated.manualSetupKey)))
        .rejects.toMatchObject({ response: { code: 'MFA_ENROLLMENT_NOT_PENDING' } });

      await admin.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [sessionId]);
      await expect(store.begin({ ...ctx, sessionTokenHash: 'e'.repeat(64) }))
        .rejects.toMatchObject({ response: { code: 'SESSION_CONTEXT_CHANGED' } });
      const { rows } = await admin.query('SELECT mfa_enabled_at FROM users WHERE id=$1', [userId]);
      expect(rows[0].mfa_enabled_at).toBeNull();
    });
  });

  it('serializes concurrent enrollment starts and prevents non-owner RLS reads', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const sessionId = randomUUID(), tokenHash = 'f'.repeat(64);
      await admin.query(
        `INSERT INTO sessions(id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [sessionId, userId, a.orgId, tokenHash, 'a'.repeat(64)],
      );
      const store = new MfaEnrollmentStore(new TenantDbService(app));
      const ctx = { userId, sessionId, sessionTokenHash: tokenHash };
      const [one, two] = await Promise.all([store.begin(ctx),store.begin(ctx)]);
      expect(one.proposalId).not.toBe(two.proposalId);
      const { rows } = await admin.query(
        "SELECT id,status FROM mfa_enrollment_proposals WHERE user_id=$1", [userId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter(x => x.status === 'PENDING')).toHaveLength(1);

      const otherUserId = randomUUID();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Other member','ACTIVE')",[otherUserId]);
      const hidden = await new TenantDbService(app).withUserContext(otherUserId, async client => {
        const { rows } = await client.query('SELECT id FROM mfa_enrollment_proposals');
        return rows;
      });
      expect(hidden).toHaveLength(0);
    });
  });
});
