import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { consumeAuthenticationBudget } from '../src/modules/identity/auth-security';

jest.setTimeout(180_000);

describe('G01 rate limiting uses one atomic shared security budget', () => {
  it('cannot be bypassed by simultaneous calls through two independent Postgres pools', async () => {
    await withDisposableDatabase(async ({ app, admin }) => {
      const secondNode = new Pool({ ...app.options });
      try {
        const category = `g01:distributed:${uuidv7()}`;
        const key = `source-${uuidv7()}`;
        const limit = 6;
        const requests = Array.from({ length: 16 }, (_, i) =>
          consumeAuthenticationBudget(
            i % 2 ? app : secondNode, category, key, limit, 3600,
          ),
        );
        const outcomes = await Promise.allSettled(requests);
        expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(limit);
        const denials = outcomes.filter(
          (x): x is PromiseRejectedResult => x.status === 'rejected',
        );
        expect(denials).toHaveLength(requests.length - limit);
        for (const denial of denials) {
          expect(denial.reason.getStatus()).toBe(429);
          expect(denial.reason.getResponse()).toMatchObject({
            code: 'RATE_LIMITED',
          });
        }
        const rows = (await admin.query(
          `SELECT budget_key,count FROM auth_request_budgets WHERE budget_key LIKE $1`,
          [category + ':%'],
        )).rows;
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].count)).toBe(16);
        // An attacker changing source keys cannot bypass a separate
        // global/provider-spend budget that remains common to all requests.
        const global = `g01:global:${uuidv7()}`;
        const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
          consumeAuthenticationBudget(
            i % 2 ? app : secondNode, global, 'all', 3, 3600,
          ),
        ));
        expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(3);
      } finally {
        await secondNode.end();
      }
    });
  });
});
