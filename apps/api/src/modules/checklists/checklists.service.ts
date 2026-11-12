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
import { RequirementStatus, WaiverStatus } from '@tradecloseout/shared';
import {loadConfigurationSources,storeScopedConfiguration} from '../configuration/configuration-store';

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
  validityRule?: Record<string, unknown>;
}

/**
 * PH2-G06-001/006: the configuration resolver sees each requested layer,
 * not the previously accepted project snapshot. A new single-layer import
 * must not erase or weaken a locked obligation carried by that snapshot.
 * Compare immutable obligation semantics (not volatile provenance metadata)
 * before the active snapshot is superseded.
 */
export function assertLockedChecklistBaselineInvariant(previous: unknown, proposed: unknown): void {
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
    if (item.locked !== true) continue;
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

  private async projectAuthoringLayers(client:PoolClient,ctx:TenantActorContext,projectId:string,snapshot:any,updates:ResolvedRequirementSpec[]):Promise<ConfigLayerInput[]> {
    const decoded=typeof snapshot?.resolved_payload_json==='string'?JSON.parse(snapshot.resolved_payload_json):snapshot?.resolved_payload_json;
    if(snapshot?.provenance_json?.version===2&&Array.isArray(snapshot.source_json)) {
      const sources=await loadConfigurationSources(client,ctx,projectId,snapshot.source_json.map((s:any)=>({level:s.level,versionId:s.versionId})),true);
      const previous=resolveConfigurationHierarchy(sources);
      if(previous.conflicts.length||previous.checksum!==snapshot.checksum||sources.some(s=>
        !snapshot.source_json.some((r:any)=>r.level===s.level&&r.versionId===s.versionId&&r.definitionChecksum===s.checksum))) {
        throw new ConflictException({code:'CURRENT_CONFIGURATION_SOURCE_MISMATCH'});
      }
      if(updates.length===0)return sources;
      const local=sources.find(s=>s.level==='PROJECT');
      const existing=Array.isArray(local?.payload.requirements)?local!.payload.requirements as ResolvedRequirementSpec[]:[];
      const combined=new Map(existing.map(r=>[r.key,r]));
      let changed=false;
      for(const row of updates) {
        const effective=(previous.payload.requirements as ResolvedRequirementSpec[]).find(r=>r.key===row.key);
        if(effective&&Object.entries(row).every(([key,value])=>JSON.stringify((effective as any)[key])===JSON.stringify(value)))continue;
        const merged={...combined.get(row.key),...row};
        if(row.scopeType!=='ASSET')delete merged.assetId;
        if(row.scopeType!=='ASSET_CATEGORY')delete merged.assetCategoryKey;
        combined.set(row.key,merged);changed=true;
      }
      if(!changed)return sources;
      return [...sources.filter(s=>s.level!=='PROJECT'),{level:'PROJECT',versionId:'server-authored-project-version',sourceMode:'MANUAL_PROJECT_INPUT',
        payload:{...(local?.payload??{}),requirements:[...combined.values()]}}];
    }
    // Legacy source claims remain historical, unverified claims. An explicit
    // new manual definition records its actual parent snapshot and author.
    const existing=Array.isArray(decoded?.requirements)?decoded.requirements as ResolvedRequirementSpec[]:[];
    const combined=new Map(existing.map(r=>[r.key,r]));
    for(const row of updates)combined.set(row.key,row);
    return [{level:'PROJECT',versionId:'server-authored-project-version',sourceMode:'MANUAL_PROJECT_INPUT',payload:{requirements:[...combined.values()]}}];
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
    let resolved = resolveConfigurationHierarchy(layers);
    if (resolved.conflicts.length > 0) {
      throw new UnprocessableEntityException({
        code: 'RULE_CONFLICT',
        title: 'Configuration conflict detected',
        detail: resolved.conflicts[0]!.message,
        fieldErrors: resolved.conflicts.map((c) => ({ field: c.path, message: c.message })),
      });
    }

    let reqSpecs = (resolved.payload.requirements ?? []) as ResolvedRequirementSpec[];
    if (!Array.isArray(reqSpecs) || reqSpecs.length === 0) {
      throw new UnprocessableEntityException({
        code: 'CHECKLIST_REQUIREMENTS_MISSING',
        detail: 'A checklist needs explicit contract or trade requirements. An empty snapshot cannot be applied.',
      });
    }
    const seenKeys = new Set<string>();
    for (const spec of reqSpecs) {
      if (!spec.key?.trim() || !spec.title?.trim() || !spec.docTypeKey?.trim() ||
          !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(spec.scopeType) ||
          (spec.scopeType === 'ASSET_CATEGORY' && !spec.assetCategoryKey) ||
          (spec.scopeType === 'ASSET' && !spec.assetId)) {
        throw new UnprocessableEntityException({
          code: 'INVALID_CHECKLIST_REQUIREMENT',
          detail: 'Requirements need a key, title, document type, and an explicit valid scope.',
        });
      }
      if (seenKeys.has(spec.key)) {
        throw new UnprocessableEntityException({
          code: 'DUPLICATE_CHECKLIST_KEY',
          detail: `Requirement key '${spec.key}' appears more than once.`,
        });
      }
      seenKeys.add(spec.key);
    }

    const applySnapshot = async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // Serialize competing snapshot writers, including the first snapshot when
      // there is no existing checklist row to lock.
      await this.lockEditableProject(client, ctx.orgId, projectId);
      // Supersede prior ACTIVE snapshot if one exists (06 §3.5)
      const { rows: priorSnaps } = await client.query(
        `SELECT id, version_no, resolved_payload_json,checksum,provenance_json,source_json FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2
          ORDER BY version_no DESC LIMIT 1
          FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      const staged:ConfigLayerInput[]=[];
      for(const layer of layers) {
        if(layer.sourceMode==='MANUAL_PROJECT_INPUT') {
          if(layer.level!=='PROJECT')throw new UnprocessableEntityException({code:'MANUAL_CONFIGURATION_SCOPE_INVALID'});
          const version=await storeScopedConfiguration(client,ctx,projectId,{level:'PROJECT',payload:layer.payload,
            sourceManifest:{kind:'EXPLICIT_PROJECT_AUTHORING',reason:changeReason,
              parentSnapshotId:priorSnaps[0]?.id??null,parentSnapshotRecordedChecksum:priorSnaps[0]?.checksum??null,
              parentSnapshotProvenanceVersion:priorSnaps[0]?.provenance_json?.version??0}});
          staged.push({...layer,versionId:version.id,payload:version.payload_json});
        } else staged.push({...layer,versionId:layer.versionId.toLowerCase()});
      }
      const sourceLayers=await loadConfigurationSources(client,ctx,projectId,staged.map(l=>({level:l.level,versionId:l.versionId})),false,true);
      const levels=['PLATFORM','ORG','CLIENT_CONTRACT','PROJECT'];
      sourceLayers.sort((a,b)=>levels.indexOf(a.level)-levels.indexOf(b.level));
      // A stored identity is not permission to silently substitute different
      // caller-provided values. Compare definitions using the DB's canonical hash.
      for(const layer of staged) {
        const source=sourceLayers.find(s=>s.versionId===layer.versionId)!;
        const {rows}=await client.query('SELECT phase2_config_digest($1::jsonb) AS checksum',[JSON.stringify(layer.payload)]);
        if(rows[0]?.checksum!==source.checksum)throw new ConflictException({code:'CONFIGURATION_SOURCE_PAYLOAD_MISMATCH'});
      }
      resolved=resolveConfigurationHierarchy(sourceLayers);
      if(resolved.conflicts.length)throw new UnprocessableEntityException({code:'RULE_CONFLICT',fieldErrors:resolved.conflicts});
      reqSpecs=(resolved.payload.requirements??[]) as ResolvedRequirementSpec[];
      if(!Array.isArray(reqSpecs)||!reqSpecs.length||reqSpecs.some(spec=>
        typeof spec.key!=='string'||!spec.key.trim()||typeof spec.title!=='string'||!spec.title.trim()||
        typeof spec.groupKey!=='string'||!spec.groupKey.trim()||typeof spec.docTypeKey!=='string'||!spec.docTypeKey.trim()||typeof spec.mandatory!=='boolean')) {
        throw new UnprocessableEntityException({code:'INVALID_CHECKLIST_REQUIREMENT'});
      }
      assertLockedChecklistBaselineInvariant(priorSnaps[0]?.resolved_payload_json, resolved.payload);

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

      const prior=priorSnaps[0];
      const identities=(items:any[])=>JSON.stringify(items.map(s=>({level:s.level,versionId:s.versionId,checksum:s.definitionChecksum??s.checksum})).sort((a,b)=>a.level.localeCompare(b.level)));
      if(prior?.provenance_json?.version===2&&prior.checksum===resolved.checksum&&Array.isArray(prior.source_json)&&
        identities(prior.source_json)===identities(sourceLayers)) {
        const {rows:current}=await client.query(`SELECT requirement_key,scope_key FROM requirements
          WHERE org_id=$1 AND project_id=$2 AND superseded_at IS NULL`,[ctx.orgId,projectId]);
        const existingKeys=current.map(r=>r.requirement_key+'|'+r.scope_key).sort();
        const targetKeys=targetInstances.map(i=>i.spec.key+'|'+i.scopeKey).sort();
        if(JSON.stringify(existingKeys)===JSON.stringify(targetKeys))return {
          snapshotId:prior.id,versionNo:prior.version_no,checksum:prior.checksum,instantiatedRequirements:current.length,
          sourceVersionIds:sourceLayers.map(l=>l.versionId),replayed:true,
        };
      }

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
          JSON.stringify({version:2,fields:resolved.provenance,items:resolved.itemProvenance}),
          JSON.stringify(sourceLayers.map(l=>({level:l.level,versionId:l.versionId,definitionChecksum:l.checksum,sourceManifest:l.sourceManifest}))),
          resolved.checksum,
          ctx.userId,
        ],
      );

      // Reconcile against persistent requirements table + write requirement_revisions (07 §6.3, 08 §5.4)
      for (const inst of targetInstances) {
        const { rows: existingRows } = await client.query(
          `SELECT id, title, doc_type_key, mandatory, reviewer_role
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

        const dueAtSql =
          typeof inst.spec.dueOffsetDays === 'number'
            ? new Date(Date.now() + inst.spec.dueOffsetDays * 86_400_000).toISOString()
            : null;

        if (existingRows.length === 0) {
          const reqId = uuidv7();
          const assetId = inst.scopeKey.startsWith('asset:') ? inst.scopeKey.slice(6) : null;
          await client.query(
            `INSERT INTO requirements
              (id, org_id, project_id, current_snapshot_id, requirement_key, scope_key,
               asset_id, group_key, title, description, doc_type_key, mandatory, reviewer_role, due_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'NOT_STARTED')`,
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
          const semanticChange =
            ex.title !== inst.spec.title ||
            ex.doc_type_key !== inst.spec.docTypeKey ||
            ex.mandatory !== inst.spec.mandatory ||
            ex.reviewer_role !== reviewerRole;
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
          await client.query(
            `UPDATE requirements
                SET current_snapshot_id = $4,
                    title = $5,
                    doc_type_key = $6,
                    mandatory = $7,
                    reviewer_role = $8,
                    status = CASE WHEN $9::boolean AND status IN ('WAIVED','NOT_APPLICABLE','PENDING_WAIVER') THEN 'NOT_STARTED' ELSE status END,
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
              semanticChange,
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

      await client.query(`UPDATE config_versions SET status='ACTIVE'
        WHERE org_id=$1 AND id=ANY($2::uuid[]) AND status='DRAFT'`,[ctx.orgId,sourceLayers.map(l=>l.versionId)]);
      emit({
        eventType: 'CHECKLIST_SNAPSHOT_CREATED',
        projectId,
        entityType: 'CHECKLIST_SNAPSHOT',
        entityId: snapshotId,
        afterJson: {
          versionNo: nextVersionNo,
          checksum: resolved.checksum,
          instantiatedCount: targetInstances.length,
          sourceVersionIds:sourceLayers.map(l=>l.versionId),
        },
      });

      return {
        snapshotId,
        versionNo: nextVersionNo,
        checksum: resolved.checksum,
        instantiatedRequirements: targetInstances.length,
        sourceVersionIds:sourceLayers.map(l=>l.versionId),
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
      const installed=await storeScopedConfiguration(client,ctx,projectId,{level:'ORG',payload,sourcePackId:pack.id,
        sourceManifest:{kind:'REVIEWED_PACK_INSTALL',packId:pack.id,packCode:pack.code,packVersion:pack.version,
          packDefinitionChecksum:pack.payload_checksum,packReviewCandidateSha:pack.reviewed_candidate_sha}});
      const result = await this.createAndApplySnapshot(
        ctx,
        projectId,
        [{ level: 'ORG', versionId: installed.id, payload }],
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
  async createSnapshot(ctx: TenantActorContext, projectId: string, dto?: { comment?: string }) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // Lock BEFORE reading the baseline, so reapply cannot overwrite a
      // concurrent consultant import with a stale snapshot.
      await this.lockEditableProject(client, ctx.orgId, projectId);
      const { rows } = await client.query(
        `SELECT resolved_payload_json,id,checksum,source_json,provenance_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const existing = rows[0]?.resolved_payload_json;
      const payload = typeof existing === 'string' ? JSON.parse(existing) : existing;
      if (!Array.isArray(payload?.requirements) || payload.requirements.length === 0) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_CONFIGURATION_REQUIRED',
          detail: 'Import a consultant checklist or configure a real HVAC template before creating a snapshot.',
        });
      }
      return this.createAndApplySnapshot(
        ctx, projectId,
        await this.projectAuthoringLayers(client,ctx,projectId,rows[0],[]),
        undefined, dto?.comment || 'Reapply configured checklist',
        { client, emit },
      );
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
    const fields=new Set(['key','title','docTypeKey','groupKey','mandatory','scopeType','assetCategoryKey','assetId']);
    if(!dto||typeof dto!=='object'||Array.isArray(dto)||Object.keys(dto).some(k=>!['profileName','requirements'].includes(k))||
      (dto.profileName!==undefined&&(typeof dto.profileName!=='string'||dto.profileName.trim().length>200||/[\p{Cc}\p{Cs}]/u.test(dto.profileName)))||
      (Array.isArray(dto.requirements)&&dto.requirements.some(r=>!r||typeof r!=='object'||Array.isArray(r)||
        Object.keys(r).some(k=>!fields.has(k))||Object.entries(r).some(([key,value])=>
          key==='mandatory'?typeof value!=='boolean':typeof value!=='string'||value.length>2048)))) {
      throw new UnprocessableEntityException({code:'INVALID_CHECKLIST_IMPORT'});
    }
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
        `SELECT resolved_payload_json,id,checksum,source_json,provenance_json FROM checklist_snapshots
           WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
           ORDER BY version_no DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const currentSnapshot = activeSnapshots[0]?.resolved_payload_json;
    const existingPayload = typeof currentSnapshot === 'string' ? JSON.parse(currentSnapshot) : currentSnapshot;
    const existingReqs: ResolvedRequirementSpec[] =
      Array.isArray(existingPayload?.requirements) ? existingPayload.requirements : [];

    const newReqs: ResolvedRequirementSpec[] = dto.requirements.map((r, idx) => {
      const title = r.title?.trim();
      const docTypeKey = r.docTypeKey?.trim();
      const previous=r.key?existingReqs.find(old=>old.key===r.key!.trim()):undefined;
      const scopeType = r.scopeType??previous?.scopeType??'PROJECT';
      const assetCategoryKey=r.assetCategoryKey??previous?.assetCategoryKey;
      const assetId=r.assetId??previous?.assetId;
      if (!title || !docTypeKey || !['PROJECT', 'ASSET_CATEGORY', 'ASSET'].includes(scopeType) ||
          (scopeType === 'ASSET_CATEGORY' && !assetCategoryKey) ||
          (scopeType === 'ASSET' && !assetId) ||
          (r.assetId!==undefined&&scopeType!=='ASSET')||(r.assetCategoryKey!==undefined&&scopeType!=='ASSET_CATEGORY')) {
        throw new UnprocessableEntityException({
          code: 'CHECKLIST_MAPPING_REQUIRED',
          detail: `Row ${idx + 1} needs a title, mapped document type and valid project/asset scope.`,
        });
      }
      const naturalKey = [docTypeKey, title.toLowerCase(), scopeType, assetCategoryKey || '', assetId || ''].join('|');
      const key = r.key?.trim() || `IMPORTED-${createHash('sha256').update(naturalKey).digest('hex').slice(0, 16)}`;
      return {
        key,
        groupKey: r.groupKey?.trim()||previous?.groupKey||'CONSULTANT',
        title,
        docTypeKey,
        mandatory: r.mandatory??previous?.mandatory??true,
        scopeType,
        ...(scopeType === 'ASSET_CATEGORY' ? { assetCategoryKey } : {}),
        ...(scopeType === 'ASSET' ? { assetId } : {}),
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
    const authoringLayers=await this.projectAuthoringLayers(client,ctx,projectId,activeSnapshots[0],newReqs);
    return this.createAndApplySnapshot(
      ctx,
      projectId,
      authoringLayers,
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
    if(!dto||typeof dto!=='object'||Array.isArray(dto)||
      ['key','title','groupKey','docTypeCode','assetTag','dueDate'].some(k=>
        (dto as any)[k]!==undefined&&(typeof (dto as any)[k]!=='string'||(dto as any)[k].length>2048))||
      (dto.mandatory!==undefined&&typeof dto.mandatory!=='boolean')) {
      throw new UnprocessableEntityException({code:'INVALID_REQUIREMENT_INPUT'});
    }
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
        `SELECT resolved_payload_json,id,checksum,source_json,provenance_json FROM checklist_snapshots
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
      };
      const applied = await this.createAndApplySnapshot(
        ctx, projectId,
        await this.projectAuthoringLayers(client,ctx,projectId,snaps[0],[extra]),
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

  /**
   * API-063: POST /projects/:projectId/requirements/:id/change-requests (WF-20)
   */
  async requestChange(
    ctx: TenantActorContext,
    projectId: string,
    requirementId: string,
    dto: { changeType: 'ADD' | 'REMOVE' | 'MODIFY'; reason: string; deltaJson?: any },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const crId = uuidv7();
      const res = await client.query(
        `INSERT INTO requirement_change_requests (
          id, org_id, project_id, requirement_id, change_type, reason,
          delta_json, status, requested_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
        RETURNING *`,
        [
          crId,
          ctx.orgId,
          projectId,
          requirementId,
          dto.changeType,
          dto.reason,
          dto.deltaJson ? JSON.stringify(dto.deltaJson) : null,
          ctx.userId,
        ],
      );
      return res.rows[0];
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
      const crRes = await client.query(
        `SELECT * FROM requirement_change_requests WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, changeRequestId],
      );
      if (!crRes.rows.length) throw new NotFoundException('CHANGE_REQUEST_NOT_FOUND');
      const cr = crRes.rows[0];

      if (!['PENDING','SUBMITTED'].includes(cr.status)) {
        throw new ConflictException('CHANGE_REQUEST_ALREADY_DECIDED');
      }
      if (cr.requested_by === ctx.userId) {
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
