import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext, assertMemberResourceScope, assertValidMemberProjectScope } from '@tradecloseout/db/tenant-tx';
import { isImmutableStorageVersion } from '@tradecloseout/shared';
import { evaluateReadinessInTransaction } from '../handover/closeout-readiness';

@Injectable()
export class WarrantyAndBillingService {
  constructor(private readonly pool: Pool) {}

  /**
   * A supplier contributor's project-wide capability is NOT an assignment
   * to every defect. Recheck the live guest grant and party in the same RLS
   * transaction as the remedy mutation. Invalid scopes fail closed.
   */
  private async supplierDefectGrant(
    client: PoolClient, ctx: TenantActorContext, projectId: string,
  ): Promise<{partyId: string; assetIds: string[] | null}> {
    if (!ctx.guestGrantId) {
      throw new ForbiddenException({ code: 'DEFECT_GUEST_GRANT_REQUIRED' });
    }
    const { rows } = await client.query(
      `SELECT g.party_id, g.grant_type, g.scope_json
         FROM guest_grants g
         JOIN parties p ON p.org_id = g.org_id AND p.id = g.party_id
        WHERE g.org_id = $1 AND g.project_id = $2 AND g.id = $3
          AND g.principal_user_id = $4 AND g.status = 'ACTIVE'
          AND g.expires_at > now()
          AND 'defect.manage' = ANY(g.capabilities)
          AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
        FOR SHARE OF g, p`,
      [ctx.orgId, projectId, ctx.guestGrantId, ctx.userId],
    );
    const grant = rows[0];
    if (!grant || grant.grant_type !== 'SUPPLIER_CONTRIBUTOR' || !grant.party_id) {
      throw new ForbiddenException({ code: 'DEFECT_SUPPLIER_GRANT_INELIGIBLE' });
    }
    const scope = typeof grant.scope_json === 'string'
      ? JSON.parse(grant.scope_json) : grant.scope_json;
    const rawAssetIds = scope?.assetIds;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (rawAssetIds !== undefined &&
        (!Array.isArray(rawAssetIds) || rawAssetIds.length > 1000 ||
          rawAssetIds.some((id: unknown) => typeof id !== 'string' || !uuid.test(id)))) {
      throw new ForbiddenException({ code: 'DEFECT_SUPPLIER_ASSET_SCOPE_INVALID' });
    }
    return { partyId: grant.party_id, assetIds: rawAssetIds ?? null };
  }

  /** Apply narrow asset scope to defect reads/writes, without granting
   * unassigned Site contributors unrestricted mutation rights. */
  private async assertMemberDefectScope(
    client: PoolClient, ctx: TenantActorContext,
    defect: Record<string, any>, write: boolean,
  ): Promise<void> {
    if (ctx.actorType === 'SYSTEM' || ctx.actorType === 'ADMIN' ||
        ctx.actorType === 'GUEST' || ctx.guestGrantId) return;
    const orgRole = (ctx as TenantActorContext & {orgRole?: string}).orgRole;
    if (orgRole === 'R-OWNER' || orgRole === 'R-ADMIN') return;
    try {
      assertValidMemberProjectScope(ctx.projectScope);
    } catch {
      throw new ForbiddenException({ code: 'DEFECT_MEMBER_SCOPE_INVALID' });
    }
    const scope = ctx.projectScope ?? {};
    const date = defect.raised_at instanceof Date
      ? defect.raised_at.toISOString().slice(0, 10)
      : typeof defect.raised_at === 'string' ? defect.raised_at.slice(0, 10) : undefined;
    if ((scope.startDate !== undefined || scope.endDate !== undefined) && !date) {
      throw new ForbiddenException({ code: 'DEFECT_MEMBER_DATE_SCOPE_UNKNOWN' });
    }
    let categoryKey: string | undefined;
    if (defect.asset_id && scope.assetCategories !== undefined) {
      const { rows } = await client.query(
        `SELECT category_key FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR SHARE`,
        [ctx.orgId, defect.project_id, defect.asset_id],
      );
      categoryKey = rows[0]?.category_key;
    }
    try {
      assertMemberResourceScope(
        {...ctx, orgRole}, 'asset',
        {id: defect.asset_id || '', categoryKey, createdAt: date}, write,
      );
    } catch {
      throw new ForbiddenException({ code: 'DEFECT_ASSET_SCOPE_DENIED' });
    }
  }

  /**
   * Lock the project before the defect, matching project-closure's lock order.
   * A standalone /defects/:id route is resolved to its actual project, and
   * both project and defect membership are checked under one transaction.
   * AFTERCARE is the only legitimate mutation of a CLOSED project's defects;
   * the accepted full-handover snapshot is never re-opened or rewritten.
   */
  private async lockDefectForMutation(
    client: PoolClient, ctx: TenantActorContext,
    routeProjectId: string, defectId: string,
  ): Promise<{ defect: Record<string, any>; targetProjectId: string }> {
    let targetProjectId = routeProjectId || ctx.projectId || '';
    if (!targetProjectId) {
      const { rows } = await client.query(
        `SELECT project_id FROM defects WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, defectId],
      );
      if (!rows.length) {
        throw new NotFoundException({ code: 'DEFECT_NOT_FOUND' });
      }
      targetProjectId = rows[0].project_id;
    }
    if (ctx.projectId && ctx.projectId !== targetProjectId) {
      throw new NotFoundException({ code: 'DEFECT_PROJECT_MISMATCH' });
    }
    const { rows: projects } = await client.query(
      `SELECT id, status, closed_at, purged_at FROM projects
        WHERE org_id = $1 AND id = $2 FOR UPDATE`,
      [ctx.orgId, targetProjectId],
    );
    if (projects.length !== 1 || projects[0].purged_at) {
      throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
    }
    const { rows: defectRows } = await client.query(
      `SELECT d.* FROM defects d
        WHERE d.org_id = $1 AND d.id = $2 FOR UPDATE OF d`,
      [ctx.orgId, defectId],
    );
    if (!defectRows.length) {
      throw new NotFoundException({ code: 'DEFECT_NOT_FOUND' });
    }
    const defect = defectRows[0];
    if (defect.project_id !== targetProjectId) {
      throw new ConflictException({ code: 'DEFECT_PROJECT_MISMATCH' });
    }
    const state = String(projects[0].status);
    if (defect.defect_context === 'AFTERCARE') {
      if (state !== 'CLOSED' || !projects[0].closed_at || !defect.accepted_package_id) {
        throw new ConflictException({ code: 'AFTERCARE_MUTATION_LIFECYCLE_BLOCKED' });
      }
      // Preserve the same current accepted dossier qualification as creation.
      const { rows: latest } = await client.query(
        `SELECT id, status FROM handover_packages
          WHERE org_id = $1 AND project_id = $2
            AND package_purpose = 'FULL_HANDOVER'
          ORDER BY version_no DESC, id DESC LIMIT 1 FOR SHARE`,
        [ctx.orgId, targetProjectId],
      );
      if (latest.length !== 1 || latest[0].status !== 'ACCEPTED' ||
          latest[0].id !== defect.accepted_package_id) {
        throw new ConflictException({ code: 'AFTERCARE_ACCEPTED_PACKAGE_CHANGED' });
      }
    } else if (!['ACTIVE', 'HANDOVER'].includes(state)) {
      throw new ConflictException({
        code: 'CLOSEOUT_DEFECT_PROJECT_LIFECYCLE_BLOCKED',
        detail: 'Closeout defect mutations require an ACTIVE or HANDOVER project.',
      });
    }
    return { defect, targetProjectId };
  }

  /**
   * Resolve and lock one exact current, approved, asset-qualified document
   * version for this remedy. Two different documents sharing the same storage
   * object are ambiguous and require explicit manual evidence selection.
   */
  private async resolveRemedyVersion(
    client: PoolClient, orgId: string, projectId: string,
    objectId: string, assetId: string | null,
  ): Promise<string> {
    const { rows } = await client.query(
      `SELECT dv.id, dv.document_id
         FROM document_versions dv
         JOIN documents d
           ON d.org_id = dv.org_id AND d.project_id = dv.project_id
          AND d.id = dv.document_id
        WHERE dv.org_id = $1 AND dv.project_id = $2 AND dv.object_id = $3
          AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
          AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
          AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
          AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
          AND d.current_approved_version_id = dv.id
          AND ($4::uuid IS NULL OR EXISTS (
            SELECT 1 FROM document_assets da
             WHERE da.org_id = dv.org_id AND da.project_id = dv.project_id
               AND da.document_id = dv.document_id AND da.asset_id = $4
          ))
        ORDER BY dv.id LIMIT 2 FOR SHARE OF dv, d`,
      [orgId, projectId, objectId, assetId],
    );
    if (rows.length !== 1) {
      throw new ConflictException({
        code: 'DEFECT_REMEDY_VERSION_AMBIGUOUS_OR_INELIGIBLE',
        detail: 'Evidence requires one current approved, correctly asset-linked document version.',
      });
    }
    if (assetId) {
      // The EXISTS qualification above takes no row lock. Hold a shared lock
      // on the exact asset association until the defect write commits, so a
      // concurrent unlink cannot invalidate the evidence during submission.
      const binding = await client.query(
        `SELECT id FROM document_assets
          WHERE org_id = $1 AND project_id = $2
            AND document_id = $3 AND asset_id = $4
          FOR SHARE`,
        [orgId, projectId, rows[0].document_id, assetId],
      );
      if (!binding.rows.length) {
        throw new ConflictException({ code: 'DEFECT_REMEDY_ASSET_LINK_REVOKED' });
      }
    }
    return rows[0].id;
  }

  /**
   * WF-24 / API-180: Record OEM Warranty Event & Detect Basis Conflicts (AUD-D-03)
   * Flags a conflict if the OEM registration basis (e.g. COMMISSIONING) disagrees with
   * the asset's contracted warranty_start_basis (e.g. HANDOVER).
   */
  async recordWarrantyEvent(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      assetId: string;
      eventType: 'REGISTRATION' | 'CONFIRMATION' | 'CLAIM' | 'EXTENSION';
      oemReference: string;
      registeredAt: string;
      warrantyStart: string;
      warrantyEnd: string;
      basis: 'COMMISSIONING' | 'HANDOVER' | 'ACCEPTANCE' | 'SUPPLY';
      evidenceObjectId?: string;
      occurredAt?: string;
      occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';
      backdatingReason?: string;
    },
  ) {
    const validDay = (date: unknown): date is string =>
      typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date;
    const eventTypes = ['REGISTRATION', 'CONFIRMATION', 'CLAIM', 'EXTENSION'];
    const bases = ['COMMISSIONING', 'HANDOVER', 'ACCEPTANCE', 'SUPPLY'];
    if (!input || !eventTypes.includes(input.eventType) ||
        !bases.includes(input.basis) ||
        typeof input.assetId !== 'string' ||
        typeof input.oemReference !== 'string' ||
        !input.oemReference.trim() || input.oemReference.length > 180 ||
        !validDay(input.registeredAt) || !validDay(input.warrantyStart) ||
        !validDay(input.warrantyEnd) ||
        input.warrantyEnd < input.warrantyStart ||
        (input.occurredAt !== undefined &&
          (typeof input.occurredAt !== 'string' ||
            !Number.isFinite(Date.parse(input.occurredAt)))) ||
        (input.occurredAtPrecision !== undefined &&
          !['INSTANT', 'DATE', 'UNKNOWN'].includes(input.occurredAtPrecision)) ||
        (input.backdatingReason !== undefined &&
          (typeof input.backdatingReason !== 'string' ||
            input.backdatingReason.length > 1000))) {
      throw new UnprocessableEntityException({
        code: 'WARRANTY_EVENT_INVALID',
        detail: 'Warranty event requires valid ordered coverage dates, a basis and an OEM reference.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: assetRows } = await client.query(
        `SELECT id, tag, warranty_start_basis, warranty_start, warranty_end
           FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, input.assetId],
      );
      if (assetRows.length === 0) {
        throw new UnprocessableEntityException({ code: 'NOT_FOUND', detail: 'Asset not found.' });
      }
      const asset = assetRows[0];
      // Same-basis, contradictory dates are as important as a basis mismatch.
      // The asset's current dates are only comparison data, never automatic
      // evidence that a new OEM assertion has been independently verified.
      const storedDay = (value: unknown): string | null => {
        if (value == null) return null;
        if (value instanceof Date) {
          return Number.isFinite(value.getTime())
            ? value.toISOString().slice(0, 10) : null;
        }
        return typeof value === 'string' ? value.slice(0, 10) : null;
      };
      const storedStart = storedDay(asset.warranty_start);
      const storedEnd = storedDay(asset.warranty_end);
      const hasBasisConflict = asset.warranty_start_basis !== input.basis;
      const hasDateConflict =
        (storedStart !== null && storedStart !== input.warrantyStart) ||
        (storedEnd !== null && (
          input.eventType === 'EXTENSION'
            ? input.warrantyEnd < storedEnd
            : storedEnd !== input.warrantyEnd
        ));
      const eventStatus = hasBasisConflict || hasDateConflict ? 'DISPUTED' : 'RECORDED';
      const warrantyEventId = uuidv7();
      // Even a nonempty evidenceObjectId is only an unreviewed reference.
      // Independent OEM authority and a version-pinned, reviewed certificate
      // must be established by a separate approval workflow before any
      // authoritative coverage/extension is confirmed.
      await client.query(
        `INSERT INTO warranty_events
          (id, org_id, project_id, asset_id, event_type, status, oem_reference,
           registered_at, warranty_start, warranty_end, basis, evidence_object_id, created_by,
           occurred_at, occurred_at_precision, recorded_at, backdating_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16)`,
        [
          warrantyEventId,
          ctx.orgId, projectId, input.assetId, input.eventType, eventStatus,
          input.oemReference.trim(), input.registeredAt, input.warrantyStart,
          input.warrantyEnd, input.basis, input.evidenceObjectId ?? null,
          ctx.userId,
          input.occurredAt ? new Date(input.occurredAt) : new Date(input.registeredAt),
          input.occurredAtPrecision || 'DATE', input.backdatingReason || null,
        ],
      );
      // Intentionally no UPDATE assets: a contractor's assertion must not
      // manufacture or extend authoritative warranty coverage.
      emit({
        eventType: 'WARRANTY_EVENT_RECORDED',
        projectId,
        entityType: 'WARRANTY_EVENT',
        entityId: warrantyEventId,
        afterJson: {
          assetTag: asset.tag, status: eventStatus, hasBasisConflict, hasDateConflict,
          coverageUpdated: false, independentOemVerification: false,
        },
      });
      return {
        warrantyEventId, status: eventStatus, hasBasisConflict, hasDateConflict,
        coverageUpdated: false, requiresIndependentVerification: true,
      };
    });
  }

  /**
   * WF-25 / API-182: Submit Defect Remedy with Qualified Evidence (AUD-D-04, V07)
   */
  async submitDefectRemedy(
    ctx: TenantActorContext,
    projectId: string,
    defectId: string,
    remedyEvidenceObjectId: string,
    expectedRowVersion?: number,
  ) {
    if (!remedyEvidenceObjectId) {
      throw new UnprocessableEntityException({
        code: 'REMEDY_EVIDENCE_REQUIRED',
        detail: 'Submitting a defect remedy requires uploading remedy evidence (WF-25).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { defect, targetProjectId } = await this.lockDefectForMutation(
        client, ctx, projectId, defectId,
      );

      if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
        const grant = await this.supplierDefectGrant(client, ctx, targetProjectId);
        if (defect.assigned_party_id !== grant.partyId ||
            (grant.assetIds !== null &&
              (!defect.asset_id || !grant.assetIds.includes(defect.asset_id)))) {
          throw new ForbiddenException({ code: 'DEFECT_NOT_ASSIGNED_TO_SUPPLIER' });
        }
      }
      if (ctx.actorType !== 'GUEST' && !ctx.guestGrantId) {
        await this.assertMemberDefectScope(client, ctx, defect, true);
        if (ctx.actorType === 'MEMBER' &&
            defect.assigned_user_id && defect.assigned_user_id !== ctx.userId) {
          throw new ForbiddenException({ code: 'DEFECT_NOT_ASSIGNED_TO_MEMBER' });
        }
      }

      if (!['OPEN', 'IN_PROGRESS'].includes(defect.status)) {
        throw new ConflictException({
          code: 'DEFECT_REMEDY_TRANSITION_NOT_ALLOWED',
          detail: 'A submitted remedy is immutable. A rejected remedy requires an audited resubmission transition.',
        });
      }

      if (expectedRowVersion === undefined || expectedRowVersion === null) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: 'expectedRowVersion is mandatory for defect remedy submission.',
        });
      }

      if (defect.row_version !== expectedRowVersion) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: `Defect row version mismatch (expected ${expectedRowVersion}, current ${defect.row_version}).`,
        });
      }

      // 2. Validate remedy evidence exists, is in READY status, and is positively project/asset-qualified
      const { rows: soRows } = await client.query(
        `SELECT so.id, so.status, so.sha256,
                so.provider_version_id, so.size_bytes, so.observed_size_bytes,
                EXISTS (
                  SELECT 1
                    FROM document_versions dv
                    JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id
                                    AND d.id = dv.document_id
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2
                     AND dv.object_id = so.id
                     AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                     AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                     AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                     AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
                     AND d.current_approved_version_id = dv.id
                ) AS linked_in_project,
                EXISTS (
                  SELECT 1
                    FROM document_versions dv
                    JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id
                                    AND d.id = dv.document_id
                    JOIN document_assets da ON da.org_id = d.org_id AND da.project_id = d.project_id
                                           AND da.document_id = d.id
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2
                     AND dv.object_id = so.id AND da.asset_id = $4
                     AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                     AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                     AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                     AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
                     AND d.current_approved_version_id = dv.id
                ) AS linked_to_defect_asset
           FROM storage_objects so
          WHERE so.org_id = $1 AND so.id = $3
          FOR SHARE OF so`,
        [ctx.orgId, targetProjectId, remedyEvidenceObjectId, defect.asset_id || null],
      );

      if (!soRows.length || soRows[0].status !== 'READY') {
        throw new NotFoundException({
          code: 'CLOSURE_EVIDENCE_NOT_FOUND_OR_NOT_READY',
          detail: 'Remedy evidence object must exist and be verified in READY status.',
        });
      }

      const so = soRows[0];
      if (!isImmutableStorageVersion(so.provider_version_id) ||
          !/^[a-f0-9]{64}$/i.test(String(so.sha256 || '')) ||
          !Number.isSafeInteger(Number(so.size_bytes)) || Number(so.size_bytes) <= 0 ||
          Number(so.observed_size_bytes) !== Number(so.size_bytes)) {
        throw new UnprocessableEntityException({
          code: 'DEFECT_EVIDENCE_NOT_VERIFIED',
          detail: 'Remedy and closure evidence must reference immutable, size-checked and SHA-256 verified bytes.',
        });
      }
      // Storage-key text is routing metadata, never authority. A current,
      // reviewed document version must link this object to the exact project,
      // and asset-bound defects additionally need an exact document_assets link.
      if (so.linked_in_project !== true) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_PROJECT_MISMATCH',
          detail: 'Evidence needs a current approved document version in this project.',
        });
      }
      if (defect.asset_id && so.linked_to_defect_asset !== true) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_ASSET_MISMATCH',
          detail: 'Evidence must explicitly link the exact defect asset.',
        });
      }

      const remedyVersionId = await this.resolveRemedyVersion(
        client, ctx.orgId, targetProjectId, remedyEvidenceObjectId, defect.asset_id || null,
      );
      const updateRes = await client.query(
        `UPDATE defects
            SET status = 'RECTIFIED',
                closure_evidence_object_id = $4,
                remedy_document_version_id = $7,
                remedied_by = $5,
                remedied_at = now(),
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $6`,
        [ctx.orgId, targetProjectId, defectId, remedyEvidenceObjectId, ctx.userId, defect.row_version, remedyVersionId],
      );

      if (updateRes.rowCount === 0) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: `Defect ${defectId} concurrency check failed during commit.`,
        });
      }

      emit({
        eventType: 'DEFECT_REMEDY_SUBMITTED',
        projectId: targetProjectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: { status: 'RECTIFIED', remedyEvidenceObjectId, remedyVersionId, remediedBy: ctx.userId },
      });

      return { defectId, status: 'RECTIFIED', rowVersion: defect.row_version + 1 };
    });
  }

  /**
   * WF-25 / API-183: Close Defect / Snag Item with Mandatory Closure Evidence and Independent Verification (AUD-D-04, V07)
   */
  async closeDefect(
    ctx: TenantActorContext,
    projectId: string,
    defectId: string,
    closureEvidenceObjectId: string,
    expectedRowVersion?: number,
  ) {
    // External supplier contributors cannot certify their own repairs.
    // Qualified independent verifier authority is a distinct workflow.
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new ForbiddenException({ code: 'DEFECT_INDEPENDENT_VERIFIER_REQUIRED' });
    }
    if (!closureEvidenceObjectId) {
      throw new UnprocessableEntityException({
        code: 'CLOSURE_EVIDENCE_REQUIRED',
        detail: 'Closing a defect requires uploading closure evidence (WF-25).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { defect, targetProjectId } = await this.lockDefectForMutation(
        client, ctx, projectId, defectId,
      );
      await this.assertMemberDefectScope(client, ctx, defect, true);
      if (ctx.actorType === 'MEMBER') {
        const orgRole = (ctx as TenantActorContext & {orgRole?:string}).orgRole;
        if (!['R-OWNER', 'R-ADMIN'].includes(orgRole || '') &&
            !['R-QC', 'R-PM'].includes(ctx.projectRole || '')) {
          throw new ForbiddenException({ code: 'DEFECT_VERIFIER_ROLE_REQUIRED' });
        }
      }

      if (defect.status === 'CLOSED') {
        throw new ConflictException({
          code: 'DEFECT_ALREADY_CLOSED',
          detail: `Defect ${defectId} not found in project or is already closed.`,
        });
      }

      // 2. Concurrency check (mandatory expected version per F07)
      if (expectedRowVersion === undefined || expectedRowVersion === null) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: 'expectedRowVersion is mandatory for defect closure.',
        });
      }

      if (defect.row_version !== expectedRowVersion) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: `Defect row version mismatch (expected ${expectedRowVersion}, current ${defect.row_version}).`,
        });
      }

      // 3. Predecessor status check: defect must be in RECTIFIED status before it can be closed (WF-25 / F07)
      if (defect.status !== 'RECTIFIED') {
        throw new ConflictException({
          code: 'DEFECT_NOT_RECTIFIED',
          detail: `Defect ${defectId} cannot be closed directly from status ${defect.status}; it must be in RECTIFIED status.`,
        });
      }

      // 4. Verifier independence: neither defect assignee nor remedy performer can self-verify and close
      if (defect.assigned_user_id && ctx.userId === defect.assigned_user_id) {
        throw new ForbiddenException({
          code: 'INDEPENDENT_VERIFICATION_REQUIRED',
          detail: 'Defect assignee cannot verify and close their own defect; an independent verifier is required.',
        });
      }
      if (defect.remedied_by && ctx.userId === defect.remedied_by) {
        throw new ForbiddenException({
          code: 'INDEPENDENT_VERIFICATION_REQUIRED',
          detail: 'The user who submitted the defect remedy cannot verify and close the defect; an independent verifier is required.',
        });
      }

      // 5. Validate closure evidence: must match verified remedy evidence, exist, belong to tenant, be READY, and match asset (Gap 5)
      if (defect.closure_evidence_object_id && closureEvidenceObjectId !== defect.closure_evidence_object_id) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_MISMATCH',
          detail: 'Closure evidence must match the verified remedy evidence submitted for this defect; different unreviewed evidence cannot close it.',
        });
      }

      const { rows: soRows } = await client.query(
        `SELECT so.id, so.status, so.sha256,
                so.provider_version_id, so.size_bytes, so.observed_size_bytes,
                EXISTS (
                  SELECT 1
                    FROM document_versions dv
                    JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id
                                    AND d.id = dv.document_id
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2
                     AND dv.object_id = so.id
                     AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                     AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                     AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                     AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
                     AND d.current_approved_version_id = dv.id
                ) AS linked_in_project,
                EXISTS (
                  SELECT 1
                    FROM document_versions dv
                    JOIN documents d ON d.org_id = dv.org_id AND d.project_id = dv.project_id
                                    AND d.id = dv.document_id
                    JOIN document_assets da ON da.org_id = d.org_id AND da.project_id = d.project_id
                                           AND da.document_id = d.id
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2
                     AND dv.object_id = so.id AND da.asset_id = $4
                     AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                     AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                     AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                     AND d.deleted_at IS NULL AND d.status = 'ACTIVE'
                     AND d.current_approved_version_id = dv.id
                ) AS linked_to_defect_asset
           FROM storage_objects so
          WHERE so.org_id = $1 AND so.id = $3
          FOR SHARE OF so`,
        [ctx.orgId, targetProjectId, closureEvidenceObjectId, defect.asset_id || null],
      );

      if (!soRows.length || soRows[0].status !== 'READY') {
        throw new NotFoundException({
          code: 'CLOSURE_EVIDENCE_NOT_FOUND_OR_NOT_READY',
          detail: 'Closure evidence object must exist and be verified in READY status.',
        });
      }

      const so = soRows[0];
      if (!isImmutableStorageVersion(so.provider_version_id) ||
          !/^[a-f0-9]{64}$/i.test(String(so.sha256 || '')) ||
          !Number.isSafeInteger(Number(so.size_bytes)) || Number(so.size_bytes) <= 0 ||
          Number(so.observed_size_bytes) !== Number(so.size_bytes)) {
        throw new UnprocessableEntityException({
          code: 'DEFECT_EVIDENCE_NOT_VERIFIED',
          detail: 'Remedy and closure evidence must reference immutable, size-checked and SHA-256 verified bytes.',
        });
      }
      // Storage-key text is routing metadata, never authority. A current,
      // reviewed document version must link this object to the exact project,
      // and asset-bound defects additionally need an exact document_assets link.
      if (so.linked_in_project !== true) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_PROJECT_MISMATCH',
          detail: 'Evidence needs a current approved document version in this project.',
        });
      }
      if (defect.asset_id && so.linked_to_defect_asset !== true) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_ASSET_MISMATCH',
          detail: 'Evidence must explicitly link the exact defect asset.',
        });
      }

      if (!defect.remedy_document_version_id) {
        throw new ConflictException({
          code: 'DEFECT_LEGACY_REMEDY_VERSION_UNPINNED',
          detail: 'Legacy remedy must be independently requalified before closure.',
        });
      }
      const currentRemedyVersionId = await this.resolveRemedyVersion(
        client, ctx.orgId, targetProjectId, closureEvidenceObjectId, defect.asset_id || null,
      );
      if (currentRemedyVersionId !== defect.remedy_document_version_id) {
        throw new ConflictException({
          code: 'DEFECT_REMEDY_VERSION_CHANGED',
          detail: 'The document version originally reviewed for the remedy is no longer current.',
        });
      }
      const updateRes = await client.query(
        `UPDATE defects
            SET status = 'CLOSED',
                closure_evidence_object_id = $4,
                closed_at = now(),
                closed_by = $5,
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $6`,
        [ctx.orgId, targetProjectId, defectId, closureEvidenceObjectId, ctx.userId, defect.row_version],
      );

      if (updateRes.rowCount === 0) {
        throw new ConflictException({
          code: 'DEFECT_CONCURRENCY_CONFLICT',
          detail: `Defect ${defectId} concurrency check failed during commit.`,
        });
      }

      emit({
        eventType: 'DEFECT_CLOSED',
        projectId: targetProjectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: { status: 'CLOSED', closureEvidenceObjectId },
      });

      return { defectId, status: 'CLOSED', rowVersion: defect.row_version + 1 };
    });
  }

  async listWarrantyEvents(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT we.*, a.tag AS asset_tag, a.name AS asset_name
           FROM warranty_events we
           LEFT JOIN assets a ON a.id = we.asset_id
          WHERE we.org_id = $1 AND we.project_id = $2
          ORDER BY we.created_at DESC`,
        [ctx.orgId, projectId],
      );
      return rows;
    });
  }

  async listDefects(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const guest = ctx.actorType === 'GUEST' || !!ctx.guestGrantId;
      const grant = guest ? await this.supplierDefectGrant(client, ctx, projectId) : null;
      const { rows } = await client.query(
        `SELECT d.*, a.tag AS asset_tag, u.name AS raised_by_name
           FROM defects d
           LEFT JOIN assets a ON a.org_id = d.org_id AND a.project_id = d.project_id AND a.id = d.asset_id
           LEFT JOIN users u ON u.id = d.raised_by
          WHERE d.org_id = $1 AND d.project_id = $2
            AND ($3::uuid IS NULL OR d.assigned_party_id = $3)
            AND ($4::uuid[] IS NULL OR d.asset_id = ANY($4::uuid[]))
          ORDER BY d.raised_at DESC`,
        [ctx.orgId, projectId, grant?.partyId ?? null, grant?.assetIds ?? null],
      );
      return rows;
    });
  }

  async createDefect(
    ctx: TenantActorContext,
    projectId: string,
    input: {
      title: string;
      description?: string;
      assetId?: string;
      severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'MINOR' | 'MAJOR';
      location?: string;
      occurredAt?: string;
      occurredAtPrecision?: 'INSTANT' | 'DATE' | 'UNKNOWN';
      backdatingReason?: string;
      caseType?: 'CLOSEOUT' | 'AFTERCARE';
      postHandoverReason?: string;
      aftercareReference?: string;
    },
  ) {
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) {
      throw new ForbiddenException({ code: 'DEFECT_CREATION_REQUIRES_INTERNAL_TRIAGE' });
    }
    if (!input || typeof input.title !== 'string' ||
        input.title.trim().length < 1 || input.title.trim().length > 255 ||
        (input.description !== undefined &&
          (typeof input.description !== 'string' || input.description.length > 8000)) ||
        (input.location !== undefined &&
          (typeof input.location !== 'string' || input.location.length > 500))) {
      throw new UnprocessableEntityException({
        code: 'DEFECT_INPUT_INVALID',
        detail: 'Defect requires a nonempty title and bounded text fields.',
      });
    }
    const knownSeverities = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'MINOR', 'MAJOR']);
    if (input.severity !== undefined &&
        (typeof input.severity !== 'string' || !knownSeverities.has(input.severity))) {
      throw new UnprocessableEntityException({
        code: 'DEFECT_SEVERITY_UNSUPPORTED',
        detail: 'Use LOW, MEDIUM, HIGH or CRITICAL; MINOR and MAJOR are supported legacy aliases.',
      });
    }
    if (input.occurredAtPrecision !== undefined &&
        !['INSTANT', 'DATE', 'UNKNOWN'].includes(input.occurredAtPrecision)) {
      throw new UnprocessableEntityException({ code: 'DEFECT_OCCURRENCE_PRECISION_INVALID' });
    }
    if (input.occurredAt !== undefined &&
        (typeof input.occurredAt !== 'string' || !Number.isFinite(Date.parse(input.occurredAt)))) {
      throw new UnprocessableEntityException({ code: 'DEFECT_OCCURRENCE_DATE_INVALID' });
    }
    if (input.caseType !== undefined &&
        !['CLOSEOUT', 'AFTERCARE'].includes(input.caseType)) {
      throw new UnprocessableEntityException({ code: 'DEFECT_CONTEXT_INVALID' });
    }
    const caseType = input.caseType ?? 'CLOSEOUT';
    const aftercareReason = typeof input.postHandoverReason === 'string'
      ? input.postHandoverReason.trim() : null;
    const aftercareReference = typeof input.aftercareReference === 'string'
      ? input.aftercareReference.trim() : null;
    if (caseType === 'AFTERCARE' &&
        (!input.assetId || !aftercareReason ||
          aftercareReason.length < 10 || aftercareReason.length > 1200 ||
          !aftercareReference || aftercareReference.length > 180)) {
      throw new UnprocessableEntityException({
        code: 'AFTERCARE_CONTEXT_REQUIRED',
        detail: 'Post-close aftercare requires an asset, incident reason and traceable case reference.',
      });
    }
    if (caseType === 'CLOSEOUT' &&
        (input.postHandoverReason !== undefined || input.aftercareReference !== undefined)) {
      throw new UnprocessableEntityException({ code: 'AFTERCARE_CONTEXT_MISMATCH' });
    }
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // The same project row lock is held by project closure. It makes defect
      // creation and acceptance transitions deterministic, even across workers.
      const { rows: projects } = await client.query(
        `SELECT id, status, closed_at, purged_at
           FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projects.length || projects[0].purged_at) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND' });
      }
      const status = String(projects[0].status);
      const isAftercare = caseType === 'AFTERCARE';
      if (isAftercare ? status !== 'CLOSED' : !['ACTIVE', 'HANDOVER'].includes(status)) {
        throw new ConflictException({
          code: 'DEFECT_PROJECT_LIFECYCLE_BLOCKED',
          detail: isAftercare
            ? 'Aftercare reports require an accepted, CLOSED project.'
            : 'Closeout defects require an ACTIVE or HANDOVER project; use explicit aftercare for closed work.',
        });
      }
      let acceptedPackageId: string | null = null;
      if (isAftercare) {
        if (!projects[0].closed_at) {
          throw new ConflictException({ code: 'AFTERCARE_MISSING_CLOSURE_ANCHOR' });
        }
        const { rows: assets } = await client.query(
          `SELECT id FROM assets
            WHERE org_id = $1 AND project_id = $2 AND id = $3 FOR SHARE`,
          [ctx.orgId, projectId, input.assetId],
        );
        if (!assets.length) {
          throw new UnprocessableEntityException({ code: 'AFTERCARE_ASSET_NOT_FOUND' });
        }
        // Require the newest full dossier itself to be ACCEPTED. Selecting any
        // older accepted package could attach a new case to stale acceptance.
        const { rows: dossiers } = await client.query(
          `SELECT id, status FROM handover_packages
            WHERE org_id = $1 AND project_id = $2
              AND package_purpose = 'FULL_HANDOVER'
            ORDER BY version_no DESC, id DESC LIMIT 1 FOR SHARE`,
          [ctx.orgId, projectId],
        );
        if (dossiers.length !== 1 || dossiers[0].status !== 'ACCEPTED') {
          throw new ConflictException({ code: 'AFTERCARE_CURRENT_DOSSIER_NOT_ACCEPTED' });
        }
        acceptedPackageId = dossiers[0].id;
      }
      const defectId = uuidv7();
      const severityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
        LOW: 'LOW',
        MINOR: 'LOW',
        MEDIUM: 'MEDIUM',
        MAJOR: 'HIGH',
        HIGH: 'HIGH',
        CRITICAL: 'CRITICAL',
      };
      const severity = input.severity === undefined ? 'MEDIUM' : severityMap[input.severity];
      const description = input.location
        ? `${input.description || input.title} (Location: ${input.location})`
        : (input.description || input.title);

      await client.query(
        `INSERT INTO defects
           (id, org_id, project_id, asset_id, title, description, severity, status, raised_by, raised_at,
            occurred_at, occurred_at_precision, recorded_at, backdating_reason,
            defect_context, accepted_package_id, aftercare_reason, aftercare_reference, mandatory)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, now(), $9, $10, now(), $11,
                 $12, $13, $14, $15, $16)`,
        [
          defectId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.title.trim(),
          description,
          severity,
          ctx.userId,
          input.occurredAt ? new Date(input.occurredAt) : new Date(),
          input.occurredAtPrecision || 'INSTANT',
          input.backdatingReason || null,
          caseType,
          acceptedPackageId,
          aftercareReason,
          aftercareReference,
          !isAftercare,
        ],
      );

      emit({
        eventType: isAftercare ? 'AFTERCARE_DEFECT_REPORTED' : 'DEFECT_RAISED',
        projectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: {
          title: input.title.trim(), severity,
          caseType, mandatory: !isAftercare, acceptedPackageId,
        },
      });

      return { defectId, status: 'OPEN', severity,
        caseType, mandatory: !isAftercare, acceptedPackageId };
    });
  }

  async getSubscription(ctx: TenantActorContext) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT s.*, p.name AS plan_name, p.code AS plan_tier, p.limits_json, p.price_paise, p.interval
           FROM subscriptions s
           JOIN plans p ON p.id = s.plan_id
          WHERE s.org_id = $1
          ORDER BY s.updated_at DESC LIMIT 1`,
        [ctx.orgId],
      );
      if (!rows.length) {
        return {
          id: null,
          planName: 'No Subscription',
          planTier: 'NONE',
          status: 'INACTIVE',
          seatLimit: 0,
          storageQuotaBytes: 0,
          pricePaise: 0,
          limitsJson: { maxActiveProjects: 0, maxSeats: 0, maxStorageBytes: 0 },
          plan_name: 'No Subscription',
          plan_tier: 'NONE',
          seat_limit: 0,
          storage_quota_bytes: 0,
          price_paise: 0,
        };
      }
      const sub = rows[0];
      const limits = sub.limits_json || {};
      const seatLimit = Number(limits.maxSeats ?? 20);
      const storageQuotaBytes = Number(limits.maxStorageBytes ?? (100 * 1024 * 1024 * 1024));
      const maxActiveProjects = Number(limits.maxActiveProjects ?? 15);
      return {
        id: sub.id,
        orgId: sub.org_id,
        planId: sub.plan_id,
        status: sub.status,
        provider: sub.provider,
        providerRef: sub.provider_ref,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        cancelAt: sub.cancel_at,
        rowVersion: sub.row_version,
        updatedAt: sub.updated_at,
        planName: sub.plan_name,
        planTier: sub.plan_tier,
        pricePaise: Number(sub.price_paise),
        interval: sub.interval,
        limitsJson: limits,
        seatLimit,
        storageQuotaBytes,
        maxActiveProjects,
        plan_name: sub.plan_name,
        plan_tier: sub.plan_tier,
        price_paise: Number(sub.price_paise),
        seat_limit: seatLimit,
        storage_quota_bytes: storageQuotaBytes,
      };
    });
  }

  /**
   * Legacy payment-settlement implementation is intentionally retired.
   * It used untrusted webhook notes as the tenant selector, and could modify
   * entitlements without independently reconciled provider references.
   *
   * Verified events are now *only* accepted by BillingService's durable
   * read-only receipt. Do not resurrect automatic fulfillment here.
   */
  async processRazorpayWebhook(rawBody: string, signatureHeader: string) {
    void rawBody;
    void signatureHeader;
    throw new ServiceUnavailableException({
      code: 'AUTOMATED_PAYMENT_FULFILLMENT_DISABLED',
      detail: 'Subscription changes require independent provider reconciliation and explicit enablement.',
    });
  }

  /**
   * FR-BIL-011 / BR-BIL-14: Record Customer TDS Deduction Against an Invoice
   */
  async recordInvoiceTdsDeduction(
    ctx: TenantActorContext,
    input: {
      invoiceId: string;
      section: string; // e.g., '194J' or '194C'
      rateBps: number;
      amountPaise: bigint;
      certificateReference?: string;
      deductedAt: string;
    },
  ) {
    if (!input || typeof input.invoiceId !== 'string' ||
        typeof input.section !== 'string' ||
        !/^[0-9A-Z_]{3,30}$/.test(input.section.trim().toUpperCase()) ||
        !Number.isInteger(input.rateBps) || input.rateBps < 1 || input.rateBps > 10000 ||
        typeof input.amountPaise !== 'bigint' || input.amountPaise <= 0n ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.deductedAt) ||
        Number.isNaN(Date.parse(input.deductedAt)) ||
        new Date(input.deductedAt).toISOString().slice(0, 10) !== input.deductedAt) {
      throw new UnprocessableEntityException({
        code: 'TDS_INPUT_INVALID',
        detail: 'TDS requires a positive integer amount, bounded rate, section and valid deduction date.',
      });
    }
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // The invoice lock serializes cumulative deductions from both billing
      // service entrypoints so no concurrent request can over-deduct it.
      const { rows: invoices } = await client.query(
        `SELECT total_paise, status FROM invoices
          WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, input.invoiceId],
      );
      if (!invoices.length) {
        throw new NotFoundException({ code: 'INVOICE_NOT_FOUND' });
      }
      if (['VOID', 'CANCELLED', 'REFUNDED'].includes(invoices[0].status)) {
        throw new ConflictException({ code: 'INVOICE_TDS_INVALID_STATE' });
      }
      const invoiceTotal = BigInt(invoices[0].total_paise);
      const { rows: deductionRows } = await client.query(
        `SELECT COALESCE(SUM(amount_paise), 0)::text AS deducted_paise
           FROM invoice_tds WHERE org_id = $1 AND invoice_id = $2`,
        [ctx.orgId, input.invoiceId],
      );
      const consumed = BigInt(deductionRows[0]?.deducted_paise ?? 0);
      if (invoiceTotal <= 0n || consumed + input.amountPaise > invoiceTotal) {
        throw new UnprocessableEntityException({
          code: 'TDS_EXCEEDS_INVOICE_BALANCE',
          detail: 'Cumulative deductions cannot exceed the issued invoice total.',
        });
      }
      const tdsId = uuidv7();
      await client.query(
        `INSERT INTO invoice_tds
          (id, org_id, invoice_id, section, rate_bps, amount_paise, certificate_reference, deducted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tdsId,
          ctx.orgId,
          input.invoiceId,
          input.section.trim().toUpperCase(),
          input.rateBps,
          input.amountPaise.toString(),
          input.certificateReference ?? null,
          input.deductedAt,
        ],
      );

      emit({
        eventType: 'INVOICE_TDS_RECORDED',
        entityType: 'INVOICE',
        entityId: input.invoiceId,
        afterJson: {
          tdsId,
          section: input.section,
          rateBps: input.rateBps,
          amountPaise: input.amountPaise.toString(),
        },
      });

      return { tdsId, invoiceId: input.invoiceId };
    });
  }

  /**
   * API-185 GET /projects/:projectId/commercial-readiness (TC2-034)
   * Evaluates project commercial closeout gates: contract retention at risk,
   * mandatory requirement completion, defect resolution, and accepted handover submission.
   */
  async getCommercialReadiness(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client) => {
      const { rows: projRows } = await client.query(
        `SELECT p.id, p.name, p.code, p.status, p.contract_value_paise, p.retention_bps,
                p.target_handover_date
           FROM projects p
          WHERE p.org_id = $1 AND p.id = $2`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) {
        throw new NotFoundException({ code: 'PROJECT_NOT_FOUND', detail: 'Project not found.' });
      }
      const project = projRows[0];

      const { rows: reqRows } = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE r.mandatory = true) AS total_mandatory,
            COUNT(*) FILTER (WHERE r.mandatory = true AND (
              EXISTS (
                SELECT 1 FROM waivers w
                 WHERE w.org_id = r.org_id AND w.project_id = r.project_id
                   AND w.requirement_id = r.id AND w.status = 'ACTIVE'
                   AND w.type IN ('WAIVE', 'NOT_APPLICABLE')
                   AND w.second_approved_by IS NOT NULL
                   AND w.second_approved_by <> w.approved_by
              ) OR EXISTS (
                SELECT 1
                  FROM document_requirements dr
                  JOIN documents d
                    ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
                   AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
                  JOIN document_versions dv
                    ON dv.org_id = d.org_id AND dv.project_id = d.project_id
                   AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
                   AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                   AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                   AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                  JOIN storage_objects so
                    ON so.org_id = dv.org_id AND so.id = dv.object_id
                   AND so.status = 'READY' AND so.sha256 IS NOT NULL
                   AND so.observed_size_bytes = so.size_bytes
                   AND so.provider_version_id IS NOT NULL
                 WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id
                   AND dr.requirement_id = r.id
                   AND NOT EXISTS (
                     SELECT 1 FROM evidence_revalidations er
                      WHERE er.org_id = dv.org_id AND er.project_id = dv.project_id
                        AND er.document_version_id = dv.id
                        AND (r.scope_key IS NULL OR r.scope_key NOT LIKE 'asset:%' OR er.asset_id::text = substring(r.scope_key from 7))
                        AND er.status IN ('PENDING', 'MISMATCH')
                   )
              )
            )) AS satisfied_mandatory,
            COUNT(*) FILTER (WHERE r.mandatory = true AND NOT (
              EXISTS (
                SELECT 1 FROM waivers w
                 WHERE w.org_id = r.org_id AND w.project_id = r.project_id
                   AND w.requirement_id = r.id AND w.status = 'ACTIVE'
                   AND w.type IN ('WAIVE', 'NOT_APPLICABLE')
                   AND w.second_approved_by IS NOT NULL
                   AND w.second_approved_by <> w.approved_by
              ) OR EXISTS (
                SELECT 1
                  FROM document_requirements dr
                  JOIN documents d
                    ON d.org_id = dr.org_id AND d.project_id = dr.project_id AND d.id = dr.document_id
                   AND d.status = 'ACTIVE' AND d.deleted_at IS NULL
                  JOIN document_versions dv
                    ON dv.org_id = d.org_id AND dv.project_id = d.project_id
                   AND dv.document_id = d.id AND dv.id = d.current_approved_version_id
                   AND dv.file_status = 'READY' AND dv.review_status = 'APPROVED'
                   AND dv.deleted_at IS NULL AND dv.superseded_at IS NULL
                   AND (dv.expiry_date IS NULL OR dv.expiry_date >= CURRENT_DATE)
                  JOIN storage_objects so
                    ON so.org_id = dv.org_id AND so.id = dv.object_id
                   AND so.status = 'READY' AND so.sha256 IS NOT NULL
                   AND so.observed_size_bytes = so.size_bytes
                   AND so.provider_version_id IS NOT NULL
                 WHERE dr.org_id = r.org_id AND dr.project_id = r.project_id
                   AND dr.requirement_id = r.id
                   AND NOT EXISTS (
                     SELECT 1 FROM evidence_revalidations er
                      WHERE er.org_id = dv.org_id AND er.project_id = dv.project_id
                        AND er.document_version_id = dv.id
                        AND (r.scope_key IS NULL OR r.scope_key NOT LIKE 'asset:%' OR er.asset_id::text = substring(r.scope_key from 7))
                        AND er.status IN ('PENDING', 'MISMATCH')
                   )
              )
            )) AS pending_mandatory
           FROM requirements r
          WHERE r.org_id = $1 AND r.project_id = $2 AND r.superseded_at IS NULL`,
        [ctx.orgId, projectId],
      );
      const reqStats = reqRows[0] || {};
      const totalMandatory = Number(reqStats.total_mandatory || 0);
      const satisfiedMandatory = Number(reqStats.satisfied_mandatory || 0);
      const pendingMandatory = Number(reqStats.pending_mandatory || 0);

      const { rows: defectRows } = await client.query(
        `SELECT
            COUNT(*) FILTER (WHERE status <> 'CLOSED' AND status <> 'WAIVED') AS open_defects,
            COUNT(*) FILTER (WHERE defect_context = 'CLOSEOUT' AND status <> 'CLOSED' AND status <> 'WAIVED') AS open_closeout_defects,
            COUNT(*) FILTER (WHERE defect_context = 'AFTERCARE' AND status <> 'CLOSED' AND status <> 'WAIVED') AS open_aftercare_defects,
            COUNT(*) FILTER (WHERE mandatory = true AND status <> 'CLOSED' AND status <> 'WAIVED' AND severity IN ('HIGH', 'CRITICAL')) AS critical_defects
           FROM defects
          WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const defectStats = defectRows[0] || {};
      const openDefects = Number(defectStats.open_defects || 0);
      const openCloseoutDefects = Number(defectStats.open_closeout_defects || 0);
      const openAftercareDefects = Number(defectStats.open_aftercare_defects || 0);
      const criticalDefects = Number(defectStats.critical_defects || 0);
      // Commercial estimates cannot bypass the canonical live closeout check.
      // An empty or missing checklist baseline is UNKNOWN, not 100% complete.
      const canonical = await evaluateReadinessInTransaction(client, ctx.orgId, projectId);

      const { rows: subRows } = await client.query(
        `SELECT s.id, s.status, s.package_id, s.created_at
           FROM submissions s
           JOIN handover_packages hp
             ON hp.org_id = s.org_id AND hp.project_id = s.project_id AND hp.id = s.package_id
          WHERE s.org_id = $1 AND s.project_id = $2 AND s.status = 'ACCEPTED'
            AND hp.package_purpose = 'FULL_HANDOVER'
            AND hp.status = 'ACCEPTED'
            AND hp.manifest_format_version = 2
            AND hp.pdf_object_id IS NOT NULL
            AND hp.id = (
              SELECT newest.id FROM handover_packages newest
               WHERE newest.org_id = hp.org_id AND newest.project_id = hp.project_id
                 AND newest.package_purpose = 'FULL_HANDOVER'
               ORDER BY newest.version_no DESC, newest.id DESC LIMIT 1
            )
            AND EXISTS (
              SELECT 1 FROM submission_recipients sr
               WHERE sr.org_id = s.org_id AND sr.project_id = s.project_id
                 AND sr.submission_id = s.id AND sr.is_required_approver = true
                 AND sr.decision = 'ACCEPT' AND sr.status = 'ACCEPTED'
            )
            AND NOT EXISTS (
              SELECT 1 FROM submission_recipients sr
               WHERE sr.org_id = s.org_id AND sr.project_id = s.project_id
                 AND sr.submission_id = s.id AND sr.is_required_approver = true
                 AND (sr.decision IS DISTINCT FROM 'ACCEPT' OR sr.status <> 'ACCEPTED')
            )
          ORDER BY s.decided_at DESC NULLS LAST, s.id DESC LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const hasAcceptedHandover = subRows.length > 0;

      const advisoryPreconditionsMet =
        canonical.readyWithoutOverride &&
        pendingMandatory === 0 &&
        criticalDefects === 0 &&
        hasAcceptedHandover &&
        !['SUSPENDED', 'CANCELLED', 'ARCHIVED'].includes(project.status);
      // Project-level amounts are informational inputs, not an authenticated
      // contract ledger or finance-approved payment/retention release.
      // Never invent a 5% retention rate or zero contract value on missing data.
      const hasExplicitFinanceInputs =
        project.contract_value_paise != null && project.retention_bps != null;
      const calculatedRetentionPaise = hasExplicitFinanceInputs
        ? ((BigInt(project.contract_value_paise) * BigInt(project.retention_bps)) / 10000n).toString()
        : null;

      return {
        projectId,
        projectStatus: project.status,
        contractValuePaise: project.contract_value_paise ?? null,
        retentionAtRiskPaise: calculatedRetentionPaise,
        mandatoryRequirements: {
          total: totalMandatory,
          satisfied: satisfiedMandatory,
          pending: pendingMandatory,
          satisfactionPercentage: canonical.configurationBlocker === null && totalMandatory > 0
            ? Math.round((satisfiedMandatory / totalMandatory) * 100) : null,
        },
        defects: {
          open: openDefects,
          closeoutOpen: openCloseoutDefects,
          aftercareOpen: openAftercareDefects,
          critical: criticalDefects,
        },
        handover: {
          hasAcceptedSubmission: hasAcceptedHandover,
          acceptedSubmissionId: subRows[0]?.id || null,
        },
        commercialReadiness: {
          // Deliberately never assert release authority from a checklist or
          // historic ACCEPTED status. Finance approval is a separate workflow.
          isRetentionEligible: false,
          advisoryPreconditionsMet,
          releaseStatus: 'INFORMATIONAL_ONLY',
          financeApprovalVerified: false,
          contractualAmountVerified: false,
          informationOnly: true,
          configurationBlocker: canonical.configurationBlocker,
          blockingReasons: [
            ...(canonical.configurationBlocker ? ['Current mandatory checklist baseline is not configured'] : []),
            ...(pendingMandatory > 0 ? [`${pendingMandatory} mandatory checklist requirements unsatisfied`] : []),
            ...(criticalDefects > 0 ? [`${criticalDefects} high/critical defects unresolved`] : []),
            ...(!hasAcceptedHandover ? ['Latest full-handover package with all required recipient decisions is not accepted'] : []),
            'Independent contract reconciliation and finance approval required before release',
          ],
        },
      };
    });
  }
}
