import { randomUUID } from 'node:crypto';
import { TenantDbService } from '../src/database/tenant-db.service';
import { MfaAttemptBudget } from '../src/modules/identity/mfa-attempt-budget';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120_000);

describe('PH1-G01: durable MFA budget across API replicas', () => {
  it('commits denials without refund on an attempted factor failure and resets expired windows', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId } = await seedTenants(admin);
      const limiter = new MfaAttemptBudget(new TenantDbService(app));
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(limiter.reserve(userId, 'ENROLL_START')).resolves.toBeUndefined();
      }
      await expect(limiter.reserve(userId, 'ENROLL_START')).rejects.toMatchObject({
        response: { code: 'MFA_RATE_LIMITED' },
        status: 429,
      });
      const { rows: spent } = await admin.query(
        "SELECT action,attempts FROM mfa_attempt_budgets WHERE user_id=$1 ORDER BY action",
        [userId],
      );
      expect(spent).toEqual([{ action: 'ENROLL_START', attempts: 6 }, { action: 'GLOBAL', attempts: 6 }]);
      // An independent failing verification transaction must not refund the
      // already-committed attempt budget.
      await expect(new TenantDbService(app).withUserContext(userId, async () => {
        throw new Error('MFA_CODE_INVALID');
      })).rejects.toThrow('MFA_CODE_INVALID');
      const { rows: stillSpent } = await admin.query(
        "SELECT attempts FROM mfa_attempt_budgets WHERE user_id=$1 AND action='ENROLL_START'",
        [userId],
      );
      expect(stillSpent[0].attempts).toBe(6);

      await admin.query(
        "UPDATE mfa_attempt_budgets SET reset_at=now()-interval '1 minute' WHERE user_id=$1",
        [userId],
      );
      await expect(limiter.reserve(userId, 'ENROLL_START')).resolves.toBeUndefined();
      const { rows: reset } = await admin.query(
        "SELECT attempts FROM mfa_attempt_budgets WHERE user_id=$1 AND action='ENROLL_START'",
        [userId],
      );
      expect(reset[0].attempts).toBe(1);

      await admin.query(
        "UPDATE mfa_attempt_budgets SET attempts=2147483647 WHERE user_id=$1 AND action='GLOBAL'",
        [userId],
      );
      await expect(limiter.reserve(userId, 'VERIFY')).rejects.toMatchObject({
        response: { code: 'MFA_RATE_LIMITED' },
      });
      const { rows: capped } = await admin.query(
        "SELECT attempts FROM mfa_attempt_budgets WHERE user_id=$1 AND action='GLOBAL'",
        [userId],
      );
      expect(capped[0].attempts).toBe(21);
    });
  });

  it('shares one atomic recovery allowance across concurrent service instances', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId } = await seedTenants(admin);
      const first = new MfaAttemptBudget(new TenantDbService(app));
      const second = new MfaAttemptBudget(new TenantDbService(app));
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          (i % 2 ? first : second).reserve(userId, 'RECOVERY')),
      );
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(5);
      expect(results.filter(x => x.status === 'rejected')).toHaveLength(7);
      const { rows } = await admin.query(
        "SELECT action,attempts FROM mfa_attempt_budgets WHERE user_id=$1 ORDER BY action",
        [userId],
      );
      expect(rows).toEqual([
        { action: 'GLOBAL', attempts: 12 },
        { action: 'RECOVERY', attempts: 12 },
      ]);
      // RLS: a different account cannot list or update another user's
      // brute-force budget through the restricted runtime role.
      const stranger = randomUUID();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Separate person','ACTIVE')",[stranger]);
      const hidden = await new TenantDbService(app).withUserContext(stranger, async client => {
        const { rows } = await client.query('SELECT user_id FROM mfa_attempt_budgets');
        return rows;
      });
      expect(hidden).toHaveLength(0);
    });
  });
});
