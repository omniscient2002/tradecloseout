import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { assertRuntimeDatabasePrivileges } from '../src/modules/identity/auth-security';

jest.setTimeout(180_000);

/**
 * The contractor runtime must not be able to manufacture the authority that
 * downstream witness/recipient services rely on. A trusted external workflow
 * is intentionally NOT implemented by this SQL safety guard.
 */
describe('G01 external party authority cannot be self-minted by an app role', () => {
  it('rejects direct app-role INSERT/UPDATE approvals while allowing ordinary grant revocation', async () => {
    await withDisposableDatabase(async ({ admin, app }) => {
      // Execute the actual catalog-role query, not only a mocked response.
      await expect(assertRuntimeDatabasePrivileges(app)).resolves.toBeUndefined();
      const issuer=uuidv7(), org=uuidv7(), project=uuidv7(), party=uuidv7(),grant=uuidv7();
      await admin.query(
        `INSERT INTO users(id,name,status) VALUES($1,'Internal Grant Issuer','ACTIVE')`,[issuer]);
      await admin.query(
        `INSERT INTO organisations(id,legal_name,display_name,state,status)
          VALUES($1,'Independent Party Test','Independent Party Test','KA','ACTIVE')`,[org]);
      await admin.query(
        `INSERT INTO projects(id,org_id,code,name,status,created_by)
          VALUES($1,$2,'AUTH-DELEGATION','External authority','ACTIVE',$3)`,
        [project,org,issuer]);
      await admin.query(
        `INSERT INTO parties(id,org_id,name,types,status)
          VALUES($1,$2,'Owner Client',ARRAY['CLIENT']::text[],'ACTIVE')`,[party,org]);

      const client=await app.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
          [org],
        );
        const attempted=client.query(
          `INSERT INTO guest_grants(
            id,org_id,project_id,party_id,grant_type,role,capabilities,
            token_hash,target_email,status,expires_at,created_by,
            independent_authority_verified_at,independent_authority_evidence_ref)
           VALUES($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',
                  ARRAY['package.accept']::text[],$5,'client@g01.example',
                  'ACTIVE',now()+interval '1 day',$6,now(),'unverified-self-claim')`,
          [grant,org,project,party,'a'.repeat(64),issuer],
        );
        await expect(attempted).rejects.toMatchObject({code:'42501'});
        await client.query('ROLLBACK');
      } finally { client.release(); }

      await admin.query(
        `INSERT INTO guest_grants(
          id,org_id,project_id,party_id,grant_type,role,capabilities,
          token_hash,target_email,status,expires_at,created_by)
         VALUES($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',
               ARRAY['package.accept']::text[],$5,'client@g01.example',
               'ACTIVE',now()+interval '1 day',$6)`,
        [grant,org,project,party,'a'.repeat(64),issuer],
      );
      const reviewer=await app.connect();
      try {
        await reviewer.query('BEGIN');
        await reviewer.query(
          "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
          [org],
        );
        await expect(reviewer.query(
          `UPDATE guest_grants SET independent_authority_verified_at=now(),
              independent_authority_evidence_ref='fabricated'
            WHERE org_id=$1 AND id=$2`,[org,grant],
        )).rejects.toMatchObject({code:'42501'});
        await reviewer.query('ROLLBACK');
        await reviewer.query('BEGIN');
        await reviewer.query(
          "SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)",
          [org],
        );
        await expect(reviewer.query(
          `UPDATE guest_grants SET status='REVOKED' WHERE org_id=$1 AND id=$2`,
          [org,grant],
        )).resolves.toMatchObject({rowCount:1});
        await reviewer.query('COMMIT');
      } finally { reviewer.release(); }
      const result=(await admin.query(
        `SELECT status,independent_authority_verified_at,independent_authority_evidence_ref
          FROM guest_grants WHERE id=$1`,[grant])).rows[0];
      expect(result).toMatchObject({
        status:'REVOKED',independent_authority_verified_at:null,
        independent_authority_evidence_ref:null,
      });
    });
  });
});
