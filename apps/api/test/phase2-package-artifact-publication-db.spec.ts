import {createHash} from 'crypto';
import {uuidv7} from 'uuidv7';
import {PDFDocument} from 'pdf-lib';
import {PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {attachSyntheticEntitlementPolicy} from '../../../packages/db/test/helpers/synthetic-entitlement-policy';
import {storageServer} from '../../worker/test/helpers/storage-server';
import {compileAndPersistHandoverPackage} from '../../worker/src/queues/handover-package.processor';

jest.setTimeout(180_000);

// This is a frozen compiler/accounting fixture, not an HVAC baseline, scanner
// approval, real provider integration or production acceptance evidence.
describe('Phase2 generated artifact admission through the actual compiler',()=>{
  it('reserves before provider PUT, publishes only a verified reservation, replays once and fences a lost build owner',async()=>{
    const previousBucket=process.env.S3_BUCKET;
    process.env.S3_BUCKET='synthetic-package-bucket';
    const storage=await storageServer();
    try {await withDisposableDatabase(async({admin,app})=>{
      const org=uuidv7(),user=uuidv7(),project=uuidv7(),doc=uuidv7(),version=uuidv7(),object=uuidv7();
      await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic compiler owner','ACTIVE')",[user]);
      await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
        VALUES($1,'Synthetic compiler fixture','Synthetic compiler fixture','KA')`,[org]);
      await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
        VALUES($1,$2,'SYNTHETIC-COMPILER','Synthetic compiler accounting fixture','ACTIVE',$3)`,[project,org,user]);
      const pdf=await PDFDocument.create();pdf.addPage();const bytes=Buffer.from(await pdf.save());
      const sha=createHash('sha256').update(bytes).digest('hex');
      storage.objects.set('synthetic-source.pdf:pinned-source',bytes);
      await admin.query(`INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes,observed_size_bytes,provider_version_id,sha256,status)
        VALUES($1,$2,'synthetic-source-bucket','synthetic-source.pdf','application/pdf',$3,$3,'pinned-source',$4,'READY')`,[object,org,bytes.length,sha]);
      await admin.query(`INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by)
        VALUES($1,$2,$3,'Synthetic compiler input; not HVAC evidence','DT-018','SYNTHETIC',$4)`,[doc,org,project,user]);
      await admin.query(`INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,review_status,issue_date)
        VALUES($1,$2,$3,$4,1,'SYNTHETIC',$5,'READY','NOT_SUBMITTED',CURRENT_DATE)`,[version,org,project,doc,object]);
      const offer=async(cap:number)=>{
        const id=uuidv7();
        await admin.query(`INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status)
          VALUES($1,$2,'Synthetic compiler offer',$3,0,'MONTH','ACTIVE')`,[id,id,JSON.stringify({maxSeats:0,maxActiveProjects:1,maxStorageBytes:cap,maxPackageGenerationsPerMonth:2})]);
        await attachSyntheticEntitlementPolicy(admin,id);
        await admin.query(`INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end)
          VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day') ON CONFLICT(org_id) DO UPDATE SET plan_id=EXCLUDED.plan_id`,[uuidv7(),org,id]);
      };
      const makePackage=async(n:number)=>{
        const id=uuidv7();
        await admin.query(`INSERT INTO handover_packages(id,org_id,project_id,version_no,status,snapshot_checksum,requested_by)
          VALUES($1,$2,$3,$4,'QUEUED','synthetic-frozen-compiler-input',$5)`,[id,org,project,n,user]);
        await admin.query(`INSERT INTO package_items(id,org_id,project_id,package_id,document_version_id,section_key,sort_order,included)
          VALUES($1,$2,$3,$4,$5,'SYNTHETIC',1,true)`,[uuidv7(),org,project,id,version]);
        return {orgId:org,projectId:project,packageId:id,eventId:uuidv7()};
      };
      await offer(0);const job=await makePackage(1);
      await expect(compileAndPersistHandoverPackage(app,storage.s3,job,'synthetic-job-1',true)).rejects.toThrow('STORAGE_QUOTA_EXCEEDED');
      expect(storage.uploads).toHaveLength(0);
      await offer(50_000_000);
      const built=await compileAndPersistHandoverPackage(app,storage.s3,job,'synthetic-job-1',true);
      expect(built.status).toBe('READY');
      expect(storage.uploads).toHaveLength(1);
      const recorded=(await admin.query(`SELECT hp.status,hp.pdf_object_id,hp.build_object_id,so.status AS storage_status,
        so.size_bytes,so.sha256,so.provider_version_id FROM handover_packages hp JOIN storage_objects so ON so.id=hp.pdf_object_id WHERE hp.id=$1`,[job.packageId])).rows[0];
      expect(recorded.status).toBe('READY');expect(recorded.storage_status).toBe('READY');expect(recorded.pdf_object_id).toBe(recorded.build_object_id);
      expect(recorded.sha256).toBe(createHash('sha256').update(storage.uploads[0].bytes).digest('hex'));
      expect(recorded.provider_version_id).toBe(storage.uploads[0].version);
      await compileAndPersistHandoverPackage(app,storage.s3,job,'synthetic-replay',true);
      expect(storage.uploads).toHaveLength(1);

      const stale=await makePackage(2);
      const takeover={send:async(command:any)=>{
        const response=await storage.s3.send(command);
        if(command instanceof PutObjectCommand)await admin.query("UPDATE handover_packages SET error_code='INDEPENDENT_REPLACEMENT_BUILD' WHERE id=$1",[stale.packageId]);
        return response;
      }} as S3Client;
      await expect(compileAndPersistHandoverPackage(app,takeover,stale,'synthetic-stale-job',true)).rejects.toThrow('PACKAGE_BUILD_LEASE_LOST');
      const denied=(await admin.query('SELECT status,pdf_object_id,build_object_id FROM handover_packages WHERE id=$1',[stale.packageId])).rows[0];
      expect(denied.status).toBe('GENERATING');expect(denied.pdf_object_id).toBeNull();expect(denied.build_object_id).toBeTruthy();
      expect((await admin.query('SELECT status FROM storage_objects WHERE id=$1',[denied.build_object_id])).rows[0].status).toBe('PENDING');
    });} finally {
      await storage.close();if(previousBucket===undefined)delete process.env.S3_BUCKET;else process.env.S3_BUCKET=previousBucket;
    }
  });
});
