import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);

/**
 * Two independently authenticated, platform-managed database reviewer identities
 * must agree on the same external-delegation evidence. The normal app role
 * cannot see or insert reviews or call the signer. Test credentials are never
 * used for a customer counterparty or a real legal-attestation decision.
 */
describe('G01 trusted independent external-party authority', () => {
  it('requires two distinct reviewers, matching evidence, and immutable signed grant', async () => {
    await withDisposableDatabase(async ({admin,app}) => {
      const org=uuidv7(), issuer=uuidv7(),project=uuidv7(),party=uuidv7(),grant=uuidv7();
      const reviewerNames = [
        'tc_g01reviewer_a_' + uuidv7().replace(/-/g,'').slice(0,8),
        'tc_g01reviewer_b_' + uuidv7().replace(/-/g,'').slice(0,8),
      ];
      const reviewersReady:string[] = [];
      try {
        for(const name of reviewerNames){
          await admin.query(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
          reviewersReady.push(name);
          await admin.query(`GRANT tc_external_authority_reviewer TO "${name}"`);
        }
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Issuing Contractor','ACTIVE')",[issuer]);
        await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state,status)
          VALUES($1,'Trust Boundary Test','Trust Boundary Test','KA','ACTIVE')`,[org]);
        await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
          VALUES($1,$2,'TRUST-REVIEW','Independent authority','ACTIVE',$3)`,
          [project,org,issuer]);
        await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
          VALUES($1,$2,'Independent Client',ARRAY['CLIENT']::text[],'ACTIVE')`,[party,org]);
        await admin.query(`INSERT INTO guest_grants
          (id,org_id,project_id,party_id,grant_type,role,capabilities,
           token_hash,target_email,status,expires_at,created_by)
          VALUES ($1,$2,$3,$4,'CLIENT_VIEW','R-CLIENT',
           ARRAY['package.accept']::text[],$5,'independent@g01.test',
           'ACTIVE',now()+interval '1 day',$6)`,
          [grant,org,project,party,createHash('sha256').update('a'.repeat(64)).digest('hex'),issuer]);
        const digest='b'.repeat(64),reference='CASE-G01-EXTERNAL-2026';
        const args=[org,grant,digest,reference];

        await expect(app.query(
          'SELECT * FROM approve_external_guest_authority($1,$2,$3,$4)',args,
        )).rejects.toMatchObject({code:'42501'});
        await expect(app.query(
          'SELECT * FROM external_authority_reviews WHERE grant_id=$1',[grant],
        )).rejects.toMatchObject({code:'42501'});

        const asReviewer=async(name:string,evidence:string=digest,ref:string=reference)=>{
          const client=await admin.connect();
          try {
            await client.query(`SET SESSION AUTHORIZATION "${name}"`);
            return (await client.query(
              'SELECT * FROM approve_external_guest_authority($1,$2,$3,$4)',
              [org,grant,evidence,ref],
            )).rows[0];
          } finally {
            await client.query('RESET SESSION AUTHORIZATION').catch(()=>{});
            client.release();
          }
        };

        expect(await asReviewer(reviewerNames[0])).toMatchObject({
          review_count:1,independently_verified:false,
        });
        expect((await admin.query(
          'SELECT independent_authority_verified_at FROM guest_grants WHERE id=$1',[grant],
        )).rows[0].independent_authority_verified_at).toBeNull();

        await expect(asReviewer(reviewerNames[0])).rejects.toMatchObject({code:'23505'});
        await expect(asReviewer(reviewerNames[1],'c'.repeat(64))).rejects.toMatchObject({code:'22023'});
        expect(await asReviewer(reviewerNames[1])).toMatchObject({
          review_count:2,independently_verified:true,
        });

        const { rows: grants }=await admin.query(
          `SELECT independent_authority_verified_at,independent_authority_evidence_ref
             FROM guest_grants WHERE id=$1`,[grant]);
        expect(grants[0].independent_authority_verified_at).toBeTruthy();
        expect(grants[0].independent_authority_evidence_ref).toBe(reference);
        const { rows: reviews }=await admin.query(
          'SELECT reviewer_session_user,evidence_digest FROM external_authority_reviews WHERE grant_id=$1',[grant]);
        expect(reviews).toHaveLength(2);
        expect(new Set(reviews.map(x=>x.reviewer_session_user)).size).toBe(2);
        expect(reviews.every(x=>x.evidence_digest.trim()===digest)).toBe(true);

        await expect(app.query(
          `UPDATE guest_grants SET independent_authority_verified_at=NULL WHERE id=$1`,[grant],
        )).rejects.toMatchObject({code:'42501'});
        await expect(asReviewer(reviewerNames[1])).rejects.toMatchObject({code:'23505'});
      } finally {
        for(const name of reviewersReady.reverse()){
          await admin.query(`REVOKE tc_external_authority_reviewer FROM "${name}"`).catch(()=>{});
          await admin.query(`DROP ROLE IF EXISTS "${name}"`).catch(()=>{});
        }
      }
    });
  });
});
