import { randomUUID } from 'crypto';
import { withTenantTransaction } from '@tradecloseout/db';
import { TenantDbService } from '../src/database/tenant-db.service';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { seedTenants } from '../../../packages/db/test/helpers/fixtures';

jest.setTimeout(120_000);

describe('PH1-G01-004 / PH1-G26-004: session eligibility inside real tenant transactions', () => {
  it('rechecks active account, tenant, membership, session and current org role before executing work', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a, b] } = await seedTenants(admin);
      for (const orgId of [a.orgId, b.orgId]) {
        await admin.query(
          `INSERT INTO memberships (id,org_id,user_id,role,status)
           VALUES ($1,$2,$3,'R-SITE','ACTIVE')`,
          [randomUUID(), orgId, userId],
        );
      }
      const sessionId = randomUUID();
      await admin.query(
        `INSERT INTO sessions (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [sessionId, userId, a.orgId, 'a'.repeat(64), 'b'.repeat(64)],
      );
      const ctx = {
        orgId: a.orgId, userId, actorType: 'USER' as const,
        orgRole: 'R-SITE', sessionId, requestId: 'live-session-fence-test',
      };
      const service = new TenantDbService(app);
      let entered = 0;
      const permitted = () => service.withTenantContext(ctx, async client => {
        entered += 1;
        const row = await client.query('SELECT 1 AS allowed');
        return row.rows[0].allowed;
      });
      await expect(permitted()).resolves.toBe(1);
      expect(entered).toBe(1);

      await admin.query(
        "UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2",
        [a.orgId, userId],
      );
      await expect(permitted()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);

      // A suspended selected org does not make a different, properly selected
      // and active organisation ineligible.
      const altSessionId = randomUUID();
      await admin.query(
        `INSERT INTO sessions (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [altSessionId, userId, b.orgId, 'c'.repeat(64), 'd'.repeat(64)],
      );
      await expect(service.withTenantContext({
        ...ctx, orgId: b.orgId, sessionId: altSessionId,
      }, async () => 'alternate-active-org')).resolves.toBe('alternate-active-org');

      await admin.query(
        "UPDATE memberships SET status='ACTIVE',role='R-DOC' WHERE org_id=$1 AND user_id=$2",
        [a.orgId, userId],
      );
      await expect(permitted()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);

      await admin.query(
        "UPDATE memberships SET role='R-SITE' WHERE org_id=$1 AND user_id=$2",
        [a.orgId, userId],
      );
      await admin.query("UPDATE organisations SET status='SUSPENDED' WHERE id=$1", [a.orgId]);
      await expect(permitted()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);
      await admin.query("UPDATE organisations SET status='ACTIVE' WHERE id=$1", [a.orgId]);

      await admin.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [userId]);
      await expect(permitted()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);
      await admin.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [userId]);

      await admin.query("UPDATE sessions SET revoked_at=now() WHERE id=$1", [sessionId]);
      await expect(permitted()).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);

      // The shared domain-event transaction wrapper uses the same fence.
      await expect(withTenantTransaction(app, {
        ...ctx, actorType: 'MEMBER', ip: '127.0.0.1', userAgent: 'test',
      }, async () => {
        entered += 1;
      })).rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
      expect(entered).toBe(1);
    });
  });

  it('share-locks session and membership so concurrent logout/offboarding cannot overtake an in-flight command', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      await admin.query(
        "INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,'R-SITE','ACTIVE')",
        [randomUUID(), a.orgId, userId],
      );
      const sessionId = randomUUID();
      await admin.query(
        `INSERT INTO sessions (id,user_id,active_org_id,token_hash,csrf_token_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+interval '1 day')`,
        [sessionId, userId, a.orgId, 'e'.repeat(64), 'f'.repeat(64)],
      );
      const ctx = {
        orgId: a.orgId, userId, actorType: 'USER' as const,
        orgRole: 'R-SITE', sessionId, requestId: 'fence-race',
      };
      let entered!: () => void;
      let finish!: () => void;
      const didEnter = new Promise<void>(resolve => { entered = resolve; });
      const mayFinish = new Promise<void>(resolve => { finish = resolve; });
      const run = new TenantDbService(app).withTenantContext(ctx, async () => {
        entered();
        await mayFinish;
      });
      await didEnter;

      const opposing = await admin.connect();
      try {
        await opposing.query('BEGIN');
        await opposing.query("SET LOCAL lock_timeout='250ms'");
        await expect(opposing.query(
          'UPDATE sessions SET revoked_at=now() WHERE id=$1', [sessionId],
        )).rejects.toMatchObject({ code: '55P03' });
        await opposing.query('ROLLBACK');
        await opposing.query('BEGIN');
        await opposing.query("SET LOCAL lock_timeout='250ms'");
        await expect(opposing.query(
          "UPDATE memberships SET status='SUSPENDED' WHERE org_id=$1 AND user_id=$2",
          [a.orgId, userId],
        )).rejects.toMatchObject({ code: '55P03' });
        await opposing.query('ROLLBACK');
      } finally {
        finish();
        opposing.release();
      }
      await run;
      await admin.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [sessionId]);
      await expect(new TenantDbService(app).withTenantContext(ctx, async () => 1))
        .rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
    });
  });

  it('requires current live guest grant in addition to the linked active session', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      const { userId, tenants: [a] } = await seedTenants(admin);
      const partyId = randomUUID(), grantId = randomUUID(), sessionId = randomUUID();
      await admin.query(
        "INSERT INTO parties (id,org_id,name,types,created_by) VALUES ($1,$2,'Guest issuer',ARRAY['SUPPLIER_OEM']::text[],$3)",
        [partyId, a.orgId, userId],
      );
      await admin.query(
        `INSERT INTO guest_grants
           (id,org_id,project_id,party_id,target_email,role,grant_type,capabilities,scope_json,token_hash,expires_at,created_by)
         VALUES ($1,$2,$3,$4,'guest@example.invalid','R-SUPPLIER-OEM','SUPPLIER_UPLOAD',
           ARRAY['document.upload']::text[],'{}'::jsonb,$5,now()+interval '1 day',$6)`,
        [grantId, a.orgId, a.projectIds[0], partyId, randomUUID(), userId],
      );
      await admin.query(
        `INSERT INTO sessions
           (id,user_id,active_org_id,guest_grant_id,token_hash,csrf_token_hash,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()+interval '1 day')`,
        [sessionId, userId, a.orgId, grantId, 'g'.repeat(64), 'h'.repeat(64)],
      );
      const service = new TenantDbService(app);
      const ctx = {
        orgId: a.orgId, userId, actorType: 'GUEST' as const,
        guestGrantId: grantId, sessionId, requestId: 'guest-revocation-fence',
      };
      await expect(service.withTenantContext(ctx, async () => 'guest-authorized'))
        .resolves.toBe('guest-authorized');
      await admin.query("UPDATE guest_grants SET status='REVOKED' WHERE id=$1", [grantId]);
      await expect(service.withTenantContext(ctx, async () => 'guest-authorized'))
        .rejects.toThrow('AUTH_SESSION_CONTEXT_CHANGED');
    });
  });
});
