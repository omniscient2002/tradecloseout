import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import { withDisposableDatabase } from '../../../packages/db/test/helpers/disposable-database';
import { attachSyntheticEntitlementPolicy } from '../../../packages/db/test/helpers/synthetic-entitlement-policy';
import { IdentityController } from '../src/modules/identity/identity.controller';
import { InMemoryRedis } from '../src/modules/identity/identity.module';
import { DocumentsService } from '../src/modules/documents/documents.service';
import { TenantDbService } from '../src/database/tenant-db.service';
import {HandoverService} from '../src/modules/handover/handover.service';
import {quotaMonthIndia} from '@tradecloseout/shared';
import {TradeCloseoutScheduler} from '../../worker/src/scheduler';

jest.setTimeout(180_000);

async function syntheticOffer(admin:any,orgId:string,limits:Record<string,number>) {
  const id=uuidv7();
  await admin.query(`INSERT INTO plans(id,code,name,limits_json,price_paise,interval,status)
    VALUES($1,$2,'Synthetic quota mechanics offer',$3,0,'MONTH','ACTIVE')`,[id,'SYNTHETIC-'+id,JSON.stringify(limits)]);
  await attachSyntheticEntitlementPolicy(admin,id);
  await admin.query(`INSERT INTO subscriptions(id,org_id,plan_id,status,current_period_start,current_period_end)
    VALUES($1,$2,$3,'ACTIVE',now()-interval '1 day',now()+interval '1 day')
    ON CONFLICT(org_id) DO UPDATE SET plan_id=EXCLUDED.plan_id`,[uuidv7(),orgId,id]);
}

async function tenant(admin:any) {
  const orgId=uuidv7(),userId=uuidv7(),projectId=uuidv7();
  await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic quota owner','ACTIVE')",[userId]);
  await admin.query(`INSERT INTO organisations(id,legal_name,display_name,state)
    VALUES($1,'Synthetic quota HVAC','Synthetic quota HVAC','KA')`,[orgId]);
  await admin.query(`INSERT INTO memberships(id,org_id,user_id,role,status)
    VALUES($1,$2,$3,'R-OWNER','ACTIVE')`,[uuidv7(),orgId,userId]);
  await admin.query(`INSERT INTO projects(id,org_id,code,name,status,created_by)
    VALUES($1,$2,'QUOTA-RECOVERY','Synthetic quota project','ACTIVE',$3)`,[projectId,orgId,userId]);
  return {orgId,userId,projectId};
}

// Test-only identity delivery/storage adapters exercise transactional mechanics.
// They do not certify a real provider, scanner or business policy approval.
describe('Phase 2 real quota boundary and recovery transactions',()=>{
  it('races production OTP invitation acceptance for the last seat and retains proof/invitation for recovery',async()=>{
    const keys=['NODE_ENV','FRONTEND_URL','AUTH_OTP_HMAC_KEY','AUTH_CSRF_KEY','ENABLE_DEBUG_OTP'] as const;
    const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
    Object.assign(process.env,{NODE_ENV:'production',FRONTEND_URL:'https://quota.example.test',
      AUTH_OTP_HMAC_KEY:'synthetic-otp-key-'.repeat(4),AUTH_CSRF_KEY:'synthetic-csrf-key-'.repeat(4),ENABLE_DEBUG_OTP:'false'});
    try {await withDisposableDatabase(async({admin,app})=>{
      const t=await tenant(admin);
      const limits={maxSeats:2,maxActiveProjects:1,maxStorageBytes:0,maxPackageGenerationsPerMonth:0};
      await syntheticOffer(admin,t.orgId,limits);
      const mail={sendOtpEmail:jest.fn().mockResolvedValue(undefined)};
      const controller=new IdentityController(app,new InMemoryRedis() as any,{sendOtpSms:jest.fn()} as any,mail as any);
      const prepared:Array<{req:any;res:any;invitationId:string;challengeId:string;code:string;token:string}>=[];
      for(let i=0;i<2;i++) {
        const email=`seat-${i}@quota.example.test`,token=String(i+1).repeat(64),invitationId=uuidv7();
        await admin.query(`INSERT INTO invitations(id,org_id,email,role,token_hash,status,expires_at,invited_by)
          VALUES($1,$2,$3,'R-SITE',$4,'PENDING',now()+interval '1 day',$5)`,
          [invitationId,t.orgId,email,createHash('sha256').update(token).digest('hex'),t.userId]);
        const req:any={ip:'127.0.0.1',headers:{origin:'https://quota.example.test','sec-fetch-site':'same-origin','user-agent':'synthetic-seat-race'},cookies:{}};
        const res:any={cookie:jest.fn(),clearCookie:jest.fn()};
        const challenge=await controller.requestOtp({identifier:email},req,res);
        expect(challenge.debugOtp).toBeUndefined();
        req.cookies.tc_auth_intent=res.cookie.mock.calls.find((c:any[])=>c[0]==='tc_auth_intent')[1];
        const code=mail.sendOtpEmail.mock.calls[i][1] as string;
        prepared.push({req,res,invitationId,challengeId:challenge.challengeId,code,token});
      }
      const accept=(x:typeof prepared[number])=>controller.verifyOtp({challengeId:x.challengeId,code:x.code,invitationToken:x.token},x.req,x.res);
      const outcomes=await Promise.allSettled(prepared.map(accept));
      expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
      const failed=outcomes.findIndex(x=>x.status==='rejected');
      const rejection=outcomes[failed] as PromiseRejectedResult;
      expect(rejection.reason.getStatus()).toBe(409);
      expect(rejection.reason.getResponse()).toMatchObject({code:'SEAT_LIMIT_EXCEEDED'});
      const retry=prepared[failed];
      expect((await admin.query('SELECT consumed_at FROM otp_challenges WHERE id=$1',[retry.challengeId])).rows[0].consumed_at).toBeNull();
      expect((await admin.query('SELECT status FROM invitations WHERE id=$1',[retry.invitationId])).rows[0].status).toBe('PENDING');
      expect((await admin.query("SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND status='ACTIVE'",[t.orgId])).rows[0].n).toBe(2);
      // Recover by an explicit new synthetic policy-backed offer, never by
      // mutating the historical offer or bypassing the identity proof.
      await syntheticOffer(admin,t.orgId,{...limits,maxSeats:3});
      const accepted=await accept(retry);
      expect(accepted.activeOrgId).toBe(t.orgId);
      expect((await admin.query('SELECT consumed_at FROM otp_challenges WHERE id=$1',[retry.challengeId])).rows[0].consumed_at).toBeTruthy();
      await expect(accept(retry)).rejects.toThrow();
      expect((await admin.query("SELECT count(*)::int AS n FROM memberships WHERE org_id=$1 AND status='ACTIVE'",[t.orgId])).rows[0].n).toBe(3);
    });} finally {for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
  });

  it('repairs stale storage counters, protects restore races and preserves pending reservations on deletion',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const t=await tenant(admin);
      const limits={maxSeats:1,maxActiveProjects:1,maxStorageBytes:1000,maxPackageGenerationsPerMonth:0};
      await syntheticOffer(admin,t.orgId,limits);
      const storage:any={createUploadUrls:async()=>({uploadId:null,partSizeBytes:4096,parts:[]}),abortUpload:jest.fn().mockResolvedValue(undefined)};
      const service=new DocumentsService(new TenantDbService(app),storage);
      const ctx={...t,actorType:'USER' as const,orgRole:'R-OWNER',requestId:uuidv7()};
      const upload=(sizeBytes:number)=>service.createUploadIntent(ctx,t.projectId,{filename:'synthetic-quota.pdf',mimeType:'application/pdf',sizeBytes});
      const first=await upload(600);
      // Purely synthetic READY state for accounting mechanics; no evidence or
      // provider verification is fabricated or submitted for release approval.
      await admin.query(`UPDATE storage_objects SET status='READY',sha256=repeat('0',64)
        WHERE id=(SELECT object_id FROM document_versions WHERE id=$1)`,[first.versionId]);
      await admin.query("UPDATE document_versions SET file_status='READY' WHERE id=$1",[first.versionId]);
      await admin.query("UPDATE usage_counters SET value=0 WHERE org_id=$1 AND metric='STORAGE_BYTES'",[t.orgId]);
      await expect(upload(500)).rejects.toMatchObject({response:{code:'STORAGE_QUOTA_EXCEEDED'}});
      expect((await service.deleteDocument(ctx,first.documentId)).refundedBytes).toBe(600);
      const next=await upload(600);
      await expect(service.restoreDocument(ctx,first.documentId)).rejects.toMatchObject({response:{code:'STORAGE_QUOTA_EXCEEDED'}});
      expect((await admin.query('SELECT deleted_at FROM documents WHERE id=$1',[first.documentId])).rows[0].deleted_at).toBeTruthy();
      await service.abortUpload(ctx,next.versionId);
      const race=await Promise.allSettled([service.restoreDocument(ctx,first.documentId),upload(600)]);
      expect(race.filter(x=>x.status==='fulfilled')).toHaveLength(1);
      expect(race.filter(x=>x.status==='rejected')).toHaveLength(1);
      // Deletion cannot free a still-PENDING external upload reservation.
      if(race[0].status==='fulfilled')await service.deleteDocument(ctx,first.documentId);
      const pending=race[1].status==='fulfilled'?race[1].value:await upload(600);
      await service.deleteDocument(ctx,pending.documentId);
      await expect(upload(500)).rejects.toMatchObject({response:{code:'STORAGE_QUOTA_EXCEEDED'}});
      // A closed baseline may be read but cannot be mutated by quota recovery.
      await admin.query("UPDATE projects SET status='CLOSED' WHERE id=$1",[t.projectId]);
      await expect(service.restoreDocument(ctx,first.documentId)).rejects.toMatchObject({response:{code:'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN'}});
    });
  });
  it('expires stale uploads without deleting version history or claiming physical cleanup',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const t=await tenant(admin);
      await syntheticOffer(admin,t.orgId,{maxSeats:1,maxActiveProjects:1,maxStorageBytes:1000,maxPackageGenerationsPerMonth:0});
      const service=new DocumentsService(new TenantDbService(app),{createUploadUrls:async()=>({uploadId:null,partSizeBytes:4096,parts:[]})} as any);
      const ctx={...t,actorType:'USER' as const,orgRole:'R-OWNER',requestId:uuidv7()};
      const first=await service.createUploadIntent(ctx,t.projectId,{filename:'expiry.pdf',mimeType:'application/pdf',sizeBytes:600});
      await admin.query("UPDATE document_versions SET created_at=now()-interval '25 hours' WHERE id=$1",[first.versionId]);
      await admin.query(`UPDATE storage_objects SET created_at=now()-interval '25 hours'
        WHERE id=(SELECT object_id FROM document_versions WHERE id=$1)`,[first.versionId]);
      const scheduler=new TradeCloseoutScheduler(app,{} as any);
      expect(await scheduler.runStorageLifecycleCleanup()).toEqual({expiredVersions:1,expiredObjects:1});
      expect(await scheduler.runStorageLifecycleCleanup()).toEqual({expiredVersions:0,expiredObjects:0});
      const record=(await admin.query(`SELECT dv.file_status,d.latest_version_id,so.status,so.upload_failure_code,
        so.upload_cleanup_requested_at,so.upload_cleanup_completed_at
        FROM document_versions dv JOIN documents d ON d.id=dv.document_id JOIN storage_objects so ON so.id=dv.object_id
        WHERE dv.id=$1`,[first.versionId])).rows[0];
      expect(record).toMatchObject({file_status:'FAILED',latest_version_id:first.versionId,status:'ABORTED',
        upload_failure_code:'UPLOAD_INTENT_EXPIRED',upload_cleanup_completed_at:null});
      expect(record.upload_cleanup_requested_at).toBeTruthy();
      await expect(service.completeUpload(ctx,first.versionId)).rejects.toThrow('UPLOAD_CANNOT_COMPLETE_FROM_FAILED');
      expect((await service.createUploadIntent(ctx,t.projectId,{filename:'after-expiry.pdf',mimeType:'application/pdf',sizeBytes:600})).versionId).toBeDefined();
    });
  });

  it('gates RA evidence packs by the same subscription, month and terminal project policy',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const t=await tenant(admin);
      const service=new HandoverService(app,{} as any);
      const ctx={...t,actorType:'MEMBER' as const,orgRole:'R-OWNER',ip:'127.0.0.1',userAgent:'synthetic',requestId:uuidv7()};
      const generate=()=>service.compileRaBillEvidencePack(ctx,t.projectId,{milestoneKey:'DELIVERY',billNumber:'SYNTHETIC-RA'});
      await expect(generate()).rejects.toMatchObject({response:{code:'PACKAGE_ENTITLEMENT_UNAVAILABLE'}});
      await syntheticOffer(admin,t.orgId,{maxSeats:1,maxActiveProjects:1,maxStorageBytes:0,maxPackageGenerationsPerMonth:0});
      await expect(generate()).rejects.toMatchObject({code:'PLAN_LIMIT_EXCEEDED'});
      expect((await admin.query("SELECT count(*)::int AS n FROM handover_packages WHERE org_id=$1",[t.orgId])).rows[0].n).toBe(0);
      await syntheticOffer(admin,t.orgId,{maxSeats:1,maxActiveProjects:1,maxStorageBytes:0,maxPackageGenerationsPerMonth:1});
      // A failed business operation must roll back its reservation.
      await expect(generate()).rejects.toThrow();
      expect((await admin.query("SELECT count(*)::int AS n FROM usage_counters WHERE org_id=$1 AND metric='PACKAGE_GENERATIONS'",[t.orgId])).rows[0].n).toBe(0);
      await admin.query(`INSERT INTO usage_counters(id,org_id,metric,period,value)
        VALUES($1,$2,'PACKAGE_GENERATIONS',$3,1)`,[uuidv7(),t.orgId,quotaMonthIndia()]);
      await expect(generate()).rejects.toMatchObject({code:'PLAN_LIMIT_EXCEEDED'});
      await admin.query("UPDATE projects SET status='CLOSED' WHERE id=$1",[t.projectId]);
      await expect(generate()).rejects.toMatchObject({response:{code:'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN'}});
    });
  });

  it('serializes two authenticated guest upload writers without shared-to-exclusive project lock upgrades',async()=>{
    await withDisposableDatabase(async({admin,app})=>{
      const t=await tenant(admin),requirement=uuidv7(),party=uuidv7(),snapshot=uuidv7();
      await syntheticOffer(admin,t.orgId,{maxSeats:1,maxActiveProjects:1,maxStorageBytes:1000,maxPackageGenerationsPerMonth:0});
      await admin.query(`INSERT INTO checklist_snapshots(id,org_id,project_id,version_no,status,resolved_payload_json,provenance_json,source_json,checksum,created_by)
        VALUES($1,$2,$3,1,'ACTIVE','{}','{}','[]','synthetic-not-domain-evidence',$4)`,[snapshot,t.orgId,t.projectId,t.userId]);
      await admin.query(`INSERT INTO requirements(id,org_id,project_id,requirement_key,group_key,title,doc_type_key,mandatory,scope_key,current_snapshot_id)
        VALUES($1,$2,$3,'SYNTHETIC-QUOTA','SYNTHETIC','Synthetic quota scope','DT-018',false,'project',$4)`,[requirement,t.orgId,t.projectId,snapshot]);
      await admin.query(`INSERT INTO parties(id,org_id,name,types,status)
        VALUES($1,$2,'Synthetic supplier',ARRAY['SUPPLIER']::text[],'ACTIVE')`,[party,t.orgId]);
      const contexts:any[]=[];
      for(let n=0;n<2;n++) {
        const user=uuidv7(),grant=uuidv7(),session=uuidv7(),generation=uuidv7(),hash=createHash('sha256').update(session).digest('hex');
        await admin.query("INSERT INTO users(id,name,status) VALUES($1,'Synthetic guest principal','ACTIVE')",[user]);
        await admin.query(`INSERT INTO guest_grants(id,org_id,project_id,party_id,grant_type,role,capabilities,scope_json,
          token_hash,target_email,status,expires_at,created_by,principal_user_id)
          VALUES($1,$2,$3,$4,'SUPPLIER_UPLOAD','R-SUPPLIER',ARRAY['document.upload']::text[],$5,$6,$7,'ACTIVE',now()+interval '1 day',$8,$9)`,
          [grant,t.orgId,t.projectId,party,JSON.stringify({requirementIds:[requirement]}),hash,`guest-${n}@quota.example.test`,t.userId,user]);
        await admin.query(`INSERT INTO sessions(id,user_id,active_org_id,guest_grant_id,auth_generation,token_hash,csrf_token_hash,expires_at,absolute_expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$6,now()+interval '1 day',now()+interval '1 day')`,[session,user,t.orgId,grant,generation,hash]);
        contexts.push({orgId:t.orgId,userId:user,projectId:t.projectId,actorType:'GUEST',orgRole:'GUEST',sessionId:session,
          authGeneration:generation,guestGrantId:grant,guestScope:{requirementIds:[requirement]},requestId:uuidv7()});
      }
      const service=new DocumentsService(new TenantDbService(app),{createUploadUrls:async()=>({uploadId:null,partSizeBytes:4096,parts:[]})} as any);
      const outcomes=await Promise.allSettled(contexts.map(ctx=>service.createUploadIntent(ctx,t.projectId,
        {filename:'guest-quota.pdf',mimeType:'application/pdf',sizeBytes:400,requirementId:requirement})));
      expect(outcomes.map(x=>x.status)).toEqual(['fulfilled','fulfilled']);
      expect((await admin.query("SELECT sum(size_bytes)::text AS n FROM storage_objects WHERE org_id=$1 AND status='PENDING'",[t.orgId])).rows[0].n).toBe('800');
    });
  });

});
