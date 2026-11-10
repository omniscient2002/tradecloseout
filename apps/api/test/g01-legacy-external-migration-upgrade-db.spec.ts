import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';

jest.setTimeout(180_000);

type LegacyRecord = {
  org: string; project: string; document: string;
  version: string; review: string;
};
describe('G01-001 forward migration: real pre-0036 legacy external approvals',()=>{
  it('quarantines both tenants during the actual upgrade but preserves original review rows',async()=>{
    const legacy:LegacyRecord[]=[];
    await withDisposableDatabase(async({admin,app})=>{
      expect(legacy).toHaveLength(2);
      for(const item of legacy){
        const {rows:docs}=await admin.query(
          'SELECT current_approved_version_id FROM documents WHERE id=$1',
          [item.document],
        );
        expect(docs[0].current_approved_version_id).toBeNull();
        const {rows:versions}=await admin.query(
          'SELECT review_status FROM document_versions WHERE id=$1',
          [item.version],
        );
        expect(versions[0].review_status).toBe('CHANGES_REQUESTED');
        expect((await admin.query(
          `SELECT count(*)::int AS n FROM g01_legacy_external_approval_quarantine
             WHERE org_id=$1 AND document_version_id=$2 AND review_id=$3`,
          [item.org,item.version,item.review],
        )).rows[0].n).toBe(1);
        expect((await admin.query(
          `SELECT count(*)::int AS n FROM reviews
             WHERE id=$1 AND status='APPROVED' AND method='EXTERNAL'`,
          [item.review],
        )).rows[0].n).toBe(1);
        // Independently trusted attestation ledgers remain inaccessible to the
        // restricted runtime, even though the migration records its legacy case.
        await expect(app.query(
          'SELECT * FROM g01_legacy_external_approval_quarantine',
        )).rejects.toMatchObject({code:'42501'});
      }
      const {rows:checks}=await admin.query(
        'SELECT g01_quarantine_all_unverified_external_approvals() AS affected',
      );
      expect(Number(checks[0].affected)).toBe(0);
    },{
      baselineThrough:'0035_g01_auth_denial_metadata.sql',
      beforeUpgrade:async(admin:Pool)=>{
        const issuer=uuidv7();
        await admin.query(
          "INSERT INTO users(id,name,status) VALUES($1,'Existing Issuer','ACTIVE')",
          [issuer],
        );
        for(let i=0;i<2;i++){
          const org=uuidv7(),project=uuidv7(),party=uuidv7();
          const document=uuidv7(),version=uuidv7(),storage=uuidv7(),review=uuidv7();
          await admin.query(
            `INSERT INTO organisations(id,legal_name,display_name,state,status)
             VALUES($1,$2,$2,'KA','ACTIVE')`,
            [org,`Legacy Tenant ${i}`],
          );
          await admin.query(
            `INSERT INTO parties(id,org_id,name,types,status)
             VALUES($1,$2,'Original Client',ARRAY['CLIENT']::text[],'ACTIVE')`,
            [party,org],
          );
          await admin.query(
            `INSERT INTO projects(id,org_id,code,name,status,created_by,client_party_id)
             VALUES($1,$2,$3,'Historical External Project','ACTIVE',$4,$5)`,
            [project,org,`G01-HIST-${i}`,issuer,party],
          );
          await admin.query(
            `INSERT INTO storage_objects
              (id,org_id,bucket,object_key,mime,size_bytes,sha256,status,
               provider_version_id,observed_size_bytes)
             VALUES($1,$2,'test','legacy-proof.pdf','application/pdf',100,$3,
                'READY','historical-s3-version',100)`,
            [storage,org,'f'.repeat(64)],
          );
          await admin.query(
            `INSERT INTO documents
              (id,org_id,project_id,title,doc_type_key,category_key,created_by)
             VALUES($1,$2,$3,'Historical external certificate','DT-001','HVAC',$4)`,
            [document,org,project,issuer],
          );
          await admin.query(
            `INSERT INTO document_versions
              (id,org_id,project_id,document_id,version_no,revision_code,
               object_id,file_status,issue_date,review_status,uploaded_by)
             VALUES($1,$2,$3,$4,1,'A',$5,'READY',current_date,'APPROVED',$6)`,
            [version,org,project,document,storage,issuer],
          );
          await admin.query(
            'UPDATE documents SET latest_version_id=$1,current_approved_version_id=$1 WHERE id=$2',
            [version,document],
          );
          await admin.query(
            `INSERT INTO reviews
              (id,org_id,project_id,document_version_id,stage_key,
               reviewer_subject_type,reviewer_subject_id,reviewer_party_id,
               method,external_method,external_approver_name,external_reference,
               evidence_object_id,status,decision)
             VALUES($1,$2,$3,$4,'EXTERNAL_APPROVAL','PARTY',$5,$5,'EXTERNAL',
               'STAMPED_PDF','Unverified historical signatory','HIST-2026',$6,
               'APPROVED','APPROVE')`,
            [review,org,project,version,party,storage],
          );
          legacy.push({org,project,document,version,review});
        }
      },
    });
  });
});
