import { randomUUID } from 'node:crypto';
import { withTenantTransaction } from '@tradecloseout/db';
import { TenantDbService } from '../src/database/tenant-db.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120_000);

describe('PH1-G01-004 — an admitted MFA session cannot outlive its factor in protected work', () => {
  it('checks current enrolled factor and session MFA bit in both real PostgreSQL RLS transaction wrappers', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const sessionId = randomUUID();
      const tokenHash = 'a'.repeat(64);
      await admin.query(
        "INSERT INTO memberships (id,org_id,user_id,role,status) VALUES ($1,$2,$3,'R-OWNER','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      await admin.query(
        "UPDATE users SET mfa_enabled_at=now() WHERE id=$1", [userId],
      );
      await admin.query(
        `INSERT INTO sessions
            (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at,mfa_verified)
          VALUES ($1,$2,$3,$4,$5,now()+interval '1 day',true)`,
        [sessionId, userId, a.orgId, tokenHash, 'b'.repeat(64)],
      );

      const ctx = {
        orgId: a.orgId, userId, sessionId, sessionTokenHash: tokenHash,
        orgRole: 'R-OWNER', mfaVerified: true,
        actorType: 'USER' as const, requestId: 'mfa-tx-fence',
      };
      const db = new TenantDbService(app);
      let entries = 0;
      const authorized = () => db.withTenantContext(ctx, async () => ++entries);
      const domain = () => withTenantTransaction(app, {
        ...ctx, actorType: 'MEMBER' as const,
        ip: '127.0.0.1', userAgent: 'mfa-fence',
      }, async () => ++entries);

      await expect(authorized()).resolves.toBe(1);
      await expect(domain()).resolves.toBe(2);

      // Reset a factor after the guard has observed an authenticated request.
      // The session cookie and stored session bit may still be unchanged.
      await admin.query("UPDATE users SET mfa_enabled_at=NULL WHERE id=$1", [userId]);
      await expect(authorized()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      await expect(domain()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entries).toBe(2);

      await admin.query("UPDATE users SET mfa_enabled_at=now() WHERE id=$1", [userId]);
      await admin.query("UPDATE sessions SET mfa_verified=false WHERE id=$1", [sessionId]);
      await expect(authorized()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      await expect(domain()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entries).toBe(2);

      // Reverification re-establishes a valid live factor and session state.
      await admin.query("UPDATE sessions SET mfa_verified=true WHERE id=$1", [sessionId]);
      await expect(authorized()).resolves.toBe(3);
    });
  });

  it('holds factor eligibility stable while an MFA-strength command executes', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const sessionId = randomUUID();
      await admin.query(
        "INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-OWNER','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      await admin.query("UPDATE users SET mfa_enabled_at=now() WHERE id=$1", [userId]);
      await admin.query(
        `INSERT INTO sessions
          (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at,mfa_verified)
         VALUES($1,$2,$3,$4,$5,now()+interval '1 day',true)`,
        [sessionId, userId, a.orgId, 'c'.repeat(64), 'd'.repeat(64)],
      );

      let signalEnter!: () => void;
      let finishCommand!: () => void;
      const entered = new Promise<void>(resolve => { signalEnter = resolve; });
      const released = new Promise<void>(resolve => { finishCommand = resolve; });
      const task = new TenantDbService(app).withTenantContext({
        orgId: a.orgId, userId, sessionId,
        sessionTokenHash: 'c'.repeat(64), mfaVerified: true,
        orgRole: 'R-OWNER', actorType: 'USER', requestId: 'mfa-reset-race',
      }, async () => {
        signalEnter();
        await released;
      });
      await entered;
      const opponent = await admin.connect();
      try {
        await opponent.query('BEGIN');
        await opponent.query("SET LOCAL lock_timeout='250ms'");
        await expect(opponent.query(
          "UPDATE users SET mfa_enabled_at=NULL WHERE id=$1", [userId],
        )).rejects.toMatchObject({code:'55P03'});
        await opponent.query('ROLLBACK');
      } finally {
        finishCommand();
        opponent.release();
      }
      await task;
    });
  });
});
