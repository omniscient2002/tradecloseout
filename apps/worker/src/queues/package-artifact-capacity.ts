import type {Pool,PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import {lockStorageCapacity,reconcileStorageCapacity,resolveEffectiveEntitlements} from '@tradecloseout/db';

type ArtifactReservation={orgId:string;projectId:string;packageId:string;owner:string;bucket:string;filename:string;sizeBytes:number;sha256:string};

async function bind(client:PoolClient,orgId:string) {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='15s'");
  await client.query("SET LOCAL statement_timeout='90s'");
  await client.query(`SELECT set_config('app.current_org',$1,true),set_config('app.current_org_id',$1,true)`,[orgId]);
}

/** Reserve before PUT. Each attempt gets a new object key because an expired
 * owner may still have a provider request in flight. Retain cleanup tombstones. */
export async function reservePackageArtifact(pool:Pool,input:ArtifactReservation) {
  if(!Number.isSafeInteger(input.sizeBytes)||input.sizeBytes<1||!/^[a-f0-9]{64}$/.test(input.sha256))throw new Error('PACKAGE_ARTIFACT_METADATA_INVALID');
  const client=await pool.connect();let destroy=false;
  try {
    await bind(client,input.orgId);
    const {rows:projects}=await client.query(`SELECT status,purged_at FROM projects
      WHERE org_id=$1 AND id=$2 FOR UPDATE`,[input.orgId,input.projectId]);
    if(!projects[0]||projects[0].purged_at||!['ACTIVE','HANDOVER'].includes(projects[0].status))throw new Error('PACKAGE_PROJECT_NOT_EDITABLE');
    const effective=await resolveEffectiveEntitlements(client,input.orgId,{projectId:input.projectId});
    if(!effective.canConsume)throw new Error('PACKAGE_STORAGE_ENTITLEMENT_UNAVAILABLE');
    const occupied=await lockStorageCapacity(client,input.orgId);
    const {rows:packages}=await client.query(`SELECT build_object_id,requested_by FROM handover_packages
      WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='GENERATING' AND error_code=$4 FOR UPDATE`,
      [input.orgId,input.projectId,input.packageId,input.owner]);
    if(!packages[0])throw new Error('PACKAGE_BUILD_LEASE_LOST');
    if(packages[0].build_object_id) {
      const {rows:prior}=await client.query(`SELECT id,status,expected_sha256,size_bytes,bucket,object_key,original_filename FROM storage_objects
        WHERE org_id=$1 AND id=$2 FOR UPDATE`,[input.orgId,packages[0].build_object_id]);
      if(prior[0]?.status==='READY')throw new Error('PACKAGE_ARTIFACT_ALREADY_PUBLISHED');
      await client.query(`UPDATE storage_objects SET status='ABORTED',upload_cleanup_requested_at=COALESCE(upload_cleanup_requested_at,now()),
        upload_failure_code='UNPUBLISHED_PACKAGE_ARTIFACT_REPLACED',updated_at=now()
        WHERE org_id=$1 AND id=$2 AND status IN ('PENDING','FAILED','ABORTED')`,[input.orgId,packages[0].build_object_id]);
    }
    const usage=await reconcileStorageCapacity(client,input.orgId);
    if(usage.totalBytes+BigInt(input.sizeBytes)>BigInt(effective.limits.maxStorageBytes))throw new Error('STORAGE_QUOTA_EXCEEDED');
    const id=uuidv7(),objectKey=`organisations/${input.orgId}/projects/${input.projectId}/handover/${input.packageId}/${id}.pdf`;
    await client.query(`INSERT INTO storage_objects(id,org_id,provider,bucket,object_key,original_filename,mime,size_bytes,expected_sha256,status,created_by)
      VALUES($1,$2,'S3',$3,$4,$5,'application/pdf',$6,$7,'PENDING',$8)`,
      [id,input.orgId,input.bucket,objectKey,input.filename,input.sizeBytes,input.sha256,packages[0].requested_by]);
    await client.query(`UPDATE handover_packages SET build_object_id=$4
      WHERE org_id=$1 AND project_id=$2 AND id=$3`,[input.orgId,input.projectId,input.packageId,id]);
    await client.query('COMMIT');
    return {id,objectKey,reused:false};
  } catch(error) {try{await client.query('ROLLBACK');}catch{destroy=true;}throw error;}
  finally{client.release(destroy);}
}
