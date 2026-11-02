import { Pool } from 'pg';
import assert from 'assert';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction } from '@tradecloseout/db';
import { isValidIndianGstin } from '@tradecloseout/shared';

const appPool = new Pool({
  connectionString: process.env.APP_DATABASE_URL || 'postgres://tc_app:tc_app_pass@127.0.0.1:5432/tradecloseout',
});
const adminPool = new Pool({
  connectionString: process.env.MIGRATOR_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/tradecloseout',
});

const orgA = '0192e000-0000-7000-8000-000000000001';
const ownerA = '0192e000-0000-7000-8000-000000000101';
const orgB = uuidv7();
const userB = uuidv7();

async function setupTestData() {
  await adminPool.query(
    `INSERT INTO users (id, name, status) VALUES ($1, 'Tenant A Owner', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [ownerA],
  );
  await adminPool.query(
    `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
     VALUES ($1, 'Tenant A HVAC Pvt Ltd', 'Tenant A HVAC', 'PRIVATE_LIMITED', 'ACTIVE', 'IN', 'TS')
     ON CONFLICT (id) DO NOTHING`,
    [orgA],
  );
  await adminPool.query(
    `INSERT INTO users (id, name, status) VALUES ($1, 'Tenant B User', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [userB],
  );
  await adminPool.query(
    `INSERT INTO organisations (id, legal_name, display_name, entity_type, status, country, state)
     VALUES ($1, 'Tenant B HVAC LLP', 'Tenant B HVAC', 'LLP', 'ACTIVE', 'IN', 'MH')
     ON CONFLICT (id) DO NOTHING`,
    [orgB],
  );
}

// Dual-mode execution support: Jest or Standalone tsx
const isJest = typeof describe !== 'undefined';

if (isJest) {
  describe('TradeCloseout Database RLS & Integrity Suite (05 §12)', () => {
    beforeAll(async () => {
      await setupTestData();
    });

    afterAll(async () => {
      await appPool.end();
      await adminPool.end();
    });

    it('TC-SEC-01 (AUD-035): Unset app.current_org MUST fail closed with 0 rows', async () => {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT id FROM projects');
        expect(rows.length).toBe(0);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    it('TC-SEC-02 (AUD-014): Cross-tenant query under Org B cannot read Org A projects', async () => {
      await withTenantTransaction(
        appPool,
        {
          orgId: orgB,
          userId: userB,
          actorType: 'MEMBER',
          ip: '127.0.0.1',
          userAgent: 'TestRunner',
          requestId: uuidv7(),
        },
        async (client) => {
          const { rows } = await client.query(`SELECT id FROM projects WHERE org_id = $1`, [orgA]);
          expect(rows.length).toBe(0);
        },
      );
    });

    it('TC-AUD-01 & TC-AUD-02 (FR-AUD-001): Synchronous BEFORE INSERT hash chain + immutability trigger', async () => {
      await withTenantTransaction(
        appPool,
        {
          orgId: orgA,
          userId: ownerA,
          actorType: 'MEMBER',
          ip: '127.0.0.1',
          userAgent: 'TestRunner',
          requestId: uuidv7(),
        },
        async (_client, emit) => {
          emit({
            eventType: 'SECURITY_TEST_EVENT_1',
            entityType: 'ORGANISATION',
            entityId: orgA,
          });
          emit({
            eventType: 'SECURITY_TEST_EVENT_2',
            entityType: 'ORGANISATION',
            entityId: orgA,
          });
        },
      );

      const { rows: chainRows } = await adminPool.query(
        `SELECT chain_seq, prev_hash, hash FROM audit_events
          WHERE org_id = $1
          ORDER BY chain_seq DESC LIMIT 2`,
        [orgA],
      );
      expect(chainRows.length).toBe(2);
      expect(chainRows[0].prev_hash).toBe(chainRows[1].hash);

      await expect(
        appPool.query(`DELETE FROM audit_events WHERE chain_seq = $1`, [chainRows[0].chain_seq]),
      ).rejects.toThrow(/AUDIT_IMMUTABLE/);
    });

    it('TC-VAL-01 (FR-ORG-005): Modulo-36 GSTIN Checksum Verification', () => {
      expect(isValidIndianGstin('36AABCD4512F1Z4')).toBe(true);
      expect(isValidIndianGstin('36AABCD4512F1Z9')).toBe(false);
    });
  });
} else {
  async function runStandalone() {
    console.log('Running TradeCloseout v0.2.1 Database RLS & Integrity Suite (Standalone)...');
    await setupTestData();

    // TC-SEC-01
    {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT id FROM projects');
        assert.strictEqual(rows.length, 0, 'TC-SEC-01 FAILED: RLS must return 0 rows when app.current_org is unset');
        await client.query('COMMIT');
        console.log('  ✓ TC-SEC-01 PASSED: RLS fails closed (0 rows) when tenant context is unset.');
      } finally {
        client.release();
      }
    }

    // TC-SEC-02
    {
      await withTenantTransaction(
        appPool,
        {
          orgId: orgB,
          userId: userB,
          actorType: 'MEMBER',
          ip: '127.0.0.1',
          userAgent: 'TestRunner',
          requestId: uuidv7(),
        },
        async (client) => {
          const { rows } = await client.query(`SELECT id FROM projects WHERE org_id = $1`, [orgA]);
          assert.strictEqual(rows.length, 0, 'TC-SEC-02 FAILED: Tenant B read Tenant A rows!');
        },
      );
      console.log('  ✓ TC-SEC-02 PASSED: Cross-tenant read strictly isolated by PostgreSQL 16 FORCE RLS.');
    }

    // TC-AUD-01 & TC-AUD-02
    {
      await withTenantTransaction(
        appPool,
        {
          orgId: orgA,
          userId: ownerA,
          actorType: 'MEMBER',
          ip: '127.0.0.1',
          userAgent: 'TestRunner',
          requestId: uuidv7(),
        },
        async (_client, emit) => {
          emit({
            eventType: 'SECURITY_TEST_EVENT_1',
            entityType: 'ORGANISATION',
            entityId: orgA,
          });
          emit({
            eventType: 'SECURITY_TEST_EVENT_2',
            entityType: 'ORGANISATION',
            entityId: orgA,
          });
        },
      );

      const { rows: chainRows } = await adminPool.query(
        `SELECT chain_seq, prev_hash, hash FROM audit_events
          WHERE org_id = $1
          ORDER BY chain_seq DESC LIMIT 2`,
        [orgA],
      );
      assert.strictEqual(chainRows.length, 2, 'Expected 2 audit events');
      assert.strictEqual(
        chainRows[0].prev_hash,
        chainRows[1].hash,
        'TC-AUD-01 FAILED: Synchronous hash chain broken between consecutive events',
      );

      await assert.rejects(
        () => appPool.query(`DELETE FROM audit_events WHERE chain_seq = $1`, [chainRows[0].chain_seq]),
        /AUDIT_IMMUTABLE/,
        'TC-AUD-02 FAILED: DELETE on audit_events must be blocked by trigger',
      );
      console.log('  ✓ TC-AUD-01 & TC-AUD-02 PASSED: Synchronous hash-chaining & append-only immutability verified.');
    }

    // TC-VAL-01
    {
      assert.strictEqual(isValidIndianGstin('36AABCD4512F1Z4'), true);
      assert.strictEqual(isValidIndianGstin('36AABCD4512F1Z9'), false);
      console.log('  ✓ TC-VAL-01 PASSED: Modulo-36 Indian GSTIN validator verified.');
    }

    await appPool.end();
    await adminPool.end();
    console.log('ALL DATABASE SECURITY & INTEGRITY TESTS PASSED.');
  }

  runStandalone().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
