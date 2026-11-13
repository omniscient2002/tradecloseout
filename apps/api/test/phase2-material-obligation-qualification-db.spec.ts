import {randomUUID,createHash} from 'crypto';
import {PDFDocument} from 'pdf-lib';
import {withDisposableDatabase} from '../../../packages/db/test/helpers/disposable-database';
import {seedTenants,scoped} from '../../../packages/db/test/helpers/fixtures';
import {ChecklistsService} from '../src/modules/checklists/checklists.service';
import {ConfigurationService} from '../src/modules/configuration/configuration.service';
import {ReviewsService} from '../src/modules/reviews/reviews.service';
import {HandoverService} from '../src/modules/handover/handover.service';
import {TenantDbService} from '../src/database/tenant-db.service';
jest.setTimeout(180000);
it('material changes invalidate exceptions and applicable review proof while preserving immutable evidence and authorship',async()=>{
 await withDisposableDatabase(async({admin,app})=>{
  const {userId:author,tenants:[tenant]}=await seedTenants(admin),org=tenant.orgId,project=tenant.projectIds[0],reviewer=randomUUID(),qc=randomUUID();
  await admin.query("UPDATE projects SET status='DRAFT' WHERE id=$1",[project]);
  for(const [user,role]of [[author,'R-OWNER'],[reviewer,'R-ADMIN'],[qc,'R-QC']]){
   if(user!==author)await admin.query("INSERT INTO users(id,name,status) VALUES($1,$2,'ACTIVE')",[user,role]);
   await admin.query("INSERT INTO memberships(id,org_id,user_id,role,status) VALUES($1,$2,$3,$4,'ACTIVE')",[randomUUID(),org,user,role]);
  }
  await admin.query("INSERT INTO project_members(id,org_id,project_id,user_id,role,status,added_by) VALUES($1,$2,$3,$4,'R-QC','ACTIVE',$5)",[randomUUID(),org,project,qc,author]);
  const owner:any={orgId:org,userId:author,orgRole:'R-OWNER',actorType:'MEMBER',requestId:randomUUID()},independent={...owner,userId:reviewer,orgRole:'R-ADMIN'};
  const checklists=new ChecklistsService(app),configuration=new ConfigurationService(app,checklists),reviews=new ReviewsService(new TenantDbService(app)),handover=new HandoverService(app,{} as any);
  const requirement={key:'SYNTHETIC-OBLIGATION',title:'Synthetic obligation A',groupKey:'SYNTHETIC',docTypeKey:'SYNTHETIC-EVIDENCE',mandatory:true,locked:false,scopeType:'PROJECT',reviewerRole:'R-QC',validityRule:{rule:'SYNTHETIC_A'}};
  const otherRequirement={...requirement,key:'SYNTHETIC-SECONDARY',title:'Different review authority on the same document',mandatory:false,reviewerRole:'R-ADMIN'};
  const first=await configuration.createVersion(owner,{level:'PROJECT',scopeId:project,payload:{requirements:[requirement,otherRequirement]}});await configuration.publish(independent,first.id);
  const baseline=await configuration.apply(owner,project,{versionIds:[first.id],reason:'Synthetic obligation mechanics only'});await checklists.reviewBaseline(independent,project,{snapshotId:baseline.snapshotId,checksum:baseline.checksum,reason:'Independent synthetic baseline control'});
  await admin.query("UPDATE projects SET status='ACTIVE' WHERE id=$1",[project]);
  const req=(await admin.query('SELECT id FROM requirements WHERE org_id=$1 AND project_id=$2 AND requirement_key=$3',[org,project,requirement.key])).rows[0].id;
  const otherReq=(await admin.query('SELECT id FROM requirements WHERE org_id=$1 AND project_id=$2 AND requirement_key=$3',[org,project,otherRequirement.key])).rows[0].id;
  // A generated valid PDF and synthetic verified-object state isolate qualification.
  // This does not certify scanning or real provider acceptance.
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Synthetic qualification fixture only');const bytes=await pdf.save(),sha=createHash('sha256').update(bytes).digest('hex');
  const object=randomUUID(),document=randomUUID(),version=randomUUID();
  await admin.query(`INSERT INTO storage_objects(id,org_id,bucket,object_key,mime,size_bytes,sha256,status,av_scanned_at,observed_size_bytes,provider_version_id)
    VALUES($1,$2,'synthetic-fixtures',$3,'application/pdf',$4,$5,'READY',now(),$4,'synthetic-object-version')`,[object,org,object,bytes.length,sha]);
  await admin.query("INSERT INTO documents(id,org_id,project_id,title,doc_type_key,category_key,created_by) VALUES($1,$2,$3,'Synthetic fixture PDF','SYNTHETIC-EVIDENCE','SYNTHETIC',$4)",[document,org,project,author]);
  await admin.query("INSERT INTO document_versions(id,org_id,project_id,document_id,version_no,revision_code,object_id,file_status,review_status,issue_date,uploaded_by) VALUES($1,$2,$3,$4,1,'R1',$5,'READY','NOT_SUBMITTED',CURRENT_DATE,$6)",[version,org,project,document,object,author]);
  await admin.query('UPDATE documents SET latest_version_id=$2 WHERE id=$1',[document,version]);
  const uploader:any={...owner,actorType:'USER'},technical:any={...owner,userId:qc,actorType:'USER',orgRole:'R-QC',projectId:project,projectRole:'R-QC',projectScope:{}};
  expect((await reviews.listReviewCandidates(uploader,req,version)).items.map((candidate:any)=>candidate.userId)).toEqual([qc]);
  await expect(reviews.submitReview(uploader,req,{documentVersionId:version,reviewerUserId:author})).rejects.toThrow('ELIGIBLE_REVIEWER_SELECTION_REQUIRED');
  const firstReview=await reviews.submitReview(uploader,req,{documentVersionId:version,reviewerUserId:qc});
  expect(await reviews.submitReview(uploader,req,{documentVersionId:version,reviewerUserId:qc})).toMatchObject({reviewId:firstReview.reviewId});
  const otherReview=await reviews.submitReview(uploader,otherReq,{documentVersionId:version,reviewerUserId:reviewer});
  const queue=await reviews.listReviews({...uploader,projectId:project},project);
  expect(queue).toHaveLength(2);
  expect(queue.find((row:any)=>row.id===firstReview.reviewId).requirement_id).toBe(req);
  expect(queue.find((row:any)=>row.id===otherReview.reviewId).requirement_id).toBe(otherReq);
  expect(await reviews.getVersionReviewDetail(technical,project,version)).toMatchObject({reviewId:firstReview.reviewId,requirementId:req});
  const rowVersion=async()=>(await admin.query('SELECT row_version FROM document_versions WHERE id=$1',[version])).rows[0].row_version;
  await reviews.decideReview(technical,firstReview.reviewId,{decision:'APPROVE',expectedRowVersion:await rowVersion()});
  expect((await handover.evaluateProjectReadiness(owner,project)).readyWithoutOverride).toBe(true);
  const oldQualification=(await admin.query('SELECT * FROM requirement_evidence_qualifications WHERE requirement_id=$1',[req])).rows[0];expect(oldQualification.created_by).toBe(qc);
  await admin.query("INSERT INTO waivers(id,org_id,project_id,requirement_id,type,reason,requested_by,approved_by,second_approved_by,status) VALUES($1,$2,$3,$4,'WAIVE','Synthetic historical exception',$5,$5,$6,'ACTIVE')",[randomUUID(),org,project,req,author,reviewer]);
  const packageId=randomUUID(),submission=randomUUID();
  // Draft records check obsolescence markers; they are not claimed accepted packages.
  await admin.query("INSERT INTO handover_packages(id,org_id,project_id,version_no,status,snapshot_id,snapshot_checksum,requested_by) VALUES($1,$2,$3,1,'DRAFT',$4,$5,$6)",[packageId,org,project,baseline.snapshotId,baseline.checksum,author]);
  await admin.query("INSERT INTO submissions(id,org_id,project_id,package_id,status,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5)",[submission,org,project,packageId,author]);
  const pending=await reviews.submitReview(uploader,req,{documentVersionId:version,reviewerUserId:qc}),staleVersion=await rowVersion();
  const changed={...requirement,title:'Synthetic obligation B',validityRule:{rule:'SYNTHETIC_B'},dueDate:'2030-01-02'};
  const next=await configuration.createVersion(owner,{level:'PROJECT',scopeId:project,parentVersionId:first.id,payload:{requirements:[changed,otherRequirement]}});await configuration.publish(independent,next.id);
  const proposal=await configuration.proposeChange(owner,project,{versionIds:[next.id],baselineSnapshotId:baseline.snapshotId,reason:'Explicit reviewed obligation change'});expect(proposal.impact_json.changedRequirements).toHaveLength(1);
  await checklists.decideChangeRequest(independent,proposal.id,{decision:'APPROVED'});await checklists.applyChangeRequest(owner,project,proposal.id);
  expect((await handover.evaluateProjectReadiness(owner,project)).readyWithoutOverride).toBe(false);
  expect((await admin.query('SELECT status FROM waivers WHERE requirement_id=$1',[req])).rows[0].status).toBe('SUPERSEDED');
  expect((await admin.query('SELECT status FROM reviews WHERE id=$1',[pending.reviewId])).rows[0].status).toBe('CANCELLED');
  await expect(reviews.decideReview(technical,pending.reviewId,{decision:'APPROVE',expectedRowVersion:staleVersion})).rejects.toThrow('INVALID_STATE_TRANSITION');
  expect((await admin.query('SELECT baseline_obsoleted_at,requested_by FROM handover_packages WHERE id=$1',[packageId])).rows[0]).toMatchObject({baseline_obsoleted_at:expect.any(Date),requested_by:author});
  expect((await admin.query('SELECT baseline_obsoleted_at,created_by FROM submissions WHERE id=$1',[submission])).rows[0]).toMatchObject({baseline_obsoleted_at:expect.any(Date),created_by:author});
  await expect(scoped(app,org,async client=>{await client.query("SELECT set_config('app.current_user',$1,true)",[qc]);return client.query(`INSERT INTO requirement_evidence_qualifications(id,org_id,project_id,requirement_id,document_version_id,review_id,snapshot_id,obligation_fingerprint,reviewer_role,created_by)
    SELECT $1,r.org_id,r.project_id,r.id,$2,$3,r.current_snapshot_id,requirement_obligation_fingerprint(r),r.reviewer_role,$4 FROM requirements r WHERE r.id=$5`,[randomUUID(),version,firstReview.reviewId,qc,req]);})).rejects.toMatchObject({code:'42501'});
  await expect(scoped(app,org,c=>c.query('UPDATE reviews SET recorded_at=now() WHERE id=$1',[firstReview.reviewId]))).rejects.toThrow('REVIEW_DECISION_FACTS_IMMUTABLE');
  const current=await reviews.submitReview(uploader,req,{documentVersionId:version,reviewerUserId:qc});await reviews.decideReview(technical,current.reviewId,{decision:'APPROVE',expectedRowVersion:await rowVersion()});
  expect((await handover.evaluateProjectReadiness(owner,project)).readyWithoutOverride).toBe(true);
  expect((await admin.query('SELECT object_id FROM document_versions WHERE id=$1',[version])).rows[0].object_id).toBe(object);
  expect((await admin.query('SELECT sha256,provider_version_id FROM storage_objects WHERE id=$1',[object])).rows[0]).toEqual({sha256:sha,provider_version_id:'synthetic-object-version'});
  expect((await admin.query('SELECT count(*)::int AS n FROM requirement_evidence_qualifications WHERE requirement_id=$1',[req])).rows[0].n).toBe(2);
 });
});
