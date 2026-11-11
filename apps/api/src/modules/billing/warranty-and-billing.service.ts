import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { withTenantTransaction, TenantActorContext } from '@tradecloseout/db/tenant-tx';

@Injectable()
export class WarrantyAndBillingService {
  constructor(private readonly pool: Pool) {}

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
    if (new Date(input.warrantyEnd) < new Date(input.warrantyStart)) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        detail: 'warrantyEnd must be on or after warrantyStart (WF-24).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const { rows: assetRows } = await client.query(
        `SELECT id, tag, warranty_start_basis, warranty_start
           FROM assets
          WHERE org_id = $1 AND project_id = $2 AND id = $3
          FOR UPDATE`,
        [ctx.orgId, projectId, input.assetId],
      );
      if (assetRows.length === 0) {
        throw new UnprocessableEntityException({ code: 'NOT_FOUND', detail: 'Asset not found.' });
      }
      const asset = assetRows[0];

      // Detect basis mismatch between OEM certificate and contract (WF-24 Step 3)
      const hasBasisConflict = asset.warranty_start_basis !== input.basis;
      const eventStatus = hasBasisConflict ? 'DISPUTED' : 'CONFIRMED';
      const warrantyEventId = uuidv7();

      await client.query(
        `INSERT INTO warranty_events
          (id, org_id, project_id, asset_id, event_type, status, oem_reference,
           registered_at, warranty_start, warranty_end, basis, evidence_object_id, created_by,
           occurred_at, occurred_at_precision, recorded_at, backdating_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), $16)`,
        [
          warrantyEventId,
          ctx.orgId,
          projectId,
          input.assetId,
          input.eventType,
          eventStatus,
          input.oemReference.trim(),
          input.registeredAt,
          input.warrantyStart,
          input.warrantyEnd,
          input.basis,
          input.evidenceObjectId ?? null,
          ctx.userId,
          input.occurredAt ? new Date(input.occurredAt) : new Date(input.registeredAt),
          input.occurredAtPrecision || 'DATE',
          input.backdatingReason || null,
        ],
      );

      // Update asset dates if confirmed and no prior warranty_start exists (FR-AST-012, NP03)
      if (!hasBasisConflict) {
        if (input.eventType === 'EXTENSION') {
          await client.query(
            `UPDATE assets
                SET warranty_end = CASE
                      WHEN warranty_end IS NULL THEN $4::date
                      WHEN $4::date > warranty_end THEN $4::date
                      ELSE warranty_end
                    END,
                    row_version = row_version + 1,
                    updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [ctx.orgId, projectId, input.assetId, input.warrantyEnd],
          );
        } else if (input.eventType === 'REGISTRATION' || input.eventType === 'CONFIRMATION') {
          await client.query(
            `UPDATE assets
                SET warranty_start = COALESCE(warranty_start, $4::date),
                    warranty_end = COALESCE(warranty_end, $5::date),
                    row_version = row_version + 1,
                    updated_at = now()
              WHERE org_id = $1 AND project_id = $2 AND id = $3`,
            [ctx.orgId, projectId, input.assetId, input.warrantyStart, input.warrantyEnd],
          );
        }
        // Notice: eventType === 'CLAIM' does not create or expand warranty coverage
      }

      emit({
        eventType: 'WARRANTY_EVENT_RECORDED',
        projectId,
        entityType: 'WARRANTY_EVENT',
        entityId: warrantyEventId,
        afterJson: {
          assetTag: asset.tag,
          status: eventStatus,
          hasBasisConflict,
        },
      });

      return { warrantyEventId, status: eventStatus, hasBasisConflict };
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
      // 1. Lock defect FOR UPDATE under tenant and verify project association
      const { rows: defectRows } = await client.query(
        `SELECT d.*
           FROM defects d
          WHERE d.org_id = $1 AND d.id = $2
          FOR UPDATE OF d`,
        [ctx.orgId, defectId],
      );

      if (!defectRows.length) {
        throw new NotFoundException({
          code: 'DEFECT_NOT_FOUND',
          detail: `Defect ${defectId} not found.`,
        });
      }

      const defect = defectRows[0];
      const targetProjectId = defect.project_id;

      if (projectId && targetProjectId !== projectId) {
        throw new ConflictException({
          code: 'DEFECT_PROJECT_MISMATCH',
          detail: `Defect ${defectId} does not belong to project ${projectId}.`,
        });
      }

      if (defect.status === 'CLOSED') {
        throw new ConflictException({
          code: 'DEFECT_ALREADY_CLOSED',
          detail: `Defect ${defectId} is already closed.`,
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
        `SELECT so.id, so.status, so.object_key,
                EXISTS (
                  SELECT 1 FROM document_versions dv
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2 AND dv.object_id = so.id
                ) AS linked_in_project,
                EXISTS (
                  SELECT 1 FROM document_versions dv
                   WHERE dv.org_id = so.org_id AND dv.project_id != $2 AND dv.object_id = so.id
                ) AS linked_in_other_project,
                (
                  SELECT da.asset_id
                    FROM document_versions dv
                    JOIN document_assets da ON da.org_id = dv.org_id AND da.project_id = dv.project_id AND da.document_id = dv.document_id
                   WHERE dv.org_id = so.org_id AND dv.object_id = so.id
                   LIMIT 1
                ) AS linked_asset_id
           FROM storage_objects so
          WHERE so.org_id = $1 AND so.id = $3`,
        [ctx.orgId, targetProjectId, remedyEvidenceObjectId],
      );

      if (!soRows.length || soRows[0].status !== 'READY') {
        throw new NotFoundException({
          code: 'CLOSURE_EVIDENCE_NOT_FOUND_OR_NOT_READY',
          detail: 'Remedy evidence object must exist and be verified in READY status.',
        });
      }

      const so = soRows[0];
      const isProjectKey = Boolean(so.object_key && so.object_key.includes(`/projects/${targetProjectId}`));
      const isOtherProjectInKey = Boolean(so.object_key && so.object_key.includes('/projects/') && !isProjectKey);

      if (isOtherProjectInKey || so.linked_in_other_project || (!so.linked_in_project && !isProjectKey)) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_PROJECT_MISMATCH',
          detail: 'Remedy evidence object is associated with another project or not positively linked to this project.',
        });
      }

      // Security Invariant (Gap 5): Generic project manuals without asset binding cannot remedy an asset-bound defect
      const isDefectOrAssetKey = Boolean(
        so.object_key &&
        (so.object_key.includes(`/defects/${defectId}`) || (defect.asset_id && so.object_key.includes(`/assets/${defect.asset_id}`))),
      );
      if (defect.asset_id && !isDefectOrAssetKey) {
        if (!so.linked_asset_id || so.linked_asset_id !== defect.asset_id) {
          throw new ConflictException({
            code: 'CLOSURE_EVIDENCE_ASSET_MISMATCH',
            detail: `Remedy evidence must be positively linked to asset ${defect.asset_id}; generic project evidence or manuals cannot remedy an asset-bound defect.`,
          });
        }
      }

      const updateRes = await client.query(
        `UPDATE defects
            SET status = 'RECTIFIED',
                closure_evidence_object_id = $4,
                remedied_by = $5,
                remedied_at = now(),
                row_version = row_version + 1
          WHERE org_id = $1 AND project_id = $2 AND id = $3 AND row_version = $6`,
        [ctx.orgId, targetProjectId, defectId, remedyEvidenceObjectId, ctx.userId, defect.row_version],
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
        afterJson: { status: 'RECTIFIED', remedyEvidenceObjectId, remediedBy: ctx.userId },
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
    if (!closureEvidenceObjectId) {
      throw new UnprocessableEntityException({
        code: 'CLOSURE_EVIDENCE_REQUIRED',
        detail: 'Closing a defect requires uploading closure evidence (WF-25).',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      // 1. Lock defect FOR UPDATE under tenant
      const { rows: defectRows } = await client.query(
        `SELECT d.*
           FROM defects d
          WHERE d.org_id = $1 AND d.id = $2
          FOR UPDATE OF d`,
        [ctx.orgId, defectId],
      );

      if (!defectRows.length) {
        throw new NotFoundException({
          code: 'DEFECT_NOT_FOUND',
          detail: `Defect ${defectId} not found in project or is already closed.`,
        });
      }

      const defect = defectRows[0];
      const targetProjectId = defect.project_id;

      if (projectId && targetProjectId !== projectId) {
        throw new ConflictException({
          code: 'DEFECT_PROJECT_MISMATCH',
          detail: `Defect ${defectId} does not belong to project ${projectId}.`,
        });
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
        `SELECT so.id, so.status, so.object_key,
                EXISTS (
                  SELECT 1 FROM document_versions dv
                   WHERE dv.org_id = so.org_id AND dv.project_id = $2 AND dv.object_id = so.id
                ) AS linked_in_project,
                EXISTS (
                  SELECT 1 FROM document_versions dv
                   WHERE dv.org_id = so.org_id AND dv.project_id != $2 AND dv.object_id = so.id
                ) AS linked_in_other_project,
                (
                  SELECT da.asset_id
                    FROM document_versions dv
                    JOIN document_assets da ON da.org_id = dv.org_id AND da.project_id = dv.project_id AND da.document_id = dv.document_id
                   WHERE dv.org_id = so.org_id AND dv.object_id = so.id
                   LIMIT 1
                ) AS linked_asset_id
           FROM storage_objects so
          WHERE so.org_id = $1 AND so.id = $3`,
        [ctx.orgId, targetProjectId, closureEvidenceObjectId],
      );

      if (!soRows.length || soRows[0].status !== 'READY') {
        throw new NotFoundException({
          code: 'CLOSURE_EVIDENCE_NOT_FOUND_OR_NOT_READY',
          detail: 'Closure evidence object must exist and be verified in READY status.',
        });
      }

      const so = soRows[0];
      const isProjectKey = Boolean(so.object_key && so.object_key.includes(`/projects/${targetProjectId}`));
      const isOtherProjectInKey = Boolean(so.object_key && so.object_key.includes('/projects/') && !isProjectKey);

      if (isOtherProjectInKey || so.linked_in_other_project || (!so.linked_in_project && !isProjectKey)) {
        throw new ConflictException({
          code: 'CLOSURE_EVIDENCE_PROJECT_MISMATCH',
          detail: 'Closure evidence object is associated with another project or not positively linked to this project.',
        });
      }

      const isDefectOrAssetKey = Boolean(
        so.object_key &&
        (so.object_key.includes(`/defects/${defectId}`) || (defect.asset_id && so.object_key.includes(`/assets/${defect.asset_id}`))),
      );
      if (defect.asset_id && !isDefectOrAssetKey) {
        if (!so.linked_asset_id || so.linked_asset_id !== defect.asset_id) {
          throw new ConflictException({
            code: 'CLOSURE_EVIDENCE_ASSET_MISMATCH',
            detail: `Closure evidence must be positively linked to asset ${defect.asset_id}; generic project evidence or manuals cannot close an asset-bound defect.`,
          });
        }
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
      const { rows } = await client.query(
        `SELECT d.*, a.tag AS asset_tag, u.name AS raised_by_name
           FROM defects d
           LEFT JOIN assets a ON a.id = d.asset_id
           LEFT JOIN users u ON u.id = d.raised_by
          WHERE d.org_id = $1 AND d.project_id = $2
          ORDER BY d.raised_at DESC`,
        [ctx.orgId, projectId],
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
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
      const defectId = uuidv7();
      const severityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
        LOW: 'LOW',
        MINOR: 'LOW',
        MEDIUM: 'MEDIUM',
        MAJOR: 'HIGH',
        HIGH: 'HIGH',
        CRITICAL: 'CRITICAL',
      };
      const severity = (input.severity && severityMap[input.severity]) || 'MEDIUM';
      const description = input.location
        ? `${input.description || input.title} (Location: ${input.location})`
        : (input.description || input.title);

      await client.query(
        `INSERT INTO defects
           (id, org_id, project_id, asset_id, title, description, severity, status, raised_by, raised_at,
            occurred_at, occurred_at_precision, recorded_at, backdating_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, now(), $9, $10, now(), $11)`,
        [
          defectId,
          ctx.orgId,
          projectId,
          input.assetId || null,
          input.title,
          description,
          severity,
          ctx.userId,
          input.occurredAt ? new Date(input.occurredAt) : new Date(),
          input.occurredAtPrecision || 'INSTANT',
          input.backdatingReason || null,
        ],
      );

      emit({
        eventType: 'DEFECT_RAISED',
        projectId,
        entityType: 'DEFECT',
        entityId: defectId,
        afterJson: { title: input.title, severity },
      });

      return { defectId, status: 'OPEN', severity };
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
    return withTenantTransaction(this.pool, ctx, async (client, emit) => {
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
            COUNT(*) FILTER (WHERE status <> 'CLOSED' AND status <> 'WAIVED' AND severity IN ('HIGH', 'CRITICAL')) AS critical_defects
           FROM defects
          WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const defectStats = defectRows[0] || {};
      const openDefects = Number(defectStats.open_defects || 0);
      const criticalDefects = Number(defectStats.critical_defects || 0);

      const { rows: subRows } = await client.query(
        `SELECT s.id, s.status, s.package_id, s.created_at
           FROM submissions s
          WHERE s.org_id = $1 AND s.project_id = $2 AND s.status = 'ACCEPTED'
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      const hasAcceptedHandover = subRows.length > 0;

      const isRetentionEligible =
        pendingMandatory === 0 &&
        criticalDefects === 0 &&
        hasAcceptedHandover &&
        project.status !== 'SUSPENDED';

      const contractVal = project.contract_value_paise != null ? BigInt(project.contract_value_paise) : 0n;
      const retBps = project.retention_bps != null ? BigInt(project.retention_bps) : 500n;
      const calculatedRetentionPaise = project.retention_at_risk_paise || ((contractVal * retBps) / 10000n).toString();

      return {
        projectId,
        projectStatus: project.status,
        contractValuePaise: project.contract_value_paise || '0',
        retentionAtRiskPaise: calculatedRetentionPaise,
        mandatoryRequirements: {
          total: totalMandatory,
          satisfied: satisfiedMandatory,
          pending: pendingMandatory,
          satisfactionPercentage: totalMandatory > 0 ? Math.round((satisfiedMandatory / totalMandatory) * 100) : 100,
        },
        defects: {
          open: openDefects,
          critical: criticalDefects,
        },
        handover: {
          hasAcceptedSubmission: hasAcceptedHandover,
          acceptedSubmissionId: subRows[0]?.id || null,
        },
        commercialReadiness: {
          isRetentionEligible,
          releaseStatus: isRetentionEligible ? 'ELIGIBLE' : 'BLOCKED',
          blockingReasons: [
            ...(pendingMandatory > 0 ? [`${pendingMandatory} mandatory checklist requirements unsatisfied`] : []),
            ...(criticalDefects > 0 ? [`${criticalDefects} high/critical defects unresolved`] : []),
            ...(!hasAcceptedHandover ? ['Client-accepted handover package submission required'] : []),
          ],
        },
      };
    });
  }
}
