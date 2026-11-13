import {configPayloadChecksum} from '../configuration/configuration-identity';
// apps/api/src/modules/checklists/checklists.service.ts
// Checklists, Snapshots, Two-Approver Waivers & Controlled Changes Service (API-050..066, WF-06, WF-20, FR-CHK-004..016, AUD-002, AUD-008)

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';
import {
  withTenantTransaction,
  TenantActorContext,
  DomainOutboxEvent,
} from '@tradecloseout/db';
import { assertMemberResourceScope } from '@tradecloseout/db/tenant-tx';
import {
  resolveConfigurationHierarchy,
  ConfigLayerInput,
} from '../configuration/config-resolver';
import { boundedJsonObject } from '../../common/validation/bounded-json';
import { projectCommandRecord,requireProjectCommandId } from '../projects/project-command-input';
import { hasPermission,RequirementStatus, WaiverStatus } from '@tradecloseout/shared';

export interface ResolvedRequirementSpec {
  key: string;
  groupKey: string;
  title: string;
  description?: string;
  docTypeKey: string;
  mandatory: boolean;
  scopeType: 'PROJECT' | 'ASSET_CATEGORY' | 'ASSET';
  assetCategoryKey?: string;
  assetId?: string;
  reviewerRole?: string;
  dueOffsetDays?: number;
  dueDate?:string;
  validityRule?: Record<string, unknown>;
}

function obligationDefinition(spec:Record<string,any>,reviewerRole:string):Record<string,unknown>{
  const clean=(value:any):any=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).filter(([key])=>key!=='provenanceLevel').map(([key,value])=>[key,clean(value)])):value;
  return clean({...spec,reviewerRole,validityRule:spec.validityRule??{}});
}
function validDueDate(value:unknown):value is string{
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
}
/**
 * PH2-G06-001/006: the configuration resolver sees each requested layer,
 * not the previously accepted project snapshot. A new single-layer import
 * must not erase or weaken a locked obligation carried by that snapshot.
 * Compare immutable obligation semantics (not volatile provenance metadata)
 * before the active snapshot is superseded.
 */
export function assertLockedChecklistBaselineInvariant(previous: unknown, proposed: unknown, reviewedMandatoryChange=false): void {
  if (previous == null) return;
  let oldPayload: Record<string, unknown>;
  try {
    const decoded = typeof previous === 'string' ? JSON.parse(previous) : previous;
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('invalid snapshot object');
    }
    oldPayload = decoded as Record<string, unknown>;
  } catch {
    throw new ConflictException({ code: 'ACTIVE_CHECKLIST_SNAPSHOT_INVALID' });
  }
  const priorItems = oldPayload.requirements ?? oldPayload['checklist.requirements'];
  if (priorItems === undefined) return;
  if (!Array.isArray(priorItems)) {
    throw new ConflictException({ code: 'ACTIVE_CHECKLIST_SNAPSHOT_INVALID' });
  }
  const nextItems = (proposed as Record<string, unknown> | null)?.requirements;
  if (!Array.isArray(nextItems)) {
    throw new ConflictException({ code: 'CHECKLIST_REQUIREMENTS_MISSING' });
  }
  const nextByKey = new Map(
    nextItems.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item) &&
        typeof item.key === 'string')).map(item => [item.key, item]),
  );
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'provenanceLevel')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, next]) => [key, canonical(next)]));
    }
    return value;
  };
  for (const item of priorItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ConflictException({ code: 'ACTIVE_CHECKLIST_SNAPSHOT_INVALID' });
    }
    if (item.locked !== true && (item.mandatory !== true||reviewedMandatoryChange)) continue;
    if (typeof item.key !== 'string' || !item.key.trim() ||
        !nextByKey.has(item.key) ||
        JSON.stringify(canonical(item)) !== JSON.stringify(canonical(nextByKey.get(item.key)))) {
      throw new ConflictException({
        code: 'LOCKED_CHECKLIST_CHANGE_REQUIRES_REVIEW',
        detail: 'Locked contractual obligations cannot be removed or redefined by a checklist import.',
      });
    }
  }
}

@Injectable()
export class ChecklistsService {
  constructor(private readonly pool: Pool) {}

  private async persistProjectInput(client:PoolClient,ctx:TenantActorContext,projectId:string,payload:Record<string,unknown>,kind:'CONSULTANT_IMPORT'|'MANUAL_REQUIREMENT'|'CHANGE_PROPOSAL',reason:string):Promise<ConfigLayerInput>{
    const id=uuidv7();await client.query(`INSERT INTO project_configuration_inputs(id,org_id,project_id,source_kind,payload_json,checksum,created_by,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,ctx.orgId,projectId,kind,JSON.stringify(payload),configPayloadChecksum(payload),ctx.userId,reason]);
    return {level:'PROJECT',versionId:id,schemaVersion:'v1.0',payload};
  }
  private async assertPersistedLayers(client:PoolClient,ctx:TenantActorContext,projectId:string,layers:ConfigLayerInput[]){
    const manifest:Array<{level:string;versionId:string;schemaVersion:number;checksum:string;sourceKind:string}>=[];
    for(const layer of layers){
      requireProjectCommandId(layer.versionId,'CONFIGURATION_SOURCE_ID_INVALID');
      const {rows:versions}=await client.query(`SELECT * FROM config_versions WHERE id=$2 AND (org_id=$1 OR org_id IS NULL AND level='PLATFORM') FOR SHARE`,[ctx.orgId,layer.versionId]);
      if(versions[0]){
        const version=versions[0];
        if(version.level!==layer.level||version.status!=='ACTIVE'||version.schema_version!==1||!version.published_at||
          configPayloadChecksum(version.payload_json)!==version.checksum||configPayloadChecksum(layer.payload)!==version.checksum)
          throw new ConflictException('CONFIGURATION_SOURCE_STALE_OR_MISMATCHED');
        if(version.level==='ORG'&&version.scope_id!==ctx.orgId||version.level==='PROJECT'&&version.scope_id!==projectId||!['PLATFORM','ORG','CLIENT_CONTRACT','PROJECT'].includes(version.level))
          throw new ConflictException('CONFIGURATION_SOURCE_SCOPE_MISMATCH');
        if(version.level==='CLIENT_CONTRACT'&&!(await client.query("SELECT id FROM contracts WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE",[ctx.orgId,projectId,version.scope_id])).rows.length)
          throw new ConflictException('CONFIGURATION_SOURCE_SCOPE_MISMATCH');
        manifest.push({level:layer.level,versionId:layer.versionId,schemaVersion:1,checksum:version.checksum,sourceKind:'CONFIGURATION_VERSION'});continue;
      }
      if(layer.level!=='PROJECT')throw new ConflictException('PERSISTED_CONFIGURATION_SOURCE_REQUIRED');
      // These inputs are append-only; acquiring UPDATE privilege merely to read-lock them is unnecessary.
      const {rows:inputs}=await client.query('SELECT * FROM project_configuration_inputs WHERE org_id=$1 AND project_id=$2 AND id=$3',[ctx.orgId,projectId,layer.versionId]);
      if(inputs[0]){
        const input=inputs[0];if(input.schema_version!==1||configPayloadChecksum(input.payload_json)!==input.checksum||configPayloadChecksum(layer.payload)!==input.checksum)
          throw new ConflictException('CONFIGURATION_SOURCE_STALE_OR_MISMATCHED');
        manifest.push({level:layer.level,versionId:layer.versionId,schemaVersion:1,checksum:input.checksum,sourceKind:input.source_kind});continue;
      }
      const {rows:packs}=await client.query('SELECT * FROM lock_reviewed_hvac_template_pack($1,$2)',[layer.versionId,projectId]);
      if(!packs.length||configPayloadChecksum(packs[0].payload_json)!==configPayloadChecksum(layer.payload))throw new ConflictException('PERSISTED_CONFIGURATION_SOURCE_REQUIRED');
      manifest.push({level:layer.level,versionId:layer.versionId,schemaVersion:1,checksum:configPayloadChecksum(layer.payload),sourceKind:'REVIEWED_HVAC_PACK'});
    }
    return manifest;
  }
  private assertLegacyRequirementOnlyPayload(payload:Record<string,unknown>|undefined){
    if(payload&&Object.keys(payload).some(key=>!['requirements','checklist.requirements'].includes(key)))
      throw new ConflictException('USE_PERSISTED_CONFIGURATION_CHANGE_WORKFLOW');
  }

  private async assertBaselineAuthority(client:PoolClient,ctx:TenantActorContext,projectId:string){
    if(ctx.guestGrantId||!['MEMBER','USER','ADMIN'].includes(ctx.actorType))throw new ForbiddenException('BASELINE_AUTHORITY_REQUIRED');
    const {rows}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
      WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u`,[ctx.orgId,ctx.userId]);
    const role=rows[0]?.role;if(!role)throw new ForbiddenException('BASELINE_AUTHORITY_REQUIRED');
    let projectRole:string|undefined;
    if(!['R-OWNER','R-ADMIN'].includes(role)){
      const {rows:members}=await client.query(`SELECT role,scope_json FROM project_members WHERE org_id=$1 AND project_id=$2 AND user_id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,ctx.userId]);
      if(!members.length||Object.keys(members[0].scope_json??{}).length)throw new ForbiddenException('PROJECT_WIDE_BASELINE_AUTHORITY_REQUIRED');
      projectRole=members[0].role;
    }
    if(!hasPermission({orgRole:role,projectRole},'checklist.manage').allowed)throw new ForbiddenException('BASELINE_AUTHORITY_REQUIRED');
  }

  private async lockEditableProject(client: PoolClient, orgId: string, projectId: string): Promise<void> {
    // Every baseline writer shares closure's project lock. Check the lifecycle
    // after acquiring it so a waiting import cannot change a just-closed scope.
    const { rows } = await client.query(
      `SELECT id, status, purged_at FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
      [orgId, projectId],
    );
    const project = rows[0];
    if (!project) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (project.purged_at != null) {
      throw new ConflictException({ code: 'PROJECT_PURGED', detail: 'Purged projects cannot change their contractual checklist.' });
    }
    if (project.status === 'CLOSED') {
      throw new ConflictException({
        code: 'CLOSED_PROJECT_REQUIRES_FORMAL_REOPEN',
        detail: 'Formally reopen the project before changing its accepted contractual checklist.',
      });
    }
    if (!['DRAFT', 'ACTIVE', 'HANDOVER'].includes(project.status)) {
      throw new ConflictException({
        code: 'PROJECT_CHECKLIST_NOT_EDITABLE',
        detail: 'The project lifecycle does not permit contractual checklist changes.',
      });
    }
  }

  /**
   * API-056: POST /api/v1/projects/:id/checklist/snapshots
   * Resolves L0..L4 configuration, creates an immutable checklist_snapshots row,
   * and instantiates project-level and per-asset requirement rows (WF-06, AUD-002, AUD-008).
   */
  async createAndApplySnapshot(
    ctx: TenantActorContext,
    projectId: string,
    layers: ConfigLayerInput[],
    changeRequestId?: string,
    changeReason = 'Initial project checklist snapshot',
    transaction?: { client: PoolClient; emit: (ev: DomainOutboxEvent) => void },
  ) {
    const resolved = resolveConfigurationHierarchy(layers);
    if (resolved.conflicts.length > 0) {
      throw new UnprocessableEntityException({
        code: 'RULE_CONFLICT',
        title: 'Configuration conflict detected',
        detail: resolved.conflicts[0]!.message,
        fieldErrors: resolved.conflicts.map((c) => ({ field: c.path, message: c.message })),
      });
    }

    const reqSpecs = (resolved.payload.requirements ?? []) as ResolvedRequirementSpec[];
    if (!Array.isArray(reqSpecs) || reqSpecs.length === 0) {
      throw new UnprocessableEntityException({
        code: 'CHECKLIST_REQUIREMENTS_MISSING',
        detail: 'A checklist needs explicit contract or trade requirements. An empty snapshot cannot be applied.',
      });
    }
    const seenKeys = new Set<string>();
    for (const spec of reqSpecs) {
      if (typeof spec.key!=='string'||!spec.key.trim()||typeof spec.title!=='string'||!spec.title.trim()||typeof spec.docTypeKey!=='string'||!spec.docTypeKey.trim()||typeof spec.groupKey!=='string'||!spec.groupKey.trim()||typeof spec.mandatory!=='boolean'||
          !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(spec.scopeType) ||
          (spec.scopeType === 'ASSET_CATEGORY' && !spec.assetCategoryKey) ||
          (spec.scopeType === 'ASSET' && !spec.assetId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_CHECKLIST_REQUIREMENT',
          detail: 'Requirements need a key, title, document type, and an explicit valid scope.',
        });
      }
      if(spec.dueDate!==undefined&&!validDueDate(spec.dueDate)||spec.dueOffsetDays!==undefined&&(!Number.isSafeInteger(spec.dueOffsetDays)||Math.abs(spec.dueOffsetDays)>36500)||spec.dueDate!==undefined&&spec.dueOffsetDays!==undefined)throw new UnprocessableEntityException('INVALID_REQUIREMENT_DUE_BASIS');
      if (seenKeys.has(spec.key)) {
        throw new UnprocessableEntityException({
          code: 'DUPLICATE_CHECKLIST_KEY',
          detail: `Requirement key '${spec.key}' appears more than once.`,
        });
      }
      seenKeys.add(spec.key);
    }

    const applySnapshot = async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.assertBaselineAuthority(client,ctx,projectId);
      // Serialize competing snapshot writers, including the first snapshot when
      // there is no existing checklist row to lock.
      await this.lockEditableProject(client, ctx.orgId, projectId);
      // Supersede prior ACTIVE snapshot if one exists (06 §3.5)
      const { rows: priorSnaps } = await client.query(
        `SELECT id, version_no, checksum, resolved_payload_json,obligation_context_checksum FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2
          ORDER BY version_no DESC LIMIT 1
          FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if(!changeRequestId)assertLockedChecklistBaselineInvariant(priorSnaps[0]?.resolved_payload_json, resolved.payload);
      const {rows:[lifecycle]}=await client.query('SELECT status FROM projects WHERE org_id=$1 AND id=$2',[ctx.orgId,projectId]);
      const prior=priorSnaps[0];
      const sourceManifest=await this.assertPersistedLayers(client,ctx,projectId,layers);
      const {rows:[context]}=await client.query('SELECT project_obligation_context_checksum($1,$2) AS checksum',[ctx.orgId,projectId]);
      const contextChanged=!!prior&&prior.obligation_context_checksum!==context.checksum;
      if(prior?.checksum===resolved.checksum&&!contextChanged)return {snapshotId:prior.id,versionNo:prior.version_no,checksum:prior.checksum,
        instantiatedRequirements:0,unchanged:true};
      if(lifecycle.status!=='DRAFT'||changeRequestId){
        if(!changeRequestId)throw new ConflictException({code:'APPROVED_BASELINE_CHANGE_REQUIRED',baselineSnapshotId:prior?.id??null});
        const {rows:requests}=await client.query(`SELECT * FROM requirement_change_requests WHERE org_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE`,[ctx.orgId,projectId,changeRequestId]);
        const approval=requests[0];
        if(!approval||approval.status!=='APPROVED'||!approval.approved_by||approval.approved_by===approval.requested_by||
          approval.baseline_snapshot_id!==prior?.id||approval.proposed_checksum!==resolved.checksum||approval.proposed_context_checksum!==context.checksum||approval.applied_snapshot_id)
          throw new ConflictException({code:'BASELINE_APPROVAL_STALE_OR_MISMATCHED'});
      }

      assertLockedChecklistBaselineInvariant(prior?.resolved_payload_json,resolved.payload,!!changeRequestId);
      const previousSpecs=new Map<string,any>((prior?.resolved_payload_json?.requirements??[]).map((spec:any)=>[spec.key,spec]));
      const nextVersionNo = (priorSnaps[0]?.version_no ?? 0) + 1;
      if (priorSnaps.length > 0) {
        await client.query(
          `UPDATE checklist_snapshots
              SET status = 'SUPERSEDED'
            WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'`,
          [ctx.orgId, projectId],
        );
      }

      const snapshotId = uuidv7();
      await client.query(
        `INSERT INTO checklist_snapshots
          (id, org_id, project_id, version_no, status, resolved_payload_json,
           provenance_json, source_json, checksum, created_by)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8, $9)`,
        [
          snapshotId,
          ctx.orgId,
          projectId,
          nextVersionNo,
          JSON.stringify(resolved.payload),
          JSON.stringify(resolved.provenance),
          JSON.stringify(sourceManifest),
          resolved.checksum,
          ctx.userId,
        ],
      );

      // Load active assets in this project for asset-category expansion (AUD-002)
      const { rows: projectAssets } = await client.query(
        `SELECT id, tag, category_key FROM assets
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' AND deleted_at IS NULL`,
        [ctx.orgId, projectId],
      );

      // Requirements in an explicitly approved contract/consultant checklist
      // are already applicable. In particular, optional consultant records
      // must not vanish merely because they are not in the platform's generic
      // conditional catalogue. Conditional rules belong in template resolution,
      // before the resulting project checklist is approved and snapshotted.
      const filteredSpecs = reqSpecs;

      // Expand requirement definitions into concrete (requirement_key, scope_key) tuples
      const targetInstances: Array<{
        spec: ResolvedRequirementSpec;
        scopeKey: string;
      }> = [];

      for (const spec of filteredSpecs) {
        if (spec.scopeType === 'ASSET' && spec.assetId) {
          const asset = projectAssets.find((a: any) => a.id === spec.assetId);
          if (!asset) {
            throw new UnprocessableEntityException({
              code: 'CHECKLIST_ASSET_NOT_FOUND',
              detail: `Requirement '${spec.key}' targets an asset not active in this project.`,
            });
          }
          targetInstances.push({ spec, scopeKey: `asset:${asset.id}` });
        } else if (spec.scopeType === 'ASSET_CATEGORY' && spec.assetCategoryKey) {
          const matchingAssets = projectAssets.filter(
            (a: any) => a.category_key === spec.assetCategoryKey,
          );
          if (matchingAssets.length === 0 && spec.mandatory) {
            throw new UnprocessableEntityException({
              code: 'MANDATORY_ASSET_CATEGORY_MISSING',
              detail: `Mandatory checklist requirement '${spec.key}' targets an equipment category absent from the project asset register.`,
            });
          }
          for (const asset of matchingAssets) {
            targetInstances.push({ spec, scopeKey: `asset:${asset.id}` });
          }
        } else {
          targetInstances.push({ spec, scopeKey: 'project' });
        }
      }

      if (targetInstances.length === 0) {
        throw new UnprocessableEntityException({
          code: 'NO_APPLICABLE_CHECKLIST_REQUIREMENTS',
          detail: 'No requirements apply to the active project assets. Review the asset register and checklist mapping before creating a snapshot.',
        });
      }

      // Reconcile against persistent requirements table + write requirement_revisions (07 §6.3, 08 §5.4)
      for (const inst of targetInstances) {
        const { rows: existingRows } = await client.query(
          `SELECT id,title,description,group_key,doc_type_key,mandatory,reviewer_role,due_at,validity_rule_json,obligation_definition_json
             FROM requirements
            WHERE org_id = $1 AND project_id = $2
              AND requirement_key = $3 AND scope_key = $4
              AND superseded_at IS NULL
            LIMIT 1`,
          [ctx.orgId, projectId, inst.spec.key, inst.scopeKey],
        );

        // The canonical DB column is NOT NULL. A consultant import does not
        // choose review authority; preserve an existing trusted policy, otherwise
        // use the same server-defined R-QC policy as the SQL column default.
        const reviewerRole = inst.spec.reviewerRole ?? existingRows[0]?.reviewer_role ?? 'R-QC';
        if (!['R-QC', 'R-PM', 'R-OWNER', 'R-ADMIN', 'R-REVIEWER', 'R-CONSULTANT'].includes(reviewerRole)) {
          throw new UnprocessableEntityException({
            code: 'INVALID_REVIEWER_ROLE',
            detail: 'Checklist reviewer role must be an authorized review role.',
          });
        }

        const dueAtSql = inst.spec.dueDate?inst.spec.dueDate+'T18:29:59.999Z':
          typeof inst.spec.dueOffsetDays === 'number'
            ? new Date(Date.now() + inst.spec.dueOffsetDays * 86_400_000).toISOString()
            : null;

        if (existingRows.length === 0) {
          const reqId = uuidv7();
          const assetId = inst.scopeKey.startsWith('asset:') ? inst.scopeKey.slice(6) : null;
          await client.query(
            `INSERT INTO requirements
              (id, org_id, project_id, current_snapshot_id, requirement_key, scope_key,
               asset_id, group_key, title, description, doc_type_key, mandatory, reviewer_role, due_at, status,validity_rule_json,obligation_definition_json,qualification_required_since)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'NOT_STARTED',$15,$16,now())`,
            [
              reqId,
              ctx.orgId,
              projectId,
              snapshotId,
              inst.spec.key,
              inst.scopeKey,
              assetId,
              inst.spec.groupKey,
              inst.spec.title,
              inst.spec.description ?? null,
              inst.spec.docTypeKey,
              inst.spec.mandatory,
              reviewerRole,
              dueAtSql,
              JSON.stringify(inst.spec.validityRule??{}),
              JSON.stringify(obligationDefinition(inst.spec,reviewerRole)),
            ],
          );

          await client.query(
            `INSERT INTO requirement_revisions
              (id, org_id, project_id, requirement_id, snapshot_id, change_request_id,
               field_diff_json, reason, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              reqId,
              snapshotId,
              changeRequestId ?? null,
              JSON.stringify({ action: 'CREATED', spec: inst.spec }),
              changeReason,
              ctx.userId,
            ],
          );
        } else {
          const ex = existingRows[0];
          const priorSpec=previousSpecs.get(inst.spec.key);
          const definition=obligationDefinition(inst.spec,reviewerRole);
          const previousDefinition=ex.obligation_definition_json??(priorSpec?obligationDefinition(priorSpec,ex.reviewer_role):null);
          const semanticChange = contextChanged||previousDefinition===null||configPayloadChecksum(previousDefinition)!==configPayloadChecksum(definition)||
            ex.title !== inst.spec.title ||
            ex.doc_type_key !== inst.spec.docTypeKey ||
            ex.mandatory !== inst.spec.mandatory ||
            ex.reviewer_role !== reviewerRole;
          if(semanticChange){
            await client.query(`UPDATE reviews SET status='CANCELLED',row_version=row_version+1 WHERE org_id=$1 AND project_id=$2
              AND status IN('PENDING','IN_REVIEW') AND (requirement_id IS NULL OR requirement_id=$3) AND document_version_id IN(SELECT dv.id FROM document_versions dv JOIN document_requirements dr
                ON dr.org_id=dv.org_id AND dr.project_id=dv.project_id AND dr.document_id=dv.document_id WHERE dr.org_id=$1 AND dr.project_id=$2 AND dr.requirement_id=$3)`,[ctx.orgId,projectId,ex.id]);
            await client.query(`UPDATE document_versions SET row_version=row_version+1 WHERE org_id=$1 AND project_id=$2 AND document_id IN(
              SELECT document_id FROM document_requirements WHERE org_id=$1 AND project_id=$2 AND requirement_id=$3)`,[ctx.orgId,projectId,ex.id]);
          }
          // An exception is valid for the obligation that was approved, not
          // for a materially different document, scope, or approval policy.
          // Keep the historical waiver record but remove its ACTIVE effect.
          if (semanticChange) {
            await client.query(
              `UPDATE waivers SET status = 'SUPERSEDED'
                 WHERE org_id = $1 AND project_id = $2 AND requirement_id = $3
                   AND status IN ('ACTIVE', 'PENDING_SECOND_APPROVAL')`,
              [ctx.orgId, projectId, ex.id],
            );
          }
          const dueChanged=priorSpec?.dueDate!==inst.spec.dueDate||priorSpec?.dueOffsetDays!==inst.spec.dueOffsetDays;
          await client.query(
            `UPDATE requirements
                SET current_snapshot_id = $4,
                    title = $5,
                    doc_type_key = $6,
                    mandatory = $7,
                    reviewer_role = $8,
                    status = CASE WHEN $9::boolean THEN 'NOT_STARTED' ELSE status END,
                    group_key=$10,description=$11,validity_rule_json=$12,obligation_definition_json=$13,due_at=$14,
                    qualification_required_since=CASE WHEN $9::boolean THEN now() ELSE qualification_required_since END,
                    row_version = row_version + 1,
                    updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [
              ctx.orgId,
              projectId,
              ex.id,
              snapshotId,
              inst.spec.title,
              inst.spec.docTypeKey,
              inst.spec.mandatory,
              reviewerRole,
              semanticChange,inst.spec.groupKey,inst.spec.description??null,JSON.stringify(inst.spec.validityRule??{}),JSON.stringify(definition),dueChanged?dueAtSql:ex.due_at,
            ],
          );

          await client.query(
            `INSERT INTO requirement_revisions
              (id, org_id, project_id, requirement_id, snapshot_id, change_request_id,
               field_diff_json, reason, changed_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              uuidv7(),
              ctx.orgId,
              projectId,
              ex.id,
              snapshotId,
              changeRequestId ?? null,
              JSON.stringify({
                before: { title: ex.title, docTypeKey: ex.doc_type_key, mandatory: ex.mandatory, reviewerRole: ex.reviewer_role },
                after: { title: inst.spec.title, docTypeKey: inst.spec.docTypeKey, mandatory: inst.spec.mandatory, reviewerRole },
                semanticChange,
                waiversSuperseded: semanticChange,
              }),
              changeReason,
              ctx.userId,
            ],
          );
        }
      }

      // A new snapshot supersedes obligations removed from its scope. Leaving
      // these active would make readiness evaluate requirements that no longer
      // belong to the contract, or allow old evidence to satisfy a new version.
      // jsonb_to_recordset keeps the (requirement_key, scope_key) comparison
      // exact and parameterized, including asset-expanded requirements.
      const activeKeys = targetInstances.map((inst) => ({
        requirement_key: inst.spec.key,
        scope_key: inst.scopeKey,
      }));
      await client.query(
        `UPDATE requirements r
            SET superseded_at = now(), row_version = row_version + 1, updated_at = now()
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_to_recordset($3::jsonb)
                AS active(requirement_key text, scope_key text)
               WHERE active.requirement_key = r.requirement_key
                 AND active.scope_key = r.scope_key
            )`,
        [ctx.orgId, projectId, JSON.stringify(activeKeys)],
      );

      await client.query(`UPDATE waivers w SET status='SUPERSEDED' FROM requirements r WHERE w.org_id=$1 AND w.project_id=$2
        AND r.org_id=w.org_id AND r.project_id=w.project_id AND r.id=w.requirement_id AND r.superseded_at IS NOT NULL
        AND w.status IN('ACTIVE','PENDING_SECOND_APPROVAL')`,[ctx.orgId,projectId]);
      await client.query(`WITH cancelled AS (
        UPDATE reviews rv SET status='CANCELLED',row_version=rv.row_version+1
        WHERE rv.org_id=$1 AND rv.project_id=$2 AND rv.status IN('PENDING','IN_REVIEW') AND EXISTS(
          SELECT 1 FROM requirements r JOIN document_requirements dr ON dr.org_id=r.org_id AND dr.project_id=r.project_id AND dr.requirement_id=r.id
          JOIN document_versions dv ON dv.org_id=dr.org_id AND dv.project_id=dr.project_id AND dv.document_id=dr.document_id
          WHERE r.org_id=rv.org_id AND r.project_id=rv.project_id AND r.superseded_at IS NOT NULL
            AND dv.id=rv.document_version_id AND (rv.requirement_id IS NULL OR rv.requirement_id=r.id))
        RETURNING document_version_id)
        UPDATE document_versions SET row_version=row_version+1 WHERE org_id=$1 AND project_id=$2 AND id IN(SELECT document_version_id FROM cancelled)`,[ctx.orgId,projectId]);
      await client.query("UPDATE handover_packages SET baseline_obsoleted_at=now() WHERE org_id=$1 AND project_id=$2 AND snapshot_id<>$3 AND baseline_obsoleted_at IS NULL",[ctx.orgId,projectId,snapshotId]);
      await client.query(`UPDATE submissions s SET baseline_obsoleted_at=now() FROM handover_packages hp WHERE s.org_id=$1 AND s.project_id=$2
        AND hp.org_id=s.org_id AND hp.project_id=s.project_id AND hp.id=s.package_id AND hp.snapshot_id<>$3 AND s.baseline_obsoleted_at IS NULL`,[ctx.orgId,projectId,snapshotId]);
      if(changeRequestId){
        await client.query(`UPDATE requirement_change_requests SET status='APPLIED',applied_snapshot_id=$4,row_version=row_version+1
          WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='APPROVED'`,[ctx.orgId,projectId,changeRequestId,snapshotId]);
      }
      emit({
        eventType: 'CHECKLIST_SNAPSHOT_CREATED',
        projectId,
        entityType: 'CHECKLIST_SNAPSHOT',
        entityId: snapshotId,
        afterJson: {
          versionNo: nextVersionNo,
          checksum: resolved.checksum,
          instantiatedCount: targetInstances.length,
        },
      });

      return {
        snapshotId,
        versionNo: nextVersionNo,
        checksum: resolved.checksum,
        instantiatedRequirements: targetInstances.length,
      };
    };
    // Import/reapply callers provide a transaction which already holds the
    // project lock. Never commit the baseline read before this write.
    return transaction
      ? applySnapshot(transaction.client, transaction.emit)
      : withTenantTransaction(this.pool, ctx, applySnapshot);
  }

  /**
   * Lists only explicitly published HVAC template packs. This does not create
   * a fake default HVAC checklist or infer undocumented client obligations.
   */
  async listApprovedHvacTemplates(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows: owned } = await client.query(
        `SELECT 1 FROM projects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );
      if (!owned.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      const { rows } = await client.query(
        `SELECT id, code, name, version, schema_version,
                CASE WHEN jsonb_typeof(payload_json->'requirements') = 'array'
                     THEN jsonb_array_length(payload_json->'requirements') ELSE 0 END
                AS requirement_count
           FROM template_packs
          WHERE trade = 'HVAC' AND status = 'ACTIVE' AND schema_version=1 AND governance_version=1
            AND reviewed_at IS NOT NULL AND reviewer_identity IS NOT NULL AND author_identity IS NOT NULL
            AND reviewer_identity<>author_identity AND review_record_json IS NOT NULL
            AND reviewed_candidate_sha ~ '^[a-f0-9]{40}$'
            AND payload_checksum=encode(digest(payload_json::text,'sha256'),'hex')
          ORDER BY code, version DESC`,
      );
      return rows;
    });
  }

  /** Applies a specific published HVAC template version under the project lock. */
  async applyApprovedHvacTemplate(
    ctx: TenantActorContext,
    projectId: string,
    templatePackId: string,
  ) {
    if (!/^[a-f0-9-]{36}$/i.test(templatePackId)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_TEMPLATE_ID',
        detail: 'Select a valid published HVAC template pack.',
      });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows } = await client.query(
        `SELECT id,code,name,version,schema_version,payload_json,payload_checksum,
                reviewer_identity,reviewed_at,reviewed_candidate_sha
           FROM lock_reviewed_hvac_template_pack($1,$2)`,
        [templatePackId,projectId],
      );
      if (!rows.length) {
        throw new NotFoundException('APPROVED_HVAC_TEMPLATE_NOT_FOUND');
      }
      const pack = rows[0];
      const payload = typeof pack.payload_json === 'string'
        ? JSON.parse(pack.payload_json) : pack.payload_json;
      if (pack.schema_version !== 1 ||
          !Array.isArray(payload?.requirements) || payload.requirements.length === 0) {
        throw new UnprocessableEntityException({
          code: 'HVAC_TEMPLATE_NOT_CONFIGURED',
          detail: 'The selected published template has no valid scoped contractual requirements.',
        });
      }
      const result = await this.createAndApplySnapshot(
        ctx,
        projectId,
        [{ level: 'PROJECT', versionId: pack.id, payload }],
        undefined,
        `Published HVAC template ${pack.code} v${pack.version}`,
        { client, emit },
      );
      return {
        ...result,
        template: { id: pack.id, code: pack.code, version: pack.version },
      };
    });
  }

  /**
   * Reapply the existing explicit checklist configuration. We intentionally do
   * not substitute a fake one-item handover dossier when no template exists.
   */
  async createSnapshot(ctx:TenantActorContext,projectId:string,dto?:{comment?:string}){
    requireProjectCommandId(projectId,'INVALID_PROJECT_ID');
    return withTenantTransaction(this.pool,ctx,async client=>{
      await this.assertBaselineAuthority(client,ctx,projectId);await this.lockEditableProject(client,ctx.orgId,projectId);
      const {rows}=await client.query(`SELECT id,version_no,checksum,resolved_payload_json,
        obligation_context_checksum=project_obligation_context_checksum(org_id,project_id) AS context_current FROM checklist_snapshots
        WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE' ORDER BY version_no DESC LIMIT 1`,[ctx.orgId,projectId]);
      const current=rows[0];if(!current||!Array.isArray(current.resolved_payload_json?.requirements)||!current.resolved_payload_json.requirements.length)
        throw new UnprocessableEntityException({code:'CHECKLIST_CONFIGURATION_REQUIRED',detail:'Configure explicit requirements before creating a snapshot.'});
      if(configPayloadChecksum(current.resolved_payload_json)!==current.checksum)throw new ConflictException('ACTIVE_CHECKLIST_CHECKSUM_INVALID');
      if(current.context_current!==true)throw new ConflictException('BASELINE_APPLICABILITY_CONTEXT_CHANGED');
      return {snapshotId:current.id,versionNo:current.version_no,checksum:current.checksum,instantiatedRequirements:0,unchanged:true};
    });
  }

  /**
   * Imports scoped consultant requirements without overwriting the existing
   * snapshot or inventing DT-001 for unknown document types.
   */
  async importL3Checklist(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      profileName?: string;
      requirements: Array<{
        key?: string;
        title: string;
        docTypeKey?: string;
        groupKey?: string;
        mandatory?: boolean;
        scopeType?: 'PROJECT' | 'ASSET_CATEGORY' | 'ASSET';
        assetCategoryKey?: string;
        assetId?: string;
      }>;
    },
  ) {
    if (!Array.isArray(dto?.requirements) || dto.requirements.length === 0 || dto.requirements.length > 1000) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CHECKLIST_IMPORT',
        detail: 'Supply between 1 and 1000 mapped consultant requirements.',
      });
    }

    // Read AND apply in the same RLS-bound transaction, after taking the
    // project lock. A second importer observes the first committed snapshot.
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows: activeSnapshots } = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const currentSnapshot = activeSnapshots[0]?.resolved_payload_json;
    const existingPayload = typeof currentSnapshot === 'string' ? JSON.parse(currentSnapshot) : currentSnapshot;
    const existingReqs: ResolvedRequirementSpec[] =
      Array.isArray(existingPayload?.requirements) ? existingPayload.requirements : [];

    this.assertLegacyRequirementOnlyPayload(existingPayload);
    const newReqs: ResolvedRequirementSpec[] = dto.requirements.map((r, idx) => {
      const title = r.title?.trim();
      const docTypeKey = r.docTypeKey?.trim();
      const scopeType = r.scopeType || 'PROJECT';
      if (!title || !docTypeKey || !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(scopeType) ||
          (scopeType === 'ASSET_CATEGORY' && !r.assetCategoryKey) ||
          (scopeType === 'ASSET' && !r.assetId)) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_MAPPING_REQUIRED',
          detail: `Row ${idx + 1} needs a title, mapped document type and valid project/asset scope.`,
        });
      }
      const naturalKey = [docTypeKey, title.toLowerCase(), scopeType, r.assetCategoryKey || '', r.assetId || ''].join('|');
      const key = r.key?.trim() || `IMPORTED-${createHash('sha256').update(naturalKey).digest('hex').slice(0, 16)}`;
      return {
        key,
        groupKey: r.groupKey?.trim() || 'CONSULTANT',
        title,
        docTypeKey,
        mandatory: r.mandatory !== false,
        scopeType,
        ...(scopeType === 'ASSET_CATEGORY' ? { assetCategoryKey: r.assetCategoryKey } : {}),
        ...(scopeType === 'ASSET' ? { assetId: r.assetId } : {}),
      };
    });

    const newKeys = new Set<string>();
    for (const r of newReqs) {
      if (newKeys.has(r.key)) {
        throw new UnprocessableEntityException({
          code: 'DUPLICATE_CHECKLIST_KEY',
          detail: `The import contains duplicate requirement key '${r.key}'.`,
        });
      }
      newKeys.add(r.key);
    }
    // A repeated import replaces the matching definition instead of creating
    // duplicate obligations. All unrelated requirements remain in the snapshot.
    const combinedReqs = [
      ...existingReqs.filter((r) => !newKeys.has(r.key)),
      ...newReqs,
    ];
    const layer=await this.persistProjectInput(client,ctx,projectId,{requirements:combinedReqs},'CONSULTANT_IMPORT',dto.profileName||'Consultant Checklist Import');
    return this.createAndApplySnapshot(
      ctx,
      projectId,
      [layer],
      undefined,
      dto.profileName || 'Consultant Checklist Import',
      { client, emit },
    );
    });
  }

  /**
   * API-061: POST /api/v1/requirements/:id/waivers
   * Enforces Two-Approver Rule for Mandatory Requirements (FR-CHK-016)
   */
  async waiveRequirement(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    input: {
      type: 'WAIVE' | 'NOT_APPLICABLE';
      reason: string;
      secondApproverUserId?: string;
      evidenceObjectId?: string;
    },
  ) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'A clear reason is required to waive or mark a requirement not applicable.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `SELECT id, mandatory, status, row_version
           FROM requirements
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, requirementId],
      );

      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Requirement not found.' });
      }
      const req = rows[0];

      // Mandatory Requirement Two-Approver Guardrail (FR-CHK-016 / 08 §8 Rule 3)
      if (req.mandatory && input.type === 'WAIVE') {
        if (!input.secondApproverUserId || input.secondApproverUserId === ctx.userId) {
          // If no second approver provided yet, place in PENDING_SECOND_APPROVAL (Smoke Test / WF-20 flow)
          const waiverId = uuidv7();
          await client.query(
            `INSERT INTO waivers
              (id, org_id, project_id, requirement_id, type, reason, evidence_object_id,
               requested_by, approved_by, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
            [
              waiverId,
              ctx.orgId,
              projectId,
              requirementId,
              input.type,
              input.reason.trim(),
              input.evidenceObjectId ?? null,
              ctx.userId,
              WaiverStatus.PENDING_SECOND_APPROVAL,
            ],
          );

          await client.query(
            `UPDATE requirements
                SET status = $4, row_version = row_version + 1, updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [ctx.orgId, projectId, requirementId, RequirementStatus.PENDING_WAIVER],
          );

          return { waiverId, requirementId, status: WaiverStatus.PENDING_SECOND_APPROVAL, requirementStatus: RequirementStatus.PENDING_WAIVER };
        }

        const { rows: secondRows } = await client.query(
          `SELECT role, status FROM memberships
            WHERE org_id = $1 AND user_id = $2`,
          [ctx.orgId, input.secondApproverUserId],
        );
        if (
          secondRows.length === 0 ||
          secondRows[0].status !== 'ACTIVE' ||
          !['R-OWNER', 'R-ADMIN'].includes(secondRows[0].role)
        ) {
          throw new ForbiddenException({
            code: 'INVALID_SECOND_APPROVER',
            detail: 'Countersigning second approver must hold an active R-OWNER or R-ADMIN role.',
          });
        }
      }

      const waiverId = uuidv7();
      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason, evidence_object_id,
           approved_by, second_approved_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')`,
        [
          waiverId,
          ctx.orgId,
          projectId,
          requirementId,
          input.type,
          input.reason.trim(),
          input.evidenceObjectId ?? null,
          ctx.userId,
          input.secondApproverUserId ?? null,
        ],
      );

      const nextStatus = input.type === 'WAIVE' ? 'WAIVED' : 'NOT_APPLICABLE';
      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId, nextStatus],
      );

      emit({
        eventType: `REQUIREMENT_${nextStatus}`,
        projectId,
        entityType: 'REQUIREMENT',
        entityId: requirementId,
        beforeJson: { status: req.status },
        afterJson: {
          status: nextStatus,
          waiverId,
          reason: input.reason,
          secondApproverUserId: input.secondApproverUserId ?? null,
        },
      });

      return { waiverId, requirementId, status: nextStatus };
    });
  }

  /**
   * Controller wrapper for requestWaiver
   */
  async requestWaiver(
    ctx: TenantActorContext,
    requirementId: string,
    reason: string,
    type: 'WAIVE' | 'NOT_APPLICABLE' = 'WAIVE',
  ) {
    if (!reason || reason.trim().length < 5) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'A clear reason is required to waive or mark a requirement not applicable.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const { rows } = await client.query(
        `SELECT id, project_id, mandatory, status, row_version
           FROM requirements
          WHERE org_id = $1 AND id = $2
          FOR UPDATE`,
        [ctx.orgId, requirementId],
      );

      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Requirement not found.' });
      }
      const req = rows[0];
      const projectId = req.project_id;

      const waiverId = uuidv7();
      await client.query(
        `INSERT INTO waivers
          (id, org_id, project_id, requirement_id, type, reason, requested_by, approved_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
        [
          waiverId,
          ctx.orgId,
          projectId,
          requirementId,
          type,
          reason.trim(),
          ctx.userId,
          WaiverStatus.PENDING_SECOND_APPROVAL,
        ],
      );

      await client.query(
        `UPDATE requirements
            SET status = $4, row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [ctx.orgId, projectId, requirementId, RequirementStatus.PENDING_WAIVER],
      );

      return {
        waiverId,
        requirementId,
        status: WaiverStatus.PENDING_SECOND_APPROVAL,
        requirementStatus: RequirementStatus.PENDING_WAIVER,
      };
    });
  }

  /**
   * API-061A POST /waivers/:id/countersign (RT-023)
   */
  async countersignWaiver(ctx: TenantActorContext, waiverId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const waiverRes = await client.query(
        `SELECT * FROM waivers WHERE org_id = $1 AND (id = $2 OR requirement_id = $2) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [ctx.orgId, waiverId],
      );
      if (!waiverRes.rows.length) {
        throw new NotFoundException('WAIVER_NOT_FOUND');
      }
      const waiver = waiverRes.rows[0];

      if (waiver.status !== WaiverStatus.PENDING_SECOND_APPROVAL) {
        throw new ConflictException('WAIVER_NOT_PENDING_SECOND_APPROVAL');
      }

      if (waiver.approved_by === ctx.userId) {
        throw new ForbiddenException('SECOND_APPROVER_MUST_BE_DISTINCT: Approver cannot countersign own waiver');
      }

      await client.query(
        `UPDATE waivers
         SET second_approved_by = $1, second_approved_at = now(), status = $2
         WHERE org_id = $3 AND id = $4`,
        [ctx.userId, WaiverStatus.ACTIVE, ctx.orgId, waiver.id],
      );

      await client.query(
        `UPDATE requirements
         SET status = $1, updated_at = now(), row_version = row_version + 1
         WHERE org_id = $2 AND id = $3`,
        [RequirementStatus.WAIVED, ctx.orgId, waiver.requirement_id],
      );

      return { waiverId: waiver.id, status: WaiverStatus.ACTIVE, requirementStatus: RequirementStatus.WAIVED };
    });
  }

  /**
   * API-050 GET /projects/:id/requirements
   */
  async listRequirements(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      // G02-003: a grant's project_id is not a project-wide read permission.
      // Scope rows in SQL before any serialization/count/search/pagination.
      const isGuest = ctx.actorType === 'GUEST' || Boolean(ctx.guestGrantId);
      if (isGuest && !ctx.guestGrantId) throw new NotFoundException('REQUIREMENTS_NOT_FOUND');
      const res = await client.query(
        `SELECT r.*,
                dv.id AS latest_version_id,
                dv.revision_code AS latest_revision_code,
                dv.review_status AS latest_review_status,
                dv.file_status AS latest_file_status
           FROM requirements r
           LEFT JOIN LATERAL (
             SELECT dr.requirement_id, dv_sub.id, dv_sub.revision_code, dv_sub.review_status, dv_sub.file_status
               FROM document_requirements dr
               JOIN documents d ON d.id = dr.document_id
               JOIN document_versions dv_sub ON dv_sub.id = COALESCE(d.current_approved_version_id, (
                 SELECT id FROM document_versions dv2 WHERE dv2.document_id = d.id ORDER BY dv2.version_no DESC LIMIT 1
               ))
              WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id AND dr.requirement_id = r.id
              LIMIT 1
           ) dv ON true
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL
            ${isGuest ? `AND EXISTS (
                SELECT 1 FROM guest_grants g
                 WHERE g.org_id=r.org_id AND g.project_id=r.project_id
                   AND g.id=$3 AND g.status='ACTIVE' AND g.expires_at>now()
                   AND g.principal_user_id=$4
                   AND (
                     (g.grant_type IN ('SUPPLIER_UPLOAD','SUPPLIER_CONTRIBUTOR')
                       AND g.capabilities && ARRAY['document.upload','document.read']::text[]
                       AND COALESCE(g.scope_json->'requirementIds','[]'::jsonb) ? r.id::text
                       AND (r.owner_party_id IS NULL OR r.owner_party_id=g.party_id))
                     OR
                     (g.grant_type IN ('CLIENT_VIEW','CONSULTANT_REVIEW','MC_VIEW','AUDITOR_READ')
                       AND g.capabilities && ARRAY['document.read','project.read','review.read']::text[]
                       AND (r.status='APPROVED' OR
                            COALESCE(g.scope_json->'requirementIds','[]'::jsonb) ? r.id::text))
                   )
              )` : ''}
          ORDER BY r.milestone_key ASC, r.title ASC`,
        isGuest ? [ctx.orgId, projectId, ctx.guestGrantId, ctx.userId] : [ctx.orgId, projectId],
      );

      // FR-CHK-010: a requirement with due_at IS NULL is never derived as MISSING
      return res.rows.filter((row:any)=>{
        try{
          assertMemberResourceScope(ctx,'requirement',{
            id:row.id,groupKey:row.group_key,
            createdAt:row.created_at?.toISOString?.()||String(row.created_at),
          },false);
          return true;
        }catch{return false;}
      }).map((row:any) => {
        const item = {
          ...row,
          latestVersionId: row.latest_version_id || null,
          revisionCode: row.latest_revision_code || row.revision_code || null,
        };
        if (!row.due_at && row.status === 'MISSING') {
          return { ...item, status: 'NOT_STARTED' };
        }
        return item;
      });
    });
  }

  /**
   * POST /projects/:projectId/requirements
   */
  async createRequirement(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      key: string;
      title: string;
      groupKey?: string;
      docTypeCode?: string;
      mandatory?: boolean;
      assetTag?: string;
      dueDate?: string;
    },
  ) {
    const requiredDocType = dto?.docTypeCode?.trim();
    if (!dto?.key?.trim() || !dto.title?.trim() || !requiredDocType) {
      throw new UnprocessableEntityException({
        code: 'REQUIREMENT_MAPPING_REQUIRED',
        detail: 'A new contractual requirement must have a key, title, and mapped document type.',
      });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows: snaps } = await client.query(
        `SELECT resolved_payload_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const raw = snaps[0]?.resolved_payload_json;
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(snapshot?.requirements) || snapshot.requirements.length === 0) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_CONFIGURATION_REQUIRED',
          detail: 'Configure the project checklist before adding requirements.',
        });
      }
      this.assertLegacyRequirementOnlyPayload(snapshot);
      const key = dto.key.trim();
      if (snapshot.requirements.some((r: ResolvedRequirementSpec) => r.key === key)) {
        throw new ConflictException({
          code: 'DUPLICATE_REQUIREMENT_KEY',
          detail: 'Use a controlled change request to modify an existing obligation.',
        });
      }
      let scopeType: ResolvedRequirementSpec['scopeType'] = 'PROJECT';
      let assetId: string | undefined;
      if (dto.assetTag) {
        const { rows: assets } = await client.query(
          `SELECT id FROM assets WHERE org_id = $1 AND project_id = $2
             AND tag = $3 AND status = 'ACTIVE' AND deleted_at IS NULL`,
          [ctx.orgId, projectId, dto.assetTag],
        );
        if (assets.length !== 1) throw new NotFoundException('PROJECT_ASSET_NOT_FOUND');
        assetId = assets[0].id;
        scopeType = 'ASSET';
      }
      const extra: ResolvedRequirementSpec = {
        key,
        title: dto.title.trim(),
        groupKey: dto.groupKey?.trim() || 'CONSULTANT',
        docTypeKey: requiredDocType,
        mandatory: dto.mandatory !== false,
        scopeType,
        ...(assetId ? { assetId } : {}),
        reviewerRole: 'R-QC',
        ...(dto.dueDate?{dueDate:dto.dueDate}:{}),
      };
      const layer=await this.persistProjectInput(client,ctx,projectId,{requirements:[...snapshot.requirements,extra]},'MANUAL_REQUIREMENT','Manual contractual requirement addition');
      const applied = await this.createAndApplySnapshot(
        ctx, projectId,
        [layer],
        undefined,
        'Manual contractual requirement addition',
        { client, emit },
      );
      const { rows: created } = await client.query(
        `SELECT * FROM requirements WHERE org_id = $1 AND project_id = $2
           AND current_snapshot_id = $3 AND requirement_key = $4
           AND scope_key = $5 AND superseded_at IS NULL`,
        [ctx.orgId, projectId, applied.snapshotId, key, assetId ? `asset:${assetId}` : 'project'],
      );
      if (!created.length) throw new ConflictException('REQUIREMENT_SNAPSHOT_APPLY_FAILED');
      return created[0];
    });
  }

  async proposeSnapshotChangeInTransaction(ctx:TenantActorContext,projectId:string,baselineId:string,layers:ConfigLayerInput[],reason:string,
    client:PoolClient,emit:(ev:DomainOutboxEvent)=>void){
    await this.assertBaselineAuthority(client,ctx,projectId);
    await this.lockEditableProject(client,ctx.orgId,projectId);
    const {rows}=await client.query(`SELECT id,checksum,resolved_payload_json,obligation_context_checksum,obligation_context_json FROM checklist_snapshots
      WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE' ORDER BY version_no DESC LIMIT 1 FOR UPDATE`,[ctx.orgId,projectId]);
    if(rows[0]?.id!==baselineId)throw new ConflictException({code:'BASELINE_VERSION_STALE'});
    await this.assertPersistedLayers(client,ctx,projectId,layers);
    const resolved=resolveConfigurationHierarchy(layers);
    if(resolved.conflicts.length)throw new UnprocessableEntityException({code:'CONFIGURATION_CONFLICT',conflicts:resolved.conflicts});
    const requirements=resolved.payload.requirements;
    if(!Array.isArray(requirements)||!requirements.length)throw new UnprocessableEntityException('CHECKLIST_REQUIREMENTS_MISSING');
    assertLockedChecklistBaselineInvariant(rows[0].resolved_payload_json,resolved.payload,true);
    const {rows:[context]}=await client.query('SELECT project_obligation_context_checksum($1,$2) AS checksum,project_obligation_context($1,$2) AS facts',[ctx.orgId,projectId]);
    if(rows[0].checksum===resolved.checksum&&rows[0].obligation_context_checksum===context.checksum)throw new ConflictException({code:'BASELINE_CHANGE_EMPTY'});
    const before=rows[0].resolved_payload_json.requirements??[];
    const oldByKey=new Map<string,any>(before.map((r:any)=>[r.key,r]));const newByKey=new Map<string,any>(requirements.map((r:any)=>[r.key,r]));
    const impact={added:[...newByKey.keys()].filter(k=>!oldByKey.has(k)),removed:[...oldByKey.keys()].filter(k=>!newByKey.has(k)),
      modified:[...newByKey.keys()].filter(k=>oldByKey.has(k)&&JSON.stringify(oldByKey.get(k))!==JSON.stringify(newByKey.get(k))),
      changedRequirements:[...new Set([...oldByKey.keys(),...newByKey.keys()])].filter(key=>configPayloadChecksum(oldByKey.get(key)??null)!==configPayloadChecksum(newByKey.get(key)??null)).map(key=>({key,before:oldByKey.get(key)??null,after:newByKey.get(key)??null})),
      qualificationWillBeReevaluated:true,acceptanceWillBeReevaluated:true,
      applicabilityContext:{changed:rows[0].obligation_context_checksum!==context.checksum,beforeChecksum:rows[0].obligation_context_checksum,afterChecksum:context.checksum,
        before:rows[0].obligation_context_json,after:context.facts,unresolvedFactsMustBeReviewed:true}};
    const id=uuidv7();const {rows:created}=await client.query(`INSERT INTO requirement_change_requests
      (id,org_id,project_id,change_type,reason,requested_by,status,baseline_snapshot_id,proposed_checksum,proposed_layers_json,impact_json)
      VALUES($1,$2,$3,'MODIFY',$4,$5,'PENDING',$6,$7,$8,$9) RETURNING *`,
      [id,ctx.orgId,projectId,reason.trim(),ctx.userId,baselineId,resolved.checksum,JSON.stringify(layers),JSON.stringify(impact)]);
    emit({eventType:'BASELINE_CHANGE_REQUESTED',projectId,entityType:'REQUIREMENT_CHANGE_REQUEST',entityId:id,
      afterJson:{baselineSnapshotId:baselineId,proposedChecksum:resolved.checksum,impact}});return created[0];
  }

  async applyChangeRequest(ctx:TenantActorContext,projectId:string,id:string){
    requireProjectCommandId(projectId,'INVALID_PROJECT_ID');requireProjectCommandId(id,'INVALID_CHANGE_REQUEST_ID');
    return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
      await this.assertBaselineAuthority(client,ctx,projectId);
      await this.lockEditableProject(client,ctx.orgId,projectId);
      const {rows}=await client.query('SELECT * FROM requirement_change_requests WHERE org_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',[ctx.orgId,projectId,id]);
      const request=rows[0];if(!request)throw new NotFoundException('CHANGE_REQUEST_NOT_FOUND');
      if(request.status==='APPLIED')return {snapshotId:request.applied_snapshot_id,unchanged:true};
      if(request.status!=='APPROVED'||!Array.isArray(request.proposed_layers_json))throw new ConflictException('APPROVED_BASELINE_CHANGE_REQUIRED');
      return this.createAndApplySnapshot(ctx,projectId,request.proposed_layers_json,id,request.reason,{client,emit});
    });
  }

  async reviewBaseline(ctx:TenantActorContext,projectId:string,value:unknown){
    const dto=projectCommandRecord(value,['snapshotId','checksum','reason'],'INVALID_BASELINE_REVIEW');
    requireProjectCommandId(projectId,'INVALID_PROJECT_ID');requireProjectCommandId(dto.snapshotId,'INVALID_SNAPSHOT_ID');
    if(typeof dto.checksum!=='string'||!/^[a-f0-9]{64}$/.test(dto.checksum)||typeof dto.reason!=='string'||dto.reason.trim().length<5||dto.reason.length>1000)
      throw new UnprocessableEntityException('BASELINE_REVIEW_REASON_REQUIRED');
    return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
      const {rows:members}=await client.query(`SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
        WHERE m.org_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' FOR SHARE OF m,u`,[ctx.orgId,ctx.userId]);
      if(ctx.guestGrantId||!['R-OWNER','R-ADMIN'].includes(members[0]?.role))throw new ForbiddenException('BASELINE_REVIEW_AUTHORITY_REQUIRED');
      await this.lockEditableProject(client,ctx.orgId,projectId);
      const {rows}=await client.query(`SELECT id,checksum,created_by,obligation_context_checksum=project_obligation_context_checksum(org_id,project_id) AS context_current FROM checklist_snapshots WHERE org_id=$1 AND project_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE`,[ctx.orgId,projectId,dto.snapshotId]);
      const snapshot=rows[0];if(!snapshot||snapshot.checksum!==dto.checksum)throw new ConflictException('BASELINE_REVIEW_STALE');
      if(snapshot.context_current!==true)throw new ConflictException('BASELINE_APPLICABILITY_CONTEXT_CHANGED');
      if(snapshot.created_by===ctx.userId)throw new ForbiddenException('BASELINE_SELF_REVIEW_FORBIDDEN');
      const {rows:approved}=await client.query(`INSERT INTO project_baseline_approvals(id,org_id,project_id,snapshot_id,checksum,reviewer_user_id,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(org_id,project_id,snapshot_id) DO NOTHING RETURNING *`,[uuidv7(),ctx.orgId,projectId,dto.snapshotId,dto.checksum,ctx.userId,dto.reason]);
      if(approved.length)emit({eventType:'PROJECT_BASELINE_REVIEWED',projectId,entityType:'CHECKLIST_SNAPSHOT',entityId:snapshot.id,afterJson:{checksum:snapshot.checksum}});
      return {snapshotId:snapshot.id,reviewed:true};
    });
  }

  /**
   * API-063: POST /projects/:projectId/requirements/:id/change-requests (WF-20)
   */
  async requestChange(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    dto: { changeType: 'ADD' | 'REMOVE' | 'MODIFY'; reason: string; deltaJson?: any },
  ) {
    const input=projectCommandRecord(dto,['changeType','reason','deltaJson'],'INVALID_BASELINE_CHANGE');
    requireProjectCommandId(projectId,'INVALID_PROJECT_ID');requireProjectCommandId(requirementId,'INVALID_REQUIREMENT_ID');
    if(!['ADD','REMOVE','MODIFY'].includes(String(input.changeType))||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>500)
      throw new UnprocessableEntityException('INVALID_BASELINE_CHANGE');
    let delta:Record<string,unknown>;try{delta=boundedJsonObject(input.deltaJson??{},32768);}catch{throw new UnprocessableEntityException('INVALID_BASELINE_DELTA');}
    return withTenantTransaction(this.pool,ctx,async(client,emit)=>{
      await this.lockEditableProject(client,ctx.orgId,projectId);
      const {rows:requirements}=await client.query('SELECT requirement_key FROM requirements WHERE org_id=$1 AND project_id=$2 AND id=$3 AND superseded_at IS NULL',[ctx.orgId,projectId,requirementId]);
      if(!requirements.length&&input.changeType!=='ADD')throw new NotFoundException('REQUIREMENT_NOT_FOUND');
      const {rows}=await client.query(`SELECT id,resolved_payload_json FROM checklist_snapshots WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE' ORDER BY version_no DESC LIMIT 1`,[ctx.orgId,projectId]);
      if(!rows.length)throw new ConflictException('CHECKLIST_CONFIGURATION_REQUIRED');
      if(Object.keys(rows[0].resolved_payload_json).some(k=>!['requirements','checklist.requirements'].includes(k)))throw new ConflictException('USE_PERSISTED_CONFIGURATION_CHANGE_WORKFLOW');
      const existing=rows[0].resolved_payload_json.requirements??[];const key=requirements[0]?.requirement_key;
      let proposed=existing;
      if(input.changeType==='REMOVE')proposed=existing.filter((r:any)=>r.key!==key);
      if(input.changeType==='MODIFY')proposed=existing.map((r:any)=>r.key===key?{...r,...delta,key:r.key}:r);
      if(input.changeType==='ADD')proposed=[...existing,delta];
      const layer=await this.persistProjectInput(client,ctx,projectId,{requirements:proposed},'CHANGE_PROPOSAL',input.reason as string);
      return this.proposeSnapshotChangeInTransaction(ctx,projectId,rows[0].id,[layer],input.reason as string,client,emit);
    });
  }

  /**
   * API-064: GET /projects/:projectId/change-requests (WF-20)
   */
  async listChangeRequests(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT cr.*, u.name AS requester_name
           FROM requirement_change_requests cr
           JOIN users u ON u.id = cr.requested_by
          WHERE cr.org_id = $1 AND cr.project_id = $2
          ORDER BY cr.created_at DESC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * API-065: POST /change-requests/:id/decide (WF-20)
   */
  async decideChangeRequest(
    ctx: TenantActorContext,
    changeRequestId: string,
    dto: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    requireProjectCommandId(changeRequestId,'INVALID_CHANGE_REQUEST_ID');
    if (!dto || !['APPROVED', 'REJECTED'].includes(dto.decision) ||
        (dto.comment !== undefined &&
          (typeof dto.comment !== 'string' || dto.comment.length > 2000))) {
      throw new UnprocessableEntityException({ code: 'INVALID_CHANGE_DECISION' });
    }
    return withTenantTransaction(this.pool, ctx, async (
      client: PoolClient, emit: (ev: DomainOutboxEvent) => void,
    ) => {
      // PH2-G06-006: a change decision is an independently authorised action.
      // A caller's project.manage/checklist.manage claim is not enough.
      const { rows: approverRows } = await client.query(
        `SELECT role FROM memberships
           WHERE org_id=$1 AND user_id=$2 AND status='ACTIVE' FOR SHARE`,
        [ctx.orgId, ctx.userId],
      );
      if (!['R-OWNER', 'R-ADMIN'].includes(approverRows[0]?.role)) {
        throw new ForbiddenException({ code: 'CHANGE_REVIEW_AUTHORITY_REQUIRED' });
      }
      const {rows:targets}=await client.query('SELECT project_id FROM requirement_change_requests WHERE org_id=$1 AND id=$2',[ctx.orgId,changeRequestId]);
      if(!targets.length)throw new NotFoundException('CHANGE_REQUEST_NOT_FOUND');
      await this.lockEditableProject(client,ctx.orgId,targets[0].project_id);
      const crRes = await client.query(
        `SELECT * FROM requirement_change_requests WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, changeRequestId],
      );
      if (!crRes.rows.length) throw new NotFoundException('CHANGE_REQUEST_NOT_FOUND');
      const cr = crRes.rows[0];
      if(dto.decision==='APPROVED'){
        if(!Array.isArray(cr.proposed_layers_json))throw new ConflictException('VERSIONED_CHANGE_PROPOSAL_REQUIRED');
        await this.assertPersistedLayers(client,ctx,cr.project_id,cr.proposed_layers_json);
        const {rows:[context]}=await client.query('SELECT project_obligation_context_checksum($1,$2) AS checksum',[ctx.orgId,cr.project_id]);
        if(cr.proposed_context_checksum!==context.checksum)throw new ConflictException('BASELINE_PROPOSAL_CONTEXT_STALE');
      }

      if (!['PENDING','SUBMITTED'].includes(cr.status)) {
        throw new ConflictException('CHANGE_REQUEST_ALREADY_DECIDED');
      }
      await this.lockEditableProject(client,ctx.orgId,cr.project_id);
      const {rows:baselines}=await client.query(`SELECT id FROM checklist_snapshots WHERE org_id=$1 AND project_id=$2 AND status='ACTIVE' ORDER BY version_no DESC LIMIT 1`,[ctx.orgId,cr.project_id]);
      if(dto.decision==='APPROVED'&&(!cr.baseline_snapshot_id||cr.baseline_snapshot_id!==baselines[0]?.id||!cr.proposed_checksum||!Array.isArray(cr.proposed_layers_json)))
        throw new ConflictException('BASELINE_CHANGE_REQUIRES_VERSION_BOUND_PROPOSAL');
      if (dto.decision==='APPROVED'&&cr.requested_by === ctx.userId) {
        throw new ForbiddenException({ code: 'CHANGE_REQUEST_SELF_APPROVAL_FORBIDDEN' });
      }

      const res = await client.query(
        `UPDATE requirement_change_requests
            SET status = $1, approved_by = $2, decided_at = now(),
                row_version = row_version + 1
          WHERE org_id = $3 AND id = $4
          RETURNING *`,
        [dto.decision, ctx.userId, ctx.orgId, changeRequestId],
      );

      // Approval only authorises a subsequent, version-bound change-control
      // application. It MUST NOT directly remove an active requirement:
      // doing so invalidates readiness without generating a new snapshot,
      // impact analysis, waiver reconciliation or revised acceptance.
      emit({
        eventType: 'REQUIREMENT_CHANGE_DECIDED',
        projectId: cr.project_id,
        entityType: 'REQUIREMENT_CHANGE_REQUEST',
        entityId: cr.id,
        beforeJson: { status: cr.status },
        afterJson: {
          status: dto.decision,
          changeType: cr.change_type,
          applied: false,
        },
      });

      return res.rows[0];
    });
  }
}
