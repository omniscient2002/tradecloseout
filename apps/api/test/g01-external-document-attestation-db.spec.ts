import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);

describe('G01 independent real external-document decision evidence',()=>{
  it('requires two different named reviewers, exact stored proof digest and designated party',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const org=uuidv7(),issuer=uuidv7(),project=uuidv7(),party=uuidv7();
      const targetDoc=uuidv7(),targetVersion=uuidv7(),targetStorage=uuidv7();
      const proofDoc=uuidv7(),proofVersion=uuidv7(),proofStorage=uuidv7();
      const evidenceDigest='a'.repeat(64),caseRef='CASE-EXTERNAL-DOC-2026';
      const reviewers=[
        'tc_g01_document_a_'+uuidv7().replace(/-/g,'').slice(0,8),
        'tc_g01_document_b_'+uuidv7().replace(/-/g,'').slice(0,8),
      ];
      const reviewerRoles:string[]=[];
      try{
        for(const name of reviewers){
          await admin.query(`CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
          reviewerRoles.push(name);
          await admin.query(`GRANT tc_external_authority_reviewer TO "${name}"`);
        }
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Evidence Reviewer','ACTIVE')",[issuer]);
        await admin.query(
          `INSERT INTO organisations(id,legal_name,display_name,state,status)
            VALUES($1,'External Evidence Org','External Evidence Org','KA','ACTIVE')`,
          [org],
        );
        await admin.query(
          `INSERT INTO parties(id,org_id,name,types,status)
            VALUES($1,$2,'Designated Client',ARRAY['CLIENT']::text[],'ACTIVE')`,
          [party,org],
        );
        await admin.query(
          `INSERT INTO projects(id,org_id,code,name,status,created_by,client_party_id)
            VALUES($1,$2,'EXT-DOC','External Document Approval','ACTIVE',$3,$4)`,
          [project,org,issuer,party],
        );
        for(const [id,sha,objectKey] of [
          [targetStorage,'b'.repeat(64),'target.pdf'],
          [proofStorage,evidenceDigest,'signed-proof.pdf'],
        ]){
          await admin.query(
            `INSERT INTO storage_objects
              (id,org_id,bucket,object_key,mime,size_bytes,sha256,status,
               provider_version_id,observed_size_bytes)
             VALUES($1,$2,'g01-evidence',$3,'application/pdf',100,$4,'READY','s3-version-fixture',100)`,
            [id,org,objectKey,sha],
          );
        }
        for(const [doc,name] of [[targetDoc,'Project Review'],[proofDoc,'External Signed Letter']]){
          await admin.query(
            `INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by)
              VALUES($1,$2,$3,$4,'DT-001','HVAC',$5)`,
            [doc,org,project,name,issuer],
          );
        }
        for(const [ver,doc,obj] of [
          [targetVersion,targetDoc,targetStorage],
          [proofVersion,proofDoc,proofStorage],
        ]){
          await admin.query(
            `INSERT INTO document_versions
              (id,org_id,project_id,document_id,version_no,revision_code,
               object_id,file_status,issue_date,uploaded_by)
             VALUES($1,$2,$3,$4,1,'A',$5,'READY',current_date,$6)`,
            [ver,org,project,doc,obj,issuer],
          );
        }
        await expect(app.query(
          'SELECT * FROM attest_external_document_approval($1,$2,$3,$4,$5,$6)',
          [org,targetVersion,proofVersion,party,evidenceDigest,caseRef],
        )).rejects.toMatchObject({code:'42501'});
        await expect(app.query(
          'SELECT * FROM external_document_approval_attestations',
        )).rejects.toMatchObject({code:'42501'});

        const check=async()=> {
          const client=await app.connect();
          try{
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.current_org',$1,true)",[org]);
            const {rows}=await client.query(
              'SELECT has_verified_external_document_approval($1,$2,$3,$4) AS valid',
              [org,targetVersion,proofVersion,party],
            );
            await client.query('COMMIT');
            return rows[0].valid;
          }catch(err){
            await client.query('ROLLBACK').catch(()=>{});
            throw err;
          }finally{client.release();}
        };
        expect(await check()).toBe(false);
        // Upgrade from pre-0032 approval: an internal actor could already
        // have stamped a contractor-supplied proof as external ACCEPTED.
        // Add an honest legacy review fixture and prove quarantine retracts
        // current readiness while preserving the historical review/proof.
        const historicalReview=uuidv7();
        await admin.query(
          `INSERT INTO reviews
            (id,org_id,project_id,document_version_id,stage_key,
             reviewer_subject_type,reviewer_subject_id,reviewer_party_id,
             method,external_method,external_approver_name,external_reference,
             evidence_object_id,external_proof_version_id,status,decision)
           VALUES($1,$2,$3,$4,'EXTERNAL_APPROVAL','PARTY',$5,$5,
             'EXTERNAL','STAMPED_PDF','Legacy signer','LEGACY-2026',
             $6,$7,'APPROVED','APPROVE')`,
          [historicalReview,org,project,targetVersion,party,proofStorage,proofVersion],
        );
        await admin.query(
          "UPDATE document_versions SET review_status='APPROVED' WHERE id=$1",
          [targetVersion],
        );
        await admin.query(
          'UPDATE documents SET current_approved_version_id=$1 WHERE id=$2',
          [targetVersion,targetDoc],
        );
        await expect(app.query(
          'SELECT g01_quarantine_unverified_current_external_approvals()',
        )).rejects.toMatchObject({code:'42501'});
        const legacy=(await admin.query(
          'SELECT g01_quarantine_unverified_current_external_approvals() AS n',
        )).rows[0].n;
        expect(legacy).toBe(1);
        expect((await admin.query(
          'SELECT current_approved_version_id FROM documents WHERE id=$1',
          [targetDoc],
        )).rows[0].current_approved_version_id).toBeNull();
        expect((await admin.query(
          'SELECT review_status FROM document_versions WHERE id=$1',
          [targetVersion],
        )).rows[0].review_status).toBe('CHANGES_REQUESTED');
        expect((await admin.query(
          'SELECT count(*)::int AS n FROM g01_legacy_external_approval_quarantine WHERE document_version_id=$1',
          [targetVersion],
        )).rows[0].n).toBe(1);
        expect((await admin.query(
          'SELECT count(*)::int AS n FROM reviews WHERE id=$1',
          [historicalReview],
        )).rows[0].n).toBe(1);
        expect((await admin.query(
          'SELECT g01_quarantine_unverified_current_external_approvals() AS n',
        )).rows[0].n).toBe(0);

        const attest=async(login:string,sha=evidenceDigest,ref=caseRef)=>{
          const client=await admin.connect();
          try{
            await client.query(`SET SESSION AUTHORIZATION "${login}"`);
            const {rows}=await client.query(
              'SELECT * FROM attest_external_document_approval($1,$2,$3,$4,$5,$6)',
              [org,targetVersion,proofVersion,party,sha,ref],
            );
            return rows[0];
          }finally{
            await client.query('RESET SESSION AUTHORIZATION').catch(()=>{});
            client.release();
          }
        };
        await expect(attest(reviewers[0],'c'.repeat(64))).rejects.toMatchObject({code:'42501'});
        expect(await attest(reviewers[0])).toMatchObject({review_count:1,independently_verified:false});
        expect(await check()).toBe(false);
        await expect(attest(reviewers[0])).rejects.toMatchObject({code:'23505'});
        await expect(attest(reviewers[1],evidenceDigest,'DIFFERENT-CASE-REFERENCE'))
          .rejects.toMatchObject({code:'22023'});
        expect(await attest(reviewers[1])).toMatchObject({review_count:2,independently_verified:true});
        expect(await check()).toBe(true);
        // Once two independent reviews exist, the SAME historical external
        // proof can no longer be automatically invalidated during a rerun.
        await admin.query(
          "UPDATE document_versions SET review_status='APPROVED' WHERE id=$1",
          [targetVersion],
        );
        await admin.query(
          'UPDATE documents SET current_approved_version_id=$1 WHERE id=$2',
          [targetVersion,targetDoc],
        );
        expect((await admin.query(
          'SELECT g01_quarantine_unverified_current_external_approvals() AS n',
        )).rows[0].n).toBe(0);
        expect((await admin.query(
          'SELECT current_approved_version_id FROM documents WHERE id=$1',
          [targetDoc],
        )).rows[0].current_approved_version_id).toBe(targetVersion);
        // Simulate a previously committed externally approved document so a
        // later independent revocation cannot leave readiness trusting it.
        await admin.query(
          `UPDATE document_versions SET review_status='APPROVED'
            WHERE id=$1`,[targetVersion],
        );
        await admin.query(
          `UPDATE documents SET current_approved_version_id=$1
            WHERE id=$2`,[targetVersion,targetDoc],
        );

        // Emergency revocation is an independent, immutable platform action
        // and immediately changes the normal API's boolean decision.
        const emergency=await admin.connect();
        try {
          await emergency.query(`SET SESSION AUTHORIZATION "${reviewers[0]}"`);
          const {rows}=await emergency.query(
            'SELECT revoke_external_document_approval($1,$2,$3,$4,$5) AS revoked',
            [org,targetVersion,proofVersion,party,'INCIDENT-EXT-DOC-2026'],
          );
          expect(rows[0].revoked).toBe(true);
        } finally {
          await emergency.query('RESET SESSION AUTHORIZATION').catch(()=>{});
          emergency.release();
        }
        expect(await check()).toBe(false);
        const revokedDocument=(await admin.query(
          'SELECT current_approved_version_id FROM documents WHERE id=$1',
          [targetDoc],
        )).rows[0];
        expect(revokedDocument.current_approved_version_id).toBeNull();
        expect((await admin.query(
          'SELECT review_status FROM document_versions WHERE id=$1',
          [targetVersion],
        )).rows[0].review_status).toBe('CHANGES_REQUESTED');
        await expect(admin.query(
          `UPDATE external_document_approval_revocations SET reason_ref='TAMPERED'
             WHERE document_version_id=$1`,[targetVersion],
        )).rejects.toMatchObject({code:'42501'});

        await expect(admin.query(
          `UPDATE external_document_approval_attestations
            SET evidence_ref='TAMPERED' WHERE document_version_id=$1`,[targetVersion],
        )).rejects.toMatchObject({code:'42501'});
        await expect(admin.query(
          'DELETE FROM external_document_approval_attestations WHERE document_version_id=$1',
          [targetVersion],
        )).rejects.toMatchObject({code:'42501'});
        // A later project-party reassignment must not silently reuse
        // historical attestations as authority for another counterparty.
        const replacementParty=uuidv7();
        await admin.query(
          `INSERT INTO parties(id,org_id,name,types,status)
            VALUES($1,$2,'Replacement Client',ARRAY['CLIENT']::text[],'ACTIVE')`,
          [replacementParty,org],
        );
        await admin.query(
          'UPDATE projects SET client_party_id=$1 WHERE id=$2',
          [replacementParty,project],
        );
        expect(await check()).toBe(false);
      }finally{
        for(const name of reviewerRoles.reverse()){
          await admin.query(`REVOKE tc_external_authority_reviewer FROM "${name}"`).catch(()=>{});
          await admin.query(`DROP ROLE IF EXISTS "${name}"`).catch(()=>{});
        }
      }
    });
  });
});
