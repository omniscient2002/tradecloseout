// apps/api/src/modules/projects/projects.service.ts
// Projects, Contracts & Lifecycle State Machine Service (API-030..044, WF-03, WF-15, WF-18, WF-19, AUD-A-08, AUD-P-08, AUD-P-11)

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import {
  withTenantTransaction,
  consumePlanQuota,
  TenantActorContext,
  DomainOutboxEvent,
} from '@tradecloseout/db';
import { hasPermission, ProjectCodeSchema } from '@tradecloseout/shared';

@Injectable()
export class ProjectsService {
  constructor(private readonly pool: Pool) {}

  /**
   * API-031: POST /api/v1/projects
   * Creates a new project in DRAFT state and assigns the creator as Project Manager (WF-03).
   */
  async createDraftProject(
    ctx: TenantActorContext,
    input: {
      code: string;
      name: string;
      clientPartyId?: string;
      mcPartyId?: string;
      consultantPartyId?: string;
      startDate?: string;
      targetHandoverDate?: string;
      contractValuePaise?: bigint;
      siteJson?: Record<string, unknown>;
      settingsJson?: Record<string, unknown>;
      projectType?: string;
    },
  ) {
    const parsedCode = ProjectCodeSchema.safeParse(input.code);
    if (!parsedCode.success) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        title: 'Invalid project code',
        detail: parsedCode.error.issues[0]?.message ?? 'Invalid code format.',
      });
    }

    const allowedProjectTypes = new Set([
      'PRIVATE_COMMERCIAL', 'GOVT_PWD', 'GOVERNMENT', 'CPWD', 'PSU',
      'INSTITUTIONAL', 'INDUSTRIAL', 'HOSPITAL', 'CLEANROOM',
    ]);
    const projectType = input.projectType ?? 'PRIVATE_COMMERCIAL';
    if (!allowedProjectTypes.has(projectType)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_PROJECT_TYPE',
        detail: 'Select a supported project type for the contractual checklist.',
      });
    }

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const projectId = uuidv7();

      const settingsJson = {
        ...(input.settingsJson ?? {}),
        contract_value_paise: input.contractValuePaise ? input.contractValuePaise.toString() : null,
      };

      await client.query(
        `INSERT INTO projects
          (id, org_id, code, name, client_party_id, mc_party_id, consultant_party_id,
           status, site_json, start_date, target_handover_date, settings_json, created_by, project_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13)`,
        [
          projectId,
          ctx.orgId,
          parsedCode.data,
          input.name.trim(),
          input.clientPartyId ?? null,
          input.mcPartyId ?? null,
          input.consultantPartyId ?? null,
          JSON.stringify(input.siteJson ?? {}),
          input.startDate ?? null,
          input.targetHandoverDate ?? null,
          JSON.stringify(settingsJson),
          ctx.userId,
          projectType,
        ],
      );

      // Creator is added as managing project member (06 §3.1)
      await client.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, status, added_by)
         VALUES ($1, $2, $3, $4, 'R-PM', 'ACTIVE', $4)`,
        [uuidv7(), ctx.orgId, projectId, ctx.userId],
      );

      emit({
        eventType: 'PROJECT_CREATED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        afterJson: { code: parsedCode.data, name: input.name, status: 'DRAFT' },
      });

      return { id: projectId, projectId, code: parsedCode.data, name: input.name, status: 'DRAFT', rowVersion: 1 };
    });
  }

  /**
   * Controller wrapper for createProject
   */
  async createProject(
    ctx: TenantActorContext,
    dto: {
      code: string;
      name: string;
      projectType?: string;
      clientPartyId?: string;
      mcPartyId?: string;
      consultantPartyId?: string;
      contractValuePaise?: string | number | bigint;
      targetHandoverDate?: string;
    },
  ) {
    return this.createDraftProject(ctx, {
      code: dto.code,
      name: dto.name,
      projectType: dto.projectType,
      clientPartyId: dto.clientPartyId,
      mcPartyId: dto.mcPartyId,
      consultantPartyId: dto.consultantPartyId,
      contractValuePaise: dto.contractValuePaise ? BigInt(dto.contractValuePaise) : undefined,
      targetHandoverDate: dto.targetHandoverDate,
    });
  }

  /**
   * API-033: PATCH /api/v1/projects/:id (FR-PRJ-004, TC-PRJ-02)
   */
  async updateProject(
    ctx: TenantActorContext,
    projectId: string,
    dto: { name?: string; code?: string; clientPartyId?: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: projRows } = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      const proj = projRows[0];

      // TC-PRJ-02: Write operations on SUSPENDED, CLOSED, or ARCHIVED project are rejected
      if (['SUSPENDED', 'CLOSED', 'ARCHIVED'].includes(proj.status)) {
        throw new ConflictException({
          code: 'PROJECT_IMMUTABLE',
          title: 'Project is locked',
          detail: `Cannot modify project in status ${proj.status}.`,
        });
      }

      // TC-PRJ-02: Mutating project.code after activation is rejected (FR-PRJ-004)
      if (dto.code && dto.code.trim().toUpperCase() !== proj.code) {
        if (proj.status !== 'DRAFT') {
          throw new ConflictException({
            code: 'PROJECT_CODE_IMMUTABLE',
            title: 'Project code cannot be changed',
            detail: 'Project code is immutable once the project is activated.',
          });
        }
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE projects
            SET name = COALESCE($1, name),
                code = COALESCE($2, code),
                client_party_id = COALESCE($3, client_party_id),
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $4 AND id = $5
          RETURNING *`,
        [
          dto.name?.trim(),
          dto.code?.trim().toUpperCase(),
          dto.clientPartyId,
          ctx.orgId,
          projectId,
        ],
      );

      return updatedRows[0];
    });
  }

  /**
   * API-034: POST /api/v1/projects/:id/activate
   * Transitions DRAFT -> ACTIVE after verifying snapshot, manager, and plan quota (FR-PRJ-003).
   */
  async activateProject(
    ctx: TenantActorContext,
    projectId: string,
    expectedRowVersion?: number,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: projRows } = await client.query(
        `SELECT id, code, status, row_version FROM projects
          WHERE org_id = $1 AND id = $2
          FOR UPDATE`,
        [ctx.orgId, projectId],
      );

      if (projRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Project not found.' });
      }
      const project = projRows[0];

      if (expectedRowVersion !== undefined && expectedRowVersion !== null && project.row_version !== expectedRowVersion) {
        throw new ConflictException({ code: 'PRECONDITION_FAILED', detail: 'Stale rowVersion.' });
      }
      if (project.status !== 'DRAFT') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: `Project is in state ${project.status}; only DRAFT projects can be activated.`,
        });
      }

      // Guard 1: Must have an ACTIVE checklist snapshot (FR-PRJ-003)
      const { rows: snapRows } = await client.query(
        `SELECT id FROM checklist_snapshots
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (snapRows.length === 0) {
        throw new UnprocessableEntityException({
          code: 'MISSING_CHECKLIST_SNAPSHOT',
          message: 'Checklist snapshot required before activating project.',
          title: 'Checklist snapshot required',
          detail: 'Assign and apply a checklist snapshot before activating project.',
        });
      }

      // Guard 2: Must have at least one active managing member (FR-PRJ-003)
      const { rows: mgrRows } = await client.query(
        `SELECT id FROM project_members
          WHERE org_id = $1 AND project_id = $2
            AND status = 'ACTIVE' AND role IN ('R-PM','R-OWNER','R-ADMIN')
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (mgrRows.length === 0) {
        throw new UnprocessableEntityException({
          code: 'MISSING_PROJECT_MANAGER',
          title: 'Managing member required',
          detail: 'Assign at least one Project Manager before activating the project.',
        });
      }

      // Guard 3: Lock usage_counters FOR UPDATE and enforce plan limit (AUD-A-08)
      const maxProjectsLimit = await this.getOrgMaxActiveProjectsLimit(client, ctx.orgId);
      await consumePlanQuota(
        client,
        ctx.orgId,
        'ACTIVE_PROJECTS',
        'ALL_TIME',
        1n,
        BigInt(maxProjectsLimit),
      );

      const { rows: updatedRows } = await client.query(
        `UPDATE projects
            SET status = 'ACTIVE', row_version = row_version + 1, updated_at = now()
          WHERE org_id = $1 AND id = $2
          RETURNING *`,
        [ctx.orgId, projectId],
      );

      emit({
        eventType: 'PROJECT_ACTIVATED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { status: 'DRAFT' },
        afterJson: { status: 'ACTIVE', snapshotId: snapRows[0]?.id },
      });

      return updatedRows[0];
    });
  }

  /**
   * POST /api/v1/projects/:id/suspend
   */
  async suspendProject(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `UPDATE projects
            SET status = 'SUSPENDED', updated_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND id = $2 AND status = 'ACTIVE'
          RETURNING *`,
        [ctx.orgId, projectId],
      );
      if (!rows.length) throw new NotFoundException('PROJECT_NOT_FOUND_OR_NOT_ACTIVE');
      return rows[0];
    });
  }

  /**
   * API-038: POST /api/v1/projects/:id/close
   * Transitions HANDOVER -> CLOSED (WF-18). Enforces warranty_start precedence (AUD-P-08 / FR-AST-012).
   */
  async closeProject(
    ctx: TenantActorContext,
    projectId: string,
    expectedRowVersion?: number,
    input?: { closureDate?: string },
  ) {
    const closureDate = input?.closureDate || new Date().toISOString().split('T')[0];

    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: projRows } = await client.query(
        `SELECT id, status, row_version FROM projects
          WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (projRows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Project not found.' });
      }
      const proj = projRows[0];

      if (expectedRowVersion !== undefined && expectedRowVersion !== null && proj.row_version !== expectedRowVersion) {
        throw new ConflictException({ code: 'PRECONDITION_FAILED', detail: 'Stale rowVersion.' });
      }

      // Security & Workflow Invariants (TC2-012):
      // Project closure has no generic override path. Exceptions must use a separate,
      // authorised and auditable domain decision before this transition.
      if (proj.status !== 'HANDOVER') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: `Cannot close project from status ${proj.status}. Project must be in HANDOVER status.`,
        });
      }

      // 2. Open mandatory defects must be resolved
      const { rows: openDefects } = await client.query(
        `SELECT id FROM defects
          WHERE org_id = $1 AND project_id = $2
            AND mandatory = true AND status NOT IN ('CLOSED', 'WAIVED')
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (openDefects.length > 0) {
        throw new ConflictException({
          code: 'MANDATORY_DEFECTS_UNRESOLVED',
          detail: 'Cannot close project: open mandatory defects remain unresolved. Close them or record a valid authorised waiver first.',
        });
      }

      // 3. Accept the CURRENT dossier revision, not any historic submission.
      // A later package or updated checklist invalidates older acceptance for
      // full-project closure. Required recipients must all have accepted.
      const { rows: acceptedSubmissions } = await client.query(
        `SELECT s.id
           FROM submissions s
           JOIN handover_packages hp
             ON hp.org_id = s.org_id AND hp.project_id = s.project_id
            AND hp.id = s.package_id
           JOIN checklist_snapshots cs
             ON cs.org_id = hp.org_id AND cs.project_id = hp.project_id
            AND cs.id = hp.snapshot_id AND cs.status = 'ACTIVE'
            AND cs.checksum = hp.snapshot_checksum
          WHERE s.org_id = $1 AND s.project_id = $2
            AND s.status = 'ACCEPTED' AND hp.status = 'ACCEPTED'
            AND hp.version_no = (
              SELECT MAX(p.version_no) FROM handover_packages p
               WHERE p.org_id = $1 AND p.project_id = $2
            )
            AND s.id = (
              SELECT s2.id FROM submissions s2
               WHERE s2.org_id = s.org_id AND s2.project_id = s.project_id
                 AND s2.package_id = hp.id
               ORDER BY s2.submitted_at DESC, s2.id DESC LIMIT 1
            )
            AND EXISTS (
              SELECT 1 FROM submission_recipients sr
               WHERE sr.org_id = s.org_id AND sr.submission_id = s.id
                 AND sr.is_required_approver = true AND sr.status = 'ACCEPTED'
                 AND sr.decided_at IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM submission_recipients sr
               WHERE sr.org_id = s.org_id AND sr.submission_id = s.id
                 AND sr.is_required_approver = true
                 AND (sr.status <> 'ACCEPTED' OR sr.decided_at IS NULL)
            )
          LIMIT 1`,
        [ctx.orgId, projectId],
      );
      if (acceptedSubmissions.length === 0) {
        throw new ConflictException({
          code: 'HANDOVER_SUBMISSION_NOT_ACCEPTED',
          detail: 'Cannot close project: the latest handover package and active checklist must have valid acceptance from every required recipient.',
        });
      }

      // Closing a project is not itself evidence of the contractual HANDOVER
      // or ACCEPTANCE date. Leave warranty dates unchanged until the relevant
      // independently evidenced contractual event is recorded.

      const { rows: updatedRows } = await client.query(
        `UPDATE projects
            SET status = 'CLOSED',
                closed_at = now(),
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $1 AND id = $2
          RETURNING *`,
        [ctx.orgId, projectId],
      );

      emit({
        eventType: 'PROJECT_CLOSED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { status: proj.status },
        afterJson: { status: 'CLOSED', closureDate },
      });

      return updatedRows[0];
    });
  }

  /**
   * API-039: POST /api/v1/projects/:id/reopen
   * Guards against reopening a purged project (WF-19 / AUD-P-11).
   */
  async reopenProject(
    ctx: TenantActorContext,
    projectId: string,
    expectedRowVersion: number,
    reason: string,
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `SELECT id, status, purged_at, reopen_count, row_version
           FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Project not found.' });
      }
      const proj = rows[0];

      // Reopen Guard (AUD-P-11): Once purged_at is set, reopening is impossible
      if (proj.purged_at !== null) {
        throw new ConflictException({
          code: 'PROJECT_PURGED_CANNOT_REOPEN',
          title: 'Archived project has been purged',
          detail: 'This project was purged per retention policy and cannot be reopened (AUD-P-11).',
        });
      }
      if (proj.status !== 'CLOSED') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: 'Only CLOSED projects can be reopened.',
        });
      }

      await client.query(
        `UPDATE projects
            SET status = 'ACTIVE',
                reopen_count = reopen_count + 1,
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );

      emit({
        eventType: 'PROJECT_REOPENED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { status: 'CLOSED', reopenCount: proj.reopen_count },
        afterJson: { status: 'ACTIVE', reopenCount: proj.reopen_count + 1, reason },
      });

      return { projectId, status: 'ACTIVE', reopenCount: proj.reopen_count + 1 };
    });
  }

  async handoverProject(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows } = await client.query(
        `SELECT id, status, row_version FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (rows.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', detail: 'Project not found.' });
      }
      const proj = rows[0];
      if (proj.status !== 'ACTIVE' && proj.status !== 'HANDOVER') {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          detail: 'Only ACTIVE projects can transition to HANDOVER.',
        });
      }

      await client.query(
        `UPDATE projects
            SET status = 'HANDOVER',
                row_version = row_version + 1,
                updated_at = now()
          WHERE org_id = $1 AND id = $2`,
        [ctx.orgId, projectId],
      );

      emit({
        eventType: 'PROJECT_HANDOVER_INITIATED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { status: proj.status },
        afterJson: { status: 'HANDOVER' },
      });

      return { projectId, status: 'HANDOVER' };
    });
  }

  /**
   * API-030 GET /projects
   */
  async listProjects(ctx: TenantActorContext) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const permission = hasPermission({
        orgRole: ctx.orgRole,
        projectRole: ctx.projectRole,
        guestCapabilities: ctx.guestCapabilities,
      }, 'project.read');
      if (!permission.allowed) throw new NotFoundException('PROJECT_NOT_FOUND');
      if (ctx.guestGrantId) throw new NotFoundException('PROJECT_NOT_FOUND');
      if (permission.scope === 'S') {
        const res = await client.query(
          `SELECT p.* FROM projects p
            JOIN project_members pm
              ON pm.org_id = p.org_id AND pm.project_id = p.id
             AND pm.user_id = $2 AND pm.status = 'ACTIVE'
           WHERE p.org_id = $1 AND p.purged_at IS NULL
           ORDER BY p.created_at DESC`,
          [ctx.orgId, ctx.userId],
        );
        return res.rows;
      }
      const res = await client.query(
        `SELECT p.* FROM projects p
         WHERE p.org_id = $1 AND p.purged_at IS NULL
         ORDER BY p.created_at DESC`,
        [ctx.orgId],
      );
      return res.rows;
    });
  }

  /**
   * API-032 GET /projects/:id
   */
  async getProject(ctx: TenantActorContext, projectId: string) {
    if ((ctx.actorType === 'GUEST' || ctx.guestGrantId) && ctx.guestProjectId && ctx.guestProjectId !== projectId) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 AND purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!res.rows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      return res.rows[0];
    });
  }

  async getProjectDashboard(ctx: TenantActorContext, projectId: string) {
    if ((ctx.actorType === 'GUEST' || ctx.guestGrantId) && ctx.guestProjectId && ctx.guestProjectId !== projectId) {
      throw new NotFoundException('PROJECT_NOT_FOUND');
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const projRes = await client.query(
        `SELECT p.*, cp.name as client_name
         FROM projects p
         LEFT JOIN parties cp ON cp.id = p.client_party_id
         WHERE p.org_id = $1 AND p.id = $2 AND p.purged_at IS NULL`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      const p = projRes.rows[0];

      // Aggregate requirement counts (RQ01: harmonized with organisation summary)
      const countsRes = await client.query(
        `SELECT
           COUNT(id) FILTER (WHERE status != 'NOT_APPLICABLE' AND superseded_at IS NULL)::int as applicable_total,
           COUNT(id) FILTER (WHERE status = 'APPROVED' AND superseded_at IS NULL)::int as approved,
           COUNT(id) FILTER (WHERE status = 'APPROVED_EXTERNAL' AND superseded_at IS NULL)::int as approved_external,
           COUNT(id) FILTER (WHERE status = 'WAIVED' AND superseded_at IS NULL)::int as waived,
           COUNT(id) FILTER (WHERE status IN ('IN_REVIEW', 'UPLOADED') AND superseded_at IS NULL)::int as in_review,
           COUNT(id) FILTER (WHERE status IN ('NOT_STARTED', 'REQUESTED', 'CHANGES_REQUESTED', 'REJECTED', 'MISSING', 'EXPIRED') AND superseded_at IS NULL)::int as missing_or_expired,
           COUNT(id) FILTER (WHERE status NOT IN ('APPROVED', 'APPROVED_EXTERNAL', 'WAIVED', 'NOT_APPLICABLE') AND superseded_at IS NULL AND due_at IS NOT NULL AND due_at BETWEEN now() AND now() + INTERVAL '14 days')::int as expiring_soon
         FROM requirements
         WHERE org_id = $1 AND project_id = $2`,
        [ctx.orgId, projectId],
      );
      const c = countsRes.rows[0] || {};

      // Estimate retention at risk from all active contracts (RQ01)
      const contractRes = await client.query(
        `SELECT COALESCE(SUM(value_paise), 0) AS total_contract_value_paise,
                COALESCE(SUM(ROUND((value_paise * COALESCE(retention_bps, 500)) / 10000)), 0) AS total_retention_at_risk_paise,
                COUNT(*)::int AS active_contract_count
           FROM contracts
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE'`,
        [ctx.orgId, projectId],
      );
      let retentionPaise = '0';
      if (contractRes.rows.length > 0 && Number(contractRes.rows[0].active_contract_count) > 0) {
        retentionPaise = contractRes.rows[0].total_retention_at_risk_paise.toString();
      } else if (p.contract_value_paise) {
        const val = BigInt(p.contract_value_paise);
        const bps = p.retention_bps !== null && p.retention_bps !== undefined ? BigInt(p.retention_bps) : 500n;
        retentionPaise = ((val * bps) / 10000n).toString();
      }

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        status: p.status,
        clientName: p.client_name || null,
        targetHandoverDate: p.target_handover_date,
        retentionAtRiskPaise: retentionPaise,
        counts: {
          applicableTotal: Number(c.applicable_total) || 0,
          approvedCount: Number(c.approved) || 0,
          approvedExternalCount: Number(c.approved_external) || 0,
          waivedCount: Number(c.waived) || 0,
          inReviewCount: Number(c.in_review) || 0,
          missingOrExpiredCount: Number(c.missing_or_expired) || 0,
          expiringSoonCount: Number(c.expiring_soon) || 0,
        },
        rowVersion: p.row_version || 1,
      };
    });
  }

  /**
   * API-035 GET /projects/:id/contracts
   */
  async listContracts(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM contracts
          WHERE org_id = $1 AND project_id = $2
          ORDER BY created_at DESC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * API-036 POST /projects/:id/contracts
   */
  async createContract(
    ctx: TenantActorContext,
    projectId: string,
    dto: {
      contractRef: string;
      title: string;
      partyId?: string;
      valuePaise?: number | bigint;
      retentionBps?: number;
      commencementDate?: string;
      completionDate?: string;
    },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const contractId = uuidv7();
      const res = await client.query(
        `INSERT INTO contracts (
          id, org_id, project_id, contract_ref, title, party_id,
          value_paise, retention_bps, commencement_date, completion_date, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE', $11)
        RETURNING *`,
        [
          contractId,
          ctx.orgId,
          projectId,
          dto.contractRef.trim(),
          dto.title.trim(),
          dto.partyId || null,
          dto.valuePaise ?? 0,
          dto.retentionBps ?? 500,
          dto.commencementDate || null,
          dto.completionDate || null,
          ctx.userId,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * API-038 POST /projects/:id/contracts/:contractId/variations
   */
  async createVariation(
    ctx: TenantActorContext,
    projectId: string,
    contractId: string,
    dto: { variationRef: string; title: string; costDeltaPaise: number | bigint; scopeDeltaJson?: any },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const varId = uuidv7();
      const res = await client.query(
        `INSERT INTO variations (
          id, org_id, project_id, contract_id, variation_ref, title,
          cost_delta_paise, scope_delta_json, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'APPROVED', $9)
        RETURNING *`,
        [
          varId,
          ctx.orgId,
          projectId,
          contractId,
          dto.variationRef.trim(),
          dto.title.trim(),
          dto.costDeltaPaise ?? 0,
          dto.scopeDeltaJson ? JSON.stringify(dto.scopeDeltaJson) : null,
          ctx.userId,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * API-040 GET /projects/:id/specifications
   */
  async listSpecifications(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT * FROM specification_refs
          WHERE org_id = $1 AND project_id = $2
          ORDER BY spec_number ASC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * API-041 POST /projects/:id/specifications
   */
  async createSpecification(
    ctx: TenantActorContext,
    projectId: string,
    dto: { specNumber: string; title: string; division?: string; documentId?: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const specId = uuidv7();
      const res = await client.query(
        `INSERT INTO specification_refs (
          id, org_id, project_id, spec_number, title, division, document_id, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          specId,
          ctx.orgId,
          projectId,
          dto.specNumber.trim(),
          dto.title.trim(),
          dto.division || null,
          dto.documentId || null,
          ctx.userId,
        ],
      );
      return res.rows[0];
    });
  }

  /**
   * GET /projects/:id/members
   */
  async listProjectMembers(ctx: TenantActorContext, projectId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `SELECT pm.*, u.name,
                (SELECT value FROM user_identities WHERE user_id = u.id ORDER BY created_at ASC LIMIT 1) AS identifier
           FROM project_members pm
           JOIN users u ON u.id = pm.user_id
          WHERE pm.org_id = $1 AND pm.project_id = $2
          ORDER BY pm.created_at ASC`,
        [ctx.orgId, projectId],
      );
      return res.rows;
    });
  }

  /**
   * POST /projects/:id/members
   */
  async addProjectMember(
    ctx: TenantActorContext,
    projectId: string,
    dto: { userId: string; role: string },
  ) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const memberId = uuidv7();
      const res = await client.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, added_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (project_id, user_id)
         DO UPDATE SET role = $5, status = 'ACTIVE', updated_at = now()
         RETURNING *`,
        [memberId, ctx.orgId, projectId, dto.userId, dto.role, ctx.userId],
      );
      return res.rows[0];
    });
  }

  /**
   * DELETE /projects/:id/members/:userId
   */
  async removeProjectMember(ctx: TenantActorContext, projectId: string, targetUserId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE project_members
            SET status = 'REMOVED', updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3
          RETURNING *`,
        [ctx.orgId, projectId, targetUserId],
      );
      if (!res.rows.length) throw new NotFoundException('PROJECT_MEMBER_NOT_FOUND');
      return { success: true, removedUserId: targetUserId };
    });
  }

  private async getOrgMaxActiveProjectsLimit(client: any, orgId: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT p.limits_json
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1 AND s.status IN ('TRIAL','ACTIVE','PAST_DUE')
        LIMIT 1`,
      [orgId],
    );
    if (rows.length === 0) return 10; // Starter limit
    return Number(rows[0].limits_json?.maxActiveProjects ?? 10);
  }
}
