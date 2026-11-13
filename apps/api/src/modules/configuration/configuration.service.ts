import {ConflictException,ForbiddenException,Injectable,NotFoundException,UnprocessableEntityException} from '@nestjs/common';
import {Pool,PoolClient} from 'pg';
import {createHash} from 'crypto';
import {uuidv7} from 'uuidv7';
import {TenantActorContext,withTenantTransaction} from '@tradecloseout/db';
import {assertValidMemberProjectScope} from '@tradecloseout/db/tenant-tx';
import {hasPermission} from '@tradecloseout/shared';
import {ChecklistsService} from '../checklists/checklists.service';
import {boundedJsonObject} from '../../common/validation/bounded-json';
import {projectCommandRecord,requireProjectCommandId} from '../projects/project-command-input';
import {ConfigLayerInput,resolveConfigurationHierarchy} from './config-resolver';
function canonical(v:any):any {return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
export function configPayloadChecksum(v:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
@Injectable()
export class ConfigurationService {
 constructor(private readonly pool:Pool,private readonly checklists:ChecklistsService){}
 private async authority(client:PoolClient,ctx:TenantActorContext,projectId?:string,review=false){
  if(ctx.guestGrantId||!['MEMBER','USER','ADMIN'].includes(ctx.actorType))throw new ForbiddenException('CONFIGURATION_AUTHORITY_REQUIRED');
  const {rows}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
   WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u`,[ctx.orgId,ctx.userId]);
  const role=rows[0]?.role;
  if(!role||review&&!['R-OWNER','R-ADMIN'].includes(role)||!hasPermission({orgRole:role},'template.manage').allowed)
   throw new ForbiddenException('CONFIGURATION_AUTHORITY_REQUIRED');
  if(!['R-OWNER','R-ADMIN'].includes(role)){
   if(!projectId)throw new ForbiddenException('ORGANISATION_CONFIGURATION_AUTHORITY_REQUIRED');
   const {rows:pm}=await client.query(`SELECT scope_json FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,ctx.userId]);
   if(!pm.length)throw new ForbiddenException('PROJECT_MEMBERSHIP_REQUIRED');
   try{assertValidMemberProjectScope(pm[0].scope_json);}catch{throw new ForbiddenException('CONFIGURATION_SCOPE_INVALID');}
   if(Object.keys(pm[0].scope_json??{}).length)throw new ForbiddenException('PROJECT_WIDE_CONFIGURATION_SCOPE_REQUIRED');
  }
 }
 async listVersions(ctx:TenantActorContext){return withTenantTransaction(this.pool,ctx,async client=>{
  await this.authority(client,ctx);
  return(await client.query(`SELECT id,level,scope_type,scope_id,version_no,schema_version,status,checksum,
   source_pack_id,parent_version_id,created_by,published_by,published_at FROM config_versions WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`,[ctx.orgId])).rows;
 });}
 async createVersion(ctx:TenantActorContext,value:unknown){
  const dto=projectCommandRecord(value,['level','scopeId','payload','parentVersionId','sourcePackId'],'INVALID_CONFIGURATION_INPUT');
  if(!['ORG','CLIENT_CONTRACT','PROJECT'].includes(String(dto.level)))throw new UnprocessableEntityException('CONFIGURATION_LEVEL_INVALID');
  requireProjectCommandId(dto.scopeId,'CONFIGURATION_SCOPE_INVALID');
  if(dto.parentVersionId!==undefined)requireProjectCommandId(dto.parentVersionId,'CONFIGURATION_PARENT_INVALID');
  // Governed pack copies must be installed through the reviewed-pack operation.
  if(dto.sourcePackId!==undefined)throw new UnprocessableEntityException('USE_REVIEWED_TEMPLATE_INSTALLATION');
  let payload:Record<string,unknown>;try{payload=boundedJsonObject(dto.payload,1048576);}catch{throw new UnprocessableEntityException('CONFIGURATION_PAYLOAD_INVALID');}
  const id=uuidv7(),level=dto.level as ConfigLayerInput['level'];
  const checked=resolveConfigurationHierarchy([{level,versionId:id,schemaVersion:'v1.0',payload}]);
  if(checked.conflicts.length)throw new UnprocessableEntityException({code:'CONFIGURATION_CONFLICT',conflicts:checked.conflicts});
  return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
   const projectId=level==='PROJECT'?dto.scopeId as string:undefined;
   await this.authority(client,ctx,projectId);
   if(level==='ORG'&&dto.scopeId!==ctx.orgId)throw new NotFoundException('CONFIGURATION_SCOPE_NOT_FOUND');
   if(level==='PROJECT'){
    const {rows}=await client.query(`SELECT status FROM projects WHERE org_id=$1 AND id=$2 AND purged_at IS NULL FOR UPDATE`,[ctx.orgId,dto.scopeId]);
    if(!rows.length||!['DRAFT','ACTIVE','HANDOVER'].includes(rows[0].status))throw new ConflictException('PROJECT_CONFIGURATION_LOCKED');
   }
   if(level==='CLIENT_CONTRACT'&&!(await client.query('SELECT id FROM contracts WHERE org_id=$1 AND id=$2 AND status=\'ACTIVE\' FOR SHARE',[ctx.orgId,dto.scopeId])).rows.length)
    throw new NotFoundException('CONFIGURATION_SCOPE_NOT_FOUND');
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('configuration:'||$1::text,0))",[ctx.orgId]);
   if(dto.parentVersionId){const {rows}=await client.query(`SELECT id FROM config_versions WHERE org_id=$1 AND id=$2 AND level=$3 AND scope_id=$4`,[ctx.orgId,dto.parentVersionId,level,dto.scopeId]);if(!rows.length)throw new NotFoundException('CONFIGURATION_PARENT_NOT_FOUND');}
   const {rows:[next]}=await client.query(`SELECT COALESCE(MAX(version_no),0)+1 AS n FROM config_versions WHERE org_id=$1 AND level=$2 AND scope_id=$3`,[ctx.orgId,level,dto.scopeId]);
   const {rows}=await client.query(`INSERT INTO config_versions(id,org_id,level,scope_type,scope_id,version_no,schema_version,payload_json,checksum,status,created_by,parent_version_id)
    VALUES($1,$2,$3,$3,$4,$5,1,$6,$7,'DRAFT',$8,$9) RETURNING id,version_no,status,checksum`,[id,ctx.orgId,level,dto.scopeId,next.n,JSON.stringify(payload),configPayloadChecksum(payload),ctx.userId,dto.parentVersionId??null]);
   emit({eventType:'CONFIGURATION_VERSION_CREATED',entityType:'CONFIGURATION_VERSION',entityId:id,afterJson:{level,scopeId:dto.scopeId,version:next.n}});return rows[0];
  });
 }
 async installPack(ctx:TenantActorContext,value:unknown){
  const dto=projectCommandRecord(value,['packId','parentVersionId'],'INVALID_TEMPLATE_INSTALLATION');
  requireProjectCommandId(dto.packId,'INVALID_TEMPLATE_ID');
  if(dto.parentVersionId!==undefined)requireProjectCommandId(dto.parentVersionId,'CONFIGURATION_PARENT_INVALID');
  return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
   await this.authority(client,ctx,undefined,true);
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('configuration:'||$1::text,0))",[ctx.orgId]);
   const {rows:packs}=await client.query('SELECT * FROM lock_reviewed_hvac_pack_for_organisation($1)',[dto.packId]);
   const pack=packs[0];if(!pack)throw new ConflictException('REVIEWED_TEMPLATE_REQUIRED');
   if(dto.parentVersionId){
    const {rows}=await client.query("SELECT source_pack_id FROM config_versions WHERE org_id=$1 AND id=$2 AND level='ORG' AND scope_id=$1 FOR SHARE",[ctx.orgId,dto.parentVersionId]);
    if(!rows.length||!rows[0].source_pack_id)throw new ConflictException('INSTALLED_TEMPLATE_PARENT_REQUIRED');
    const {rows:parents}=await client.query('SELECT code,version FROM template_packs WHERE id=$1',[rows[0].source_pack_id]);
    if(parents[0]?.code!==pack.code||parents[0].version>=pack.version)throw new ConflictException('TEMPLATE_UPGRADE_LINEAGE_INVALID');
   }
   const id=uuidv7();const checked=resolveConfigurationHierarchy([{level:'ORG',versionId:id,schemaVersion:'v1.0',payload:pack.payload_json}]);
   if(checked.conflicts.length)throw new ConflictException({code:'TEMPLATE_CONFIGURATION_CONFLICT',conflicts:checked.conflicts});
   const {rows:[next]}=await client.query("SELECT COALESCE(MAX(version_no),0)+1 AS n FROM config_versions WHERE org_id=$1 AND level='ORG' AND scope_id=$1",[ctx.orgId]);
   const {rows}=await client.query(`INSERT INTO config_versions(id,org_id,level,scope_type,scope_id,version_no,schema_version,payload_json,checksum,status,source_pack_id,created_by,parent_version_id)
    VALUES($1,$2,'ORG','ORG',$2,$3,1,$4,$5,'DRAFT',$6,$7,$8) RETURNING id,version_no,status,checksum,source_pack_id,parent_version_id`,
    [id,ctx.orgId,next.n,JSON.stringify(pack.payload_json),configPayloadChecksum(pack.payload_json),pack.id,ctx.userId,dto.parentVersionId??null]);
   emit({eventType:'CONFIGURATION_VERSION_CREATED',entityType:'CONFIGURATION_VERSION',entityId:id,afterJson:{sourcePackId:pack.id,parentVersionId:dto.parentVersionId??null}});return rows[0];
  });
 }
 async publish(ctx:TenantActorContext,id:string,archive=false){
  requireProjectCommandId(id,'CONFIGURATION_VERSION_INVALID');return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
   await this.authority(client,ctx,undefined,true);
   const {rows}=await client.query('SELECT * FROM config_versions WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,id]);const v=rows[0];
   if(!v)throw new NotFoundException('CONFIGURATION_VERSION_NOT_FOUND');
   if(!archive&&v.created_by===ctx.userId)throw new ForbiddenException('CONFIGURATION_SELF_PUBLICATION_FORBIDDEN');
   if(v.status!==(archive?'ACTIVE':'DRAFT'))throw new ConflictException('CONFIGURATION_VERSION_STATE_INVALID');
   if(configPayloadChecksum(v.payload_json)!==v.checksum)throw new ConflictException('CONFIGURATION_CHECKSUM_INVALID');
   const {rows:updated}=await client.query(`UPDATE config_versions SET status=$3,published_by=CASE WHEN $4 THEN published_by ELSE $5::uuid END,
    published_at=CASE WHEN $4 THEN published_at ELSE now() END WHERE org_id=$1 AND id=$2 RETURNING id,status,checksum`,[ctx.orgId,id,archive?'ARCHIVED':'ACTIVE',archive,ctx.userId]);
   emit({eventType:archive?'CONFIGURATION_VERSION_ARCHIVED':'CONFIGURATION_VERSION_PUBLISHED',entityType:'CONFIGURATION_VERSION',entityId:id,afterJson:{status:updated[0].status,checksum:v.checksum}});return updated[0];
  });
 }
 private async loadLayers(client:PoolClient,ctx:TenantActorContext,projectId:string,versionIds:unknown):Promise<ConfigLayerInput[]>{
  if(!Array.isArray(versionIds)||!versionIds.length||versionIds.length>4||new Set(versionIds).size!==versionIds.length)throw new UnprocessableEntityException('CONFIGURATION_VERSION_SELECTION_INVALID');
  for(const id of versionIds)requireProjectCommandId(id,'CONFIGURATION_VERSION_INVALID');
  const {rows:projectRows}=await client.query('SELECT id FROM projects WHERE org_id=$1 AND id=$2 AND purged_at IS NULL FOR UPDATE',[ctx.orgId,projectId]);
  if(!projectRows.length)throw new NotFoundException('PROJECT_NOT_FOUND');
  const {rows}=await client.query(`SELECT * FROM config_versions WHERE id=ANY($2::uuid[]) AND (org_id=$1 OR org_id IS NULL AND level='PLATFORM') ORDER BY id FOR SHARE`,[ctx.orgId,versionIds]);
  if(rows.length!==versionIds.length)throw new NotFoundException('CONFIGURATION_VERSION_NOT_FOUND');
  const levels=new Set<string>();const layers:ConfigLayerInput[]=[];
  for(const v of rows){
   if(v.status!=='ACTIVE'||v.schema_version!==1||!v.published_at||levels.has(v.level)||configPayloadChecksum(v.payload_json)!==v.checksum)throw new ConflictException('CONFIGURATION_VERSION_NOT_PUBLISHED');
   if(v.level==='ORG'&&v.scope_id!==ctx.orgId||v.level==='PROJECT'&&v.scope_id!==projectId||!['PLATFORM','ORG','CLIENT_CONTRACT','PROJECT'].includes(v.level))throw new NotFoundException('CONFIGURATION_SCOPE_NOT_FOUND');
   if(v.level==='CLIENT_CONTRACT'&&!(await client.query(`SELECT id FROM contracts WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,v.scope_id])).rows.length)throw new NotFoundException('CONFIGURATION_SCOPE_NOT_FOUND');
   levels.add(v.level);layers.push({level:v.level,versionId:v.id,schemaVersion:'v1.0',payload:v.payload_json});
  }return layers;
 }
 async preview(ctx:TenantActorContext,projectId:string,versionIds:unknown){
  requireProjectCommandId(projectId,'INVALID_PROJECT_ID');return withTenantTransaction(this.pool,ctx,async client=>{
   await this.authority(client,ctx,projectId);const layers=await this.loadLayers(client,ctx,projectId,versionIds);
   const resolved=resolveConfigurationHierarchy(layers);const {rows}=await client.query(`SELECT id,checksum,resolved_payload_json FROM checklist_snapshots WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE' ORDER BY version_no DESC LIMIT 1`,[ctx.orgId,projectId]);
   return {...resolved,sources:layers.map(l=>({level:l.level,versionId:l.versionId})),baselineSnapshotId:rows[0]?.id??null,
    baselineChecksum:rows[0]?.checksum??null,proposedChecksum:resolved.checksum,unchanged:rows[0]?.checksum===resolved.checksum};
  });
 }
 async proposeChange(ctx:TenantActorContext,projectId:string,value:unknown){
  const dto=projectCommandRecord(value,['versionIds','baselineSnapshotId','reason'],'INVALID_CONFIGURATION_CHANGE');
  requireProjectCommandId(projectId,'INVALID_PROJECT_ID');requireProjectCommandId(dto.baselineSnapshotId,'INVALID_BASELINE_ID');
  if(typeof dto.reason!=='string'||dto.reason.trim().length<5||dto.reason.length>500)throw new UnprocessableEntityException('CHANGE_REASON_REQUIRED');
  return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
   await this.authority(client,ctx,projectId);const layers=await this.loadLayers(client,ctx,projectId,dto.versionIds);
   return this.checklists.proposeSnapshotChangeInTransaction(ctx,projectId,dto.baselineSnapshotId as string,layers,dto.reason as string,client,emit);
  });
 }
 async apply(ctx:TenantActorContext,projectId:string,value:unknown){
  const dto=projectCommandRecord(value,['versionIds','changeRequestId','reason'],'INVALID_CONFIGURATION_APPLY');
  if(dto.changeRequestId!==undefined)requireProjectCommandId(dto.changeRequestId,'INVALID_CHANGE_REQUEST_ID');
  if(typeof dto.reason!=='string'||dto.reason.trim().length<5||dto.reason.length>500)throw new UnprocessableEntityException('CONFIGURATION_REASON_REQUIRED');
  requireProjectCommandId(projectId,'INVALID_PROJECT_ID');
  return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
   await this.authority(client,ctx,projectId);const layers=await this.loadLayers(client,ctx,projectId,dto.versionIds);
   return this.checklists.createAndApplySnapshot(ctx,projectId,layers,dto.changeRequestId as string|undefined,(dto.reason as string).trim(),{client,emit});
  });
 }
}
