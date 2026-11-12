import {ConflictException,ForbiddenException,NotFoundException,UnprocessableEntityException} from '@nestjs/common';
import {PoolClient} from 'pg';
import {uuidv7} from 'uuidv7';
import {TenantActorContext,assertValidMemberProjectScope} from '@tradecloseout/db';
import {ConfigLayerRecord,ConfigLevel,resolveConfigV021} from './config-resolver';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const GLOBAL='00000000-0000-0000-0000-000000000000';
export type ConfigurationSourceReference={versionId:string;level:ConfigLevel};
export type StoredConfigurationLayer=ConfigLayerRecord&{checksum:string;sourceManifest:Record<string,unknown>;status:string};

export function validateConfigurationDefinition(level:ConfigLevel,payload:Record<string,unknown>) {
  const result=resolveConfigV021({[level]:{level,versionId:'unpublished-validation',schemaVersion:'v1.0',payload}});
  if(result.conflicts.length)throw new UnprocessableEntityException({code:'CONFIGURATION_INVALID',fieldErrors:result.conflicts});
  return result;
}

/** All authoring occurs in the caller's tenant transaction, under its project
 * lock. Version counters serialize only this source scope, never another tenant. */
export async function storeScopedConfiguration(client:PoolClient,ctx:TenantActorContext,projectId:string,input:{
  level:'ORG'|'CLIENT_CONTRACT'|'PROJECT';scopeId?:string;payload:Record<string,unknown>;
  sourcePackId?:string;sourceManifest:Record<string,unknown>;
}) {
  if(!['MEMBER','USER'].includes(ctx.actorType)||ctx.guestGrantId)throw new ForbiddenException({code:'CONFIGURATION_AUTHOR_REQUIRED'});
  if(!input||!['ORG','CLIENT_CONTRACT','PROJECT'].includes(input.level)||
    (input.sourcePackId!==undefined&&(typeof input.sourcePackId!=='string'||!UUID.test(input.sourcePackId)))||
    (input.scopeId!==undefined&&(typeof input.scopeId!=='string'||!UUID.test(input.scopeId))))throw new UnprocessableEntityException({code:'CONFIGURATION_INPUT_INVALID'});
  validateConfigurationDefinition(input.level,input.payload);
  const canonicalPayload={...input.payload};
  if(Object.hasOwn(canonicalPayload,'checklist.requirements')) {
    canonicalPayload.requirements=canonicalPayload['checklist.requirements'];delete canonicalPayload['checklist.requirements'];
  }
  if(Array.isArray(canonicalPayload.requirements))canonicalPayload.requirements=canonicalPayload.requirements.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))return item;
    const {provenanceLevel,...definition}=item as Record<string,unknown>;return definition;
  });
  // Match live HTTP authority lock order for callers reusing this primitive.
  const {rows:users}=await client.query('SELECT status FROM users WHERE id=$1 FOR SHARE',[ctx.userId]);
  const {rows:orgs}=await client.query('SELECT status FROM organisations WHERE id=$1 FOR SHARE',[ctx.orgId]);
  const {rows:members}=await client.query(`SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,ctx.userId]);
  if(users[0]?.status!=='ACTIVE'||orgs[0]?.status!=='ACTIVE'||!members[0])throw new ForbiddenException({code:'CONFIGURATION_AUTHOR_REQUIRED'});
  const {rows:projects}=await client.query(`SELECT id,status,purged_at FROM projects WHERE org_id=$1 AND id=$2 FOR UPDATE`,[ctx.orgId,projectId]);
  if(!projects[0])throw new NotFoundException('PROJECT_NOT_FOUND');
  if(projects[0].purged_at||!['DRAFT','ACTIVE','HANDOVER'].includes(projects[0].status))throw new ConflictException({code:'PROJECT_CONFIGURATION_NOT_EDITABLE'});
  const orgManager=['R-OWNER','R-ADMIN'].includes(members[0].role);
  if(!orgManager) {
    const {rows:managers}=await client.query(`SELECT role,scope_json FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,ctx.userId]);
    const scope=managers[0]?.scope_json??{};
    try{assertValidMemberProjectScope(scope);}catch{throw new ForbiddenException({code:'CONFIGURATION_PROJECT_SCOPE_REQUIRED'});}
    if((members[0].role!=='R-PM'&&!['R-PM','R-OWNER','R-ADMIN'].includes(managers[0]?.role))||!managers[0]||scope.readOnly===true||scope.mode==='READ_ONLY'||
      Object.keys(scope).some(k=>!['readOnly','mode'].includes(k)))throw new ForbiddenException({code:'CONFIGURATION_PROJECT_SCOPE_REQUIRED'});
  }
  const scopeId=input.level==='ORG'?ctx.orgId:input.level==='PROJECT'?projectId:input.scopeId?.toLowerCase();
  const scopeType=input.level==='ORG'?'ORGANISATION':input.level==='PROJECT'?'PROJECT':'CONTRACT';
  if(!scopeId||typeof scopeId!=='string'||!UUID.test(scopeId)||(input.scopeId!==undefined&&(typeof input.scopeId!=='string'||input.scopeId.toLowerCase()!==scopeId.toLowerCase())))throw new UnprocessableEntityException({code:'CONFIGURATION_SCOPE_REQUIRED'});
  if(input.level==='ORG'&&!input.sourcePackId&&!orgManager)throw new ForbiddenException({code:'ORGANISATION_CONFIGURATION_AUTHORITY_REQUIRED'});
  if(input.level==='CLIENT_CONTRACT') {
    const result=await client.query(`SELECT id FROM contracts WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,scopeId]);
    if(!result.rows.length)throw new NotFoundException('CONFIGURATION_CONTRACT_NOT_FOUND');
  }
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`configuration:${ctx.orgId}:${input.level}:${scopeId}`]);
  const payload=JSON.stringify(canonicalPayload);
  const {rows:existing}=await client.query(`SELECT id,version_no,checksum,payload_json,source_manifest_json,status FROM config_versions
    WHERE org_id=$1 AND level=$2 AND scope_id=$3 AND format_version=1 AND status<>'ARCHIVED'
      AND source_pack_id IS NOT DISTINCT FROM $4::uuid AND checksum=phase2_config_digest($5::jsonb)
    ORDER BY version_no DESC LIMIT 1 FOR SHARE`,[ctx.orgId,input.level,scopeId,input.sourcePackId??null,payload]);
  if(existing[0])return existing[0];
  const {rows:versions}=await client.query(`SELECT COALESCE(max(version_no),0)::int AS last FROM config_versions WHERE level=$1 AND scope_type=$2 AND scope_id=$3`,[input.level,scopeType,scopeId]);
  const {rows}=await client.query(`INSERT INTO config_versions(id,org_id,level,scope_type,scope_id,version_no,schema_version,
    payload_json,checksum,source_pack_id,status,created_by,format_version,source_manifest_json)
    VALUES($1,$2,$3,$4,$5,$6,1,$7,'computed-on-insert',$8,'DRAFT',$9,1,$10)
    RETURNING id,version_no,checksum,payload_json,source_manifest_json,status`,
    [uuidv7(),ctx.orgId,input.level,scopeType,scopeId,Number(versions[0].last)+1,payload,input.sourcePackId??null,ctx.userId,JSON.stringify(input.sourceManifest)]);
  return rows[0];
}

/** Resolve only exact persisted, checksum-verified identities for this scope.
 * Read reconstruction can retain archived definitions; new application cannot. */
export async function loadConfigurationSources(client:PoolClient,ctx:TenantActorContext,projectId:string,refs:ConfigurationSourceReference[],reconstruct=false,application=false):Promise<StoredConfigurationLayer[]> {
  if(application&&reconstruct)throw new UnprocessableEntityException({code:'CONFIGURATION_MODE_INVALID'});
  if(!Array.isArray(refs)||refs.length<1||refs.length>4||refs.some(r=>!r||typeof r!=='object'||typeof r.versionId!=='string'||!UUID.test(r.versionId)||!['PLATFORM','ORG','CLIENT_CONTRACT','PROJECT'].includes(r.level))||
    new Set(refs.map(r=>r.level)).size!==refs.length||new Set(refs.map(r=>r.versionId.toLowerCase())).size!==refs.length) {
    throw new UnprocessableEntityException({code:'CONFIGURATION_SOURCE_IDENTITIES_REQUIRED'});
  }
  refs=refs.map(r=>({...r,versionId:r.versionId.toLowerCase()}));
  projectId=projectId.toLowerCase();
  const project=await client.query('SELECT id FROM projects WHERE org_id=$1 AND id=$2 AND purged_at IS NULL',[ctx.orgId,projectId]);
  if(!project.rows.length)throw new NotFoundException('PROJECT_NOT_FOUND');
  const {rows}=await client.query(`SELECT *,phase2_config_digest(payload_json) AS actual_checksum
    FROM lock_project_configuration_sources($1,$2::uuid[],$3)`,[projectId,refs.map(r=>r.versionId),application]);
  if(rows.length!==refs.length)throw new NotFoundException('CONFIGURATION_SOURCE_NOT_FOUND');
  const result:StoredConfigurationLayer[]=[];
  for(const ref of refs) {
    const row=rows.find(r=>r.id===ref.versionId);
    let pinned=false;
    if(!reconstruct&&(row.status==='ARCHIVED'||row.source_pack_id)) {
      const proof=await client.query(`SELECT id FROM checklist_snapshots WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE'
        AND source_json @> $3::jsonb LIMIT 1`,[ctx.orgId,projectId,JSON.stringify([{level:row.level,versionId:row.id,definitionChecksum:row.checksum}])]);
      pinned=!!proof.rows.length;
    }
    if(row.level!==ref.level||row.format_version!==1||row.schema_version!==1||row.checksum!==row.actual_checksum||(!reconstruct&&!pinned&&row.status==='ARCHIVED')) {
      throw new ConflictException({code:'CONFIGURATION_SOURCE_UNVERIFIED_OR_STALE'});
    }
    let scopeValid=false;
    if(row.level==='PLATFORM')scopeValid=row.org_id===null&&row.scope_type==='GLOBAL'&&row.scope_id===GLOBAL&&(row.status==='ACTIVE'||((reconstruct||pinned)&&row.status==='ARCHIVED'&&row.published_at));
    else if(row.org_id===ctx.orgId&&row.level==='ORG')scopeValid=row.scope_type==='ORGANISATION'&&row.scope_id===ctx.orgId;
    else if(row.org_id===ctx.orgId&&row.level==='PROJECT')scopeValid=row.scope_type==='PROJECT'&&row.scope_id===projectId;
    else if(row.org_id===ctx.orgId&&row.level==='CLIENT_CONTRACT'&&row.scope_type==='CONTRACT') {
      const contract=await client.query(`SELECT id FROM contracts WHERE org_id=$1 AND project_id=$2 AND id=$3
        AND ($4::boolean OR status='ACTIVE') FOR SHARE`,[ctx.orgId,projectId,row.scope_id,reconstruct]);
      scopeValid=!!contract.rows.length;
    }
    if(!scopeValid)throw new NotFoundException('CONFIGURATION_SOURCE_NOT_FOUND');
    if(row.source_pack_id&&!reconstruct) {
      const {rows:packs}=await client.query('SELECT id,payload_checksum FROM lock_reviewed_hvac_template_pack($1,$2)',[row.source_pack_id,projectId]);
      if(!packs[0]||packs[0].payload_checksum!==row.checksum) {
        const retired=pinned?await client.query(`SELECT id FROM template_packs WHERE id=$1 AND status='DEPRECATED'
          AND governance_version=1 AND reviewed_at IS NOT NULL AND reviewer_identity<>author_identity
          AND review_record_json IS NOT NULL AND payload_checksum=$2`,[row.source_pack_id,row.checksum]):{rows:[]};
        if(!retired.rows.length)throw new ConflictException({code:'CONFIGURATION_INSTALLED_PACK_UNAVAILABLE'});
      }
    }
    result.push({level:row.level,versionId:row.id,schemaVersion:'v1.0',payload:row.payload_json,checksum:row.checksum,sourceManifest:row.source_manifest_json,status:row.status});
  }
  return result;
}
