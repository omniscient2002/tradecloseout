import { HttpException, HttpStatus } from '@nestjs/common';
import { TenantDbService } from '../../database/tenant-db.service';

export type MfaBudgetAction =
  | 'ENROLL_START' | 'ENROLL_CONFIRM' | 'VERIFY' | 'RECOVERY' | 'CANCEL';
const LIMITS: Record<MfaBudgetAction, number> = {
  ENROLL_START: 5,
  ENROLL_CONFIRM: 10,
  VERIFY: 10,
  RECOVERY: 5,
  CANCEL: 10,
};

/**
 * PostgreSQL-backed, cross-process brute-force prevention. Budgets are
 * consumed in a SEPARATE committed transaction so a bad OTP/TOTP or a
 * subsequent factor rollback never refunds the invalid attempt.
 */
export class MfaAttemptBudget {
  constructor(private readonly db: TenantDbService) {}

  async reserve(userId: string, action: MfaBudgetAction): Promise<void> {
    if (!userId || !(action in LIMITS)) {
      throw new Error('MFA_BUDGET_INVALID_ARGUMENT');
    }
    const permitted = await this.db.withUserContext(userId, async client => {
      const consume = async (name: string): Promise<number> => {
        const { rows } = await client.query(
          `INSERT INTO mfa_attempt_budgets(user_id,action,attempts,reset_at)
           VALUES($1,$2,1,now()+interval '15 minutes')
           ON CONFLICT (user_id,action) DO UPDATE
              SET attempts=CASE WHEN mfa_attempt_budgets.reset_at<=now() THEN 1
                                ELSE mfa_attempt_budgets.attempts+1 END,
                  reset_at=CASE WHEN mfa_attempt_budgets.reset_at<=now()
                                THEN now()+interval '15 minutes'
                                ELSE mfa_attempt_budgets.reset_at END
           RETURNING attempts`,
          [userId, name],
        );
        if (rows.length !== 1) throw new Error('MFA_BUDGET_WRITE_LOST');
        return Number(rows[0].attempts);
      };
      const allAttempts = await consume('GLOBAL');
      const actionAttempts = await consume(action);
      return allAttempts <= 20 && actionAttempts <= LIMITS[action];
    });
    if (!permitted) {
      throw new HttpException({
        code: 'MFA_RATE_LIMITED',
        detail: 'Too many authentication attempts. Try again later.',
        retryable: true,
        retryAfterSeconds: 900,
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
