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
  TenantActorContext,
  DomainOutboxEvent,
} from '@tradecloseout/db';
import { hasPermission, ProjectCodeSchema } from '@tradecloseout/shared';
import { evaluateReadinessInTransaction } from '../handover/closeout-readiness';

const POSTGRES_BIGINT_MAX = 9223372036854775807n;
const POSTGRES_BIGINT_MIN = -9223372036854775808n;

/** Never coerce floating point, exponential notation or unsafe JS numbers into money. */
function exactPaise(value: unknown, allowNegative = false): bigint | undefined {
  if (value === undefined) return undefined;
  const valid = typeof value === 'bigint'
    ? true
    : typeof value === 'number'
      ? Number.isSafeInteger(value)
      : typeof value === 'string' && /^-?\d{1,19}$/.test(value);
  if (!valid) throw new UnprocessableEntityException({ code: 'INVALID_MONEY_PAISE' });
  const amount = BigInt(value as bigint | number | string);
  if (amount > POSTGRES_BIGINT_MAX || amount < (allowNegative ? POSTGRES_BIGINT_MIN : 0n)) {
    throw new UnprocessableEntityException({ code: 'INVALID_MONEY_PAISE' });
  }
  return amount;
}

function validProjectDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly pool: Pool) {}

  // PH2-G05-005: serialize commercial reference writers with project closure.
  // A writer waiting for the closure lock must recheck the state after acquiring it.
  private async lockEditableCommercialProject(client: PoolClient, orgId: string, projectId: string) {
    const { rows } = await client.query(
      `SELECT status, purged_at FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
      [orgId, projectId],
    );
    if (!rows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
    if (rows[0].purged_at != null || !['DRAFT', 'ACTIVE'].includes(rows[0].status)) {
      throw new ConflictException({
        code: 'PROJECT_COMMERCIAL_WRITES_LOCKED',
        detail: 'Commercial records cannot be modified in this project lifecycle state.',
      });
    }
  }

  /**
   * PH2-G18-004/G05-007: the canonical projects table is authoritative.
   * The org-wide counter lock serializes competing activations and reopenings;
   * a reservation is made before the status change in the *same transaction*.
   * Active, suspended and handover projects all occupy a slot until closure.
   * Reconciliation also repairs a stale historical counter without grants.
   */
  private async reconcileActiveProjectSlots(
    client: PoolClient,
    orgId: string,
    reserveOne: boolean,
    capacity?: bigint,
  ): Promise<void> {
    await client.query(
      `INSERT INTO usage_counters (id, org_id, metric, period, value)
       VALUES ($1, $2, 'ACTIVE_PROJECTS', 'ALL_TIME', 0)
       ON CONFLICT (org_id, metric, period) DO NOTHING`,
      [uuidv7(), orgId],
    );
    await client.query(
      `SELECT value FROM usage_counters
        WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'
        FOR UPDATE`,
      [orgId],
    );
    const { rows: currentRows } = await client.query(
      `SELECT COUNT(*)::text AS count FROM projects
         WHERE org_id = $1 AND status IN ('ACTIVE','SUSPENDED','HANDOVER')
           AND purged_at IS NULL`,
      [orgId],
    );
    const next = BigInt(currentRows[0]?.count ?? '0') + (reserveOne ? 1n : 0n);
    if (capacity !== undefined && next > capacity) {
      throw new ConflictException({
        code: 'ACTIVE_PROJECT_LIMIT_EXCEEDED',
        detail: 'No additional active-project capacity is available.',
      });
    }
    await client.query(
      `UPDATE usage_counters SET value = $2::bigint, updated_at = now()
        WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'`,
      [orgId, next.toString()],
    );
  }

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
    if (typeof input.name !== 'string' || input.name.trim().length < 2 ||
        input.name.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(input.name)) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_NAME' });
    }
    const contractValuePaise = exactPaise(input.contractValuePaise);
    for (const key of ['clientPartyId','mcPartyId','consultantPartyId'] as const) {
      const val = input[key];
      if (val !== undefined && (typeof val !== 'string' ||
          !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(val))) {
        throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_PARTY_ID' });
      }
    }
    for (const key of ['startDate','targetHandoverDate'] as const) {
      if (input[key] !== undefined && !validProjectDate(input[key])) {
        throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_DATE' });
      }
    }
    if (input.startDate && input.targetHandoverDate &&
        input.targetHandoverDate < input.startDate) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_DATE_ORDER' });
    }
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
        // Compatibility-only value. All financial readers use the canonical
        // projects.contract_value_paise or independently recorded contracts.
        contract_value_paise: contractValuePaise === undefined ? null : contractValuePaise.toString(),
      };

      await client.query(
        `INSERT INTO projects
          (id, org_id, code, name, client_party_id, mc_party_id, consultant_party_id,
           status, site_json, start_date, target_handover_date, settings_json, created_by, project_type,
           contract_value_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'DRAFT', $8, $9, $10, $11, $12, $13, $14)`,
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
          contractValuePaise === undefined ? null : contractValuePaise.toString(),
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
      contractValuePaise: exactPaise(dto.contractValuePaise),
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
    // Validate the actual runtime JSON before calling trim() or issuing SQL.
    if (!dto || typeof dto !== 'object' || Array.isArray(dto) ||
        Object.keys(dto).some(k => !['name','code','clientPartyId'].includes(k)) ||
        !Object.entries(dto).some(([,value]) => value !== undefined)) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_UPDATE' });
    }
    if (dto.name !== undefined && (typeof dto.name !== 'string' ||
        dto.name.trim().length < 2 || dto.name.trim().length > 200)) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_NAME' });
    }
    if (dto.code !== undefined && (typeof dto.code !== 'string' ||
        !ProjectCodeSchema.safeParse(dto.code.trim().toUpperCase()).success)) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_CODE' });
    }
    if (dto.clientPartyId !== undefined && (typeof dto.clientPartyId !== 'string' ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(dto.clientPartyId))) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_PARTY_ID' });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      const { rows: projRows } = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projRows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      const proj = projRows[0];

      // HANDOVER/terminal scopes cannot be edited through a generic profile PATCH.
      if (proj.purged_at != null || !['DRAFT', 'ACTIVE'].includes(proj.status)) {
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

      const changedFields = (Object.keys(dto) as Array<keyof typeof dto>)
        .filter(key => dto[key] !== undefined);
      emit({
        eventType: 'PROJECT_METADATA_UPDATED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { rowVersion: proj.row_version, status: proj.status },
        afterJson: { rowVersion: updatedRows[0].row_version, changedFields },
      });
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
        `SELECT pm.id FROM project_members pm
           JOIN memberships m ON m.org_id=pm.org_id AND m.user_id=pm.user_id
             AND m.status='ACTIVE'
           JOIN users u ON u.id=pm.user_id AND u.status='ACTIVE'
          WHERE pm.org_id = $1 AND pm.project_id = $2
            AND pm.status = 'ACTIVE' AND pm.role IN ('R-PM','R-OWNER','R-ADMIN')
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

      // Reserve against the canonical active-project count and current plan.
      const maxProjectsLimit = await this.getOrgMaxActiveProjectsLimit(client, ctx.orgId);
      await this.reconcileActiveProjectSlots(client, ctx.orgId, true, BigInt(maxProjectsLimit));

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
      emit({
        eventType: 'PROJECT_SUSPENDED',
        projectId,
        entityType: 'PROJECT',
        entityId: projectId,
        beforeJson: { status: 'ACTIVE', rowVersion: rows[0].row_version - 1 },
        afterJson: { status: 'SUSPENDED', rowVersion: rows[0].row_version },
      });
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

      // Historical acceptance is not sufficient after new mandatory obligations,
      // evidence expiry/quarantine, or a revoked waiver. Revalidate the same
      // live qualification used by GET readiness inside this closure transaction.
      const readiness = await evaluateReadinessInTransaction(client, ctx.orgId, projectId);
      if (!readiness.readyWithoutOverride) {
        throw new ConflictException({
          code: 'PROJECT_CLOSEOUT_NOT_READY',
          detail: 'Current mandatory closeout requirements are missing, expired or unconfigured.',
          missingMandatoryCount: readiness.blockers.missingMandatoryCount,
          expiredMandatoryCount: readiness.blockers.expiredMandatoryCount,
          configurationBlocker: readiness.configurationBlocker,
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
            AND hp.package_purpose = 'FULL_HANDOVER'
            AND hp.version_no = (
              SELECT MAX(p.version_no) FROM handover_packages p
               WHERE p.org_id = $1 AND p.project_id = $2
                 AND p.package_purpose = 'FULL_HANDOVER'
            )
            AND s.id = (
              SELECT s2.id FROM submissions s2
               WHERE s2.org_id = s.org_id AND s2.project_id = s.project_id
                 AND s2.package_id = hp.id
               ORDER BY s2.submitted_at DESC, s2.id DESC LIMIT 1
            )
            -- The accepted dossier must carry the manifest of EVERY current
            -- contractual obligation, not merely a milestone payment subset.
            AND NOT EXISTS (
              SELECT 1 FROM requirements required
               WHERE required.org_id = hp.org_id AND required.project_id = hp.project_id
                 AND required.superseded_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM package_requirements pr
                    WHERE pr.org_id = required.org_id
                      AND pr.project_id = required.project_id
                      AND pr.package_id = hp.id
                      AND pr.requirement_id = required.id
                 )
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
      await this.reconcileActiveProjectSlots(client, ctx.orgId, false);

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
    expectedRowVersion: number | undefined,
    reason: string | undefined,
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
      if (typeof expectedRowVersion !== 'number' || !Number.isSafeInteger(expectedRowVersion) || expectedRowVersion <= 0 ||
          Number(proj.row_version) !== expectedRowVersion) {
        throw new ConflictException({ code: 'PRECONDITION_FAILED', detail: 'Current rowVersion is required.' });
      }
      if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500) {
        throw new UnprocessableEntityException({
          code: 'REOPEN_REASON_REQUIRED', detail: 'A specific reopening reason is required.',
        });
      }
      const maxProjectsLimit = await this.getOrgMaxActiveProjectsLimit(client, ctx.orgId);
      await this.reconcileActiveProjectSlots(client, ctx.orgId, true, BigInt(maxProjectsLimit));

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
   * PH2-G05-011: stable compatibility projection across SQL and web. Do not
   * fabricate closeout percentages, missing parties or financial totals.
   */
  private projectDirectoryDto(row: Record<string, any>) {
    return {
      ...row,
      clientName: row.client_name ?? null,
      mcName: row.mc_name ?? null,
      pmcName: row.pmc_name ?? null,
      targetHandoverDate: row.target_handover_date ?? null,
      contractValuePaise: row.contract_value_paise == null ? null : String(row.contract_value_paise),
      rowVersion: row.row_version,
    };
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
          `SELECT p.*, client.name AS client_name,
                  mc.name AS mc_name, consultant.name AS pmc_name
             FROM projects p
            JOIN project_members pm
              ON pm.org_id = p.org_id AND pm.project_id = p.id
             AND pm.user_id = $2 AND pm.status = 'ACTIVE'
            LEFT JOIN parties client ON client.org_id=p.org_id
              AND client.id=p.client_party_id AND client.deleted_at IS NULL
            LEFT JOIN parties mc ON mc.org_id=p.org_id
              AND mc.id=p.mc_party_id AND mc.deleted_at IS NULL
            LEFT JOIN parties consultant ON consultant.org_id=p.org_id
              AND consultant.id=p.consultant_party_id AND consultant.deleted_at IS NULL
           WHERE p.org_id = $1 AND p.purged_at IS NULL
           ORDER BY p.created_at DESC`,
          [ctx.orgId, ctx.userId],
        );
        return res.rows.map((row) => this.projectDirectoryDto(row));
      }
      const res = await client.query(
        `SELECT p.*, client.name AS client_name,
                mc.name AS mc_name, consultant.name AS pmc_name
           FROM projects p
           LEFT JOIN parties client ON client.org_id=p.org_id
             AND client.id=p.client_party_id AND client.deleted_at IS NULL
           LEFT JOIN parties mc ON mc.org_id=p.org_id
             AND mc.id=p.mc_party_id AND mc.deleted_at IS NULL
           LEFT JOIN parties consultant ON consultant.org_id=p.org_id
             AND consultant.id=p.consultant_party_id AND consultant.deleted_at IS NULL
          WHERE p.org_id = $1 AND p.purged_at IS NULL
          ORDER BY p.created_at DESC`,
        [ctx.orgId],
      );
      return res.rows.map((row) => this.projectDirectoryDto(row));
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
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableCommercialProject(client, ctx.orgId, projectId);
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
      emit({
        eventType: 'CONTRACT_CREATED',
        projectId,
        entityType: 'CONTRACT',
        entityId: contractId,
        afterJson: { reference: dto.contractRef.trim(), status: 'ACTIVE' },
      });
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
    // PH2-G05-002/005: a commercial variation is a proposal, never an
    // approval made by the creator. Validate its amount and scope before SQL.
    if (typeof dto?.variationRef !== 'string' || !dto.variationRef.trim() ||
        dto.variationRef.trim().length > 120 || typeof dto.title !== 'string' ||
        !dto.title.trim() || dto.title.trim().length > 200) {
      throw new UnprocessableEntityException({ code: 'INVALID_VARIATION_INPUT' });
    }
    const deltaPaise = exactPaise(dto.costDeltaPaise ?? 0n, true)!;
    const scopeDeltaJson = dto.scopeDeltaJson ?? {};
    if (typeof scopeDeltaJson !== 'object' || Array.isArray(scopeDeltaJson) ||
        Object.getPrototypeOf(scopeDeltaJson) !== Object.prototype) {
      throw new UnprocessableEntityException({ code: 'INVALID_VARIATION_SCOPE' });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableCommercialProject(client, ctx.orgId, projectId);
      const varId = uuidv7();
      const res = await client.query(
        `INSERT INTO variations (
          id, org_id, project_id, contract_id, variation_ref, title,
          cost_delta_paise, scope_delta_json, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9)
        RETURNING *`,
        [
          varId,
          ctx.orgId,
          projectId,
          contractId,
          dto.variationRef.trim(),
          dto.title.trim(),
          deltaPaise.toString(),
          JSON.stringify(scopeDeltaJson),
          ctx.userId,
        ],
      );
      emit({
        eventType: 'VARIATION_DRAFT_CREATED',
        projectId,
        entityType: 'VARIATION',
        entityId: varId,
        afterJson: { contractId, reference: dto.variationRef.trim(), status: 'DRAFT' },
      });
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
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableCommercialProject(client, ctx.orgId, projectId);
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
      emit({
        eventType: 'PROJECT_SPECIFICATION_ADDED',
        projectId,
        entityType: 'SPECIFICATION_REF',
        entityId: specId,
        afterJson: { specNumber: dto.specNumber.trim(), documentLinked: Boolean(dto.documentId) },
      });
      return res.rows[0];
    });
  }

  /**
   * GET /projects/:id/members
   */
  async listProjectMembers(ctx: TenantActorContext, projectId: string) {
    // G02-007: external guests may view scoped project details, never the
    // internal user identity roster or login identifiers.
    if (ctx.actorType === 'GUEST' || ctx.guestGrantId) throw new NotFoundException('PROJECT_NOT_FOUND');
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
    const permittedRoles = new Set([
      'R-PM', 'R-SITE', 'R-DOC', 'R-PROC', 'R-QC',
      'R-SAFETY', 'R-REVIEWER', 'R-AUDITOR',
    ]);
    if (!dto || typeof dto.userId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.userId) ||
        !permittedRoles.has(dto.role)) {
      throw new UnprocessableEntityException({ code: 'INVALID_PROJECT_MEMBER' });
    }
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      // PH2-G05-004: read the *current* tenant membership and user status.
      // An arbitrary UUID, suspended member or external guest cannot become
      // an ACTIVE project member merely by referencing an ID.
      const { rows: eligible } = await client.query(
        `SELECT m.role FROM memberships m
           JOIN users u ON u.id = m.user_id AND u.status = 'ACTIVE'
          WHERE m.org_id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE'
          FOR SHARE OF m, u`,
        [ctx.orgId, dto.userId],
      );
      if (!eligible.length) {
        throw new UnprocessableEntityException({ code: 'PROJECT_MEMBER_NOT_ELIGIBLE' });
      }
      const orgRole = eligible[0].role;
      if (!['R-OWNER','R-ADMIN'].includes(orgRole) && dto.role !== orgRole) {
        throw new UnprocessableEntityException({ code: 'PROJECT_ROLE_EXCEEDS_MEMBERSHIP' });
      }
      // Match org offboarding's membership-then-project lock ordering. The
      // FOR SHARE locks above preserve eligibility while awaiting the project.
      await this.lockEditableCommercialProject(client, ctx.orgId, projectId);

      const { rows: existing } = await client.query(
        `SELECT id,role,status FROM project_members
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3 FOR UPDATE`,
        [ctx.orgId, projectId, dto.userId],
      );
      if (existing[0]?.status === 'ACTIVE' &&
          ['R-PM','R-OWNER','R-ADMIN'].includes(existing[0].role) && dto.role !== 'R-PM') {
        await this.ensureAnotherActiveProjectManager(client, ctx.orgId, projectId, dto.userId);
      }

      const memberId = existing[0]?.id ?? uuidv7();
      const res = await client.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, added_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (project_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', updated_at = now()
         RETURNING *`,
        [memberId, ctx.orgId, projectId, dto.userId, dto.role, ctx.userId],
      );
      emit({
        eventType: 'PROJECT_MEMBER_ASSIGNED',
        projectId, entityType: 'PROJECT_MEMBER', entityId: res.rows[0].id,
        beforeJson: existing[0] ? { role: existing[0].role, status: existing[0].status } : null,
        afterJson: { role: dto.role, status: 'ACTIVE' },
      });
      return res.rows[0];
    });
  }

  private async ensureAnotherActiveProjectManager(
    client: PoolClient, orgId: string, projectId: string, excludedUserId: string,
  ): Promise<void> {
    const { rows: remaining } = await client.query(
      `SELECT 1 FROM project_members pm
         JOIN memberships m ON m.org_id = pm.org_id AND m.user_id = pm.user_id
         JOIN users u ON u.id = pm.user_id
        WHERE pm.org_id = $1 AND pm.project_id = $2 AND pm.user_id <> $3
          AND pm.status = 'ACTIVE' AND pm.role IN ('R-PM', 'R-OWNER', 'R-ADMIN')
          AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
        LIMIT 1`,
      [orgId, projectId, excludedUserId],
    );
    if (!remaining.length) {
      throw new ConflictException({
        code: 'LAST_PROJECT_MANAGER_REQUIRED',
        detail: 'Assign another active project manager before removing the final manager.',
      });
    }
  }

  /**
   * DELETE /projects/:id/members/:userId
   */
  async removeProjectMember(ctx: TenantActorContext, projectId: string, targetUserId: string) {
    return withTenantTransaction(this.pool, ctx, async (client: PoolClient, emit: (ev: DomainOutboxEvent) => void) => {
      await this.lockEditableCommercialProject(client, ctx.orgId, projectId);
      const { rows: current } = await client.query(
        `SELECT id,role,status FROM project_members
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3 FOR UPDATE`,
        [ctx.orgId, projectId, targetUserId],
      );
      if (!current.length || current[0].status !== 'ACTIVE') {
        throw new NotFoundException('PROJECT_MEMBER_NOT_FOUND');
      }
      if (['R-PM','R-OWNER','R-ADMIN'].includes(current[0].role)) {
        await this.ensureAnotherActiveProjectManager(client, ctx.orgId, projectId, targetUserId);
      }
      const { rows: removed } = await client.query(
        `UPDATE project_members
            SET status = 'REMOVED', updated_at = now()
          WHERE org_id = $1 AND project_id = $2 AND user_id = $3
          RETURNING id`,
        [ctx.orgId, projectId, targetUserId],
      );
      emit({
        eventType: 'PROJECT_MEMBER_REMOVED',
        projectId, entityType: 'PROJECT_MEMBER', entityId: removed[0].id,
        beforeJson: { role: current[0].role, status: 'ACTIVE' },
        afterJson: { role: current[0].role, status: 'REMOVED' },
      });
      return { success: true, removedUserId: targetUserId };
    });
  }

  private async getOrgMaxActiveProjectsLimit(client: any, orgId: string): Promise<number> {
    const { rows } = await client.query(
      `SELECT p.limits_json
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1 AND s.status IN ('TRIAL','ACTIVE')
          AND s.current_period_start <= now() AND s.current_period_end > now()
          AND (s.cancel_at IS NULL OR s.cancel_at > now())
          AND p.status = 'ACTIVE'
        FOR SHARE OF s, p`,
      [orgId],
    );
    // PH2-G18-001: no subscription is no capacity, not an implicit starter plan.
    // Past-due and cancelled accounts retain permitted read/export access, but
    // cannot consume further active project capacity.
    if (rows.length === 0) return 0;
    const configured = rows[0].limits_json?.maxActiveProjects;
    if (typeof configured !== 'number' || !Number.isSafeInteger(configured) || configured < 0) {
      throw new ConflictException({
        code: 'INVALID_PROJECT_ENTITLEMENT',
        detail: 'The subscription has no valid active-project limit.',
      });
    }
    return configured;
  }
}
