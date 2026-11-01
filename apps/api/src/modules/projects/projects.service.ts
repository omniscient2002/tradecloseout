// apps/api/src/modules/projects/projects.service.ts
// Projects, Contracts, Specifications & Plan Usage Locking (API-030..044, AUD-A-08, FR-PRJ-003, FR-PRJ-004, CB-001)

import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { uuidv7 } from 'uuidv7';
import { TenantDbService, ExecutionContext } from '../../database/tenant-db.service';
import { ProjectStatus } from '@tradecloseout/shared';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: TenantDbService) {}

  /**
   * API-031 POST /projects (Plan limits checked under FOR UPDATE lock)
   */
  async createProject(
    ctx: ExecutionContext,
    dto: { code: string; name: string; projectType?: string; clientPartyId?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      // 1. Lock and check usage counter (AUD-A-08)
      const counterRes = await client.query(
        `SELECT value FROM usage_counters
         WHERE org_id = $1 AND metric = 'ACTIVE_PROJECTS' AND period = 'ALL_TIME'
         FOR UPDATE`,
        [ctx.orgId],
      );

      const activeProjects = counterRes.rows.length ? Number(counterRes.rows[0].value) : 0;
      const maxAllowed = 10; // Starter tier limit

      if (activeProjects >= maxAllowed) {
        throw new ConflictException('PLAN_LIMIT_BLOCKED: Maximum active projects reached');
      }

      // 2. Insert Project conforming exactly to SQL schema (CB-001)
      const projectId = uuidv7();
      const insertRes = await client.query(
        `INSERT INTO projects (
          id, org_id, code, name, project_type, client_party_id, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          projectId,
          ctx.orgId,
          dto.code.trim().toUpperCase(),
          dto.name.trim(),
          dto.projectType || 'PRIVATE_COMMERCIAL',
          dto.clientPartyId || null,
          ProjectStatus.DRAFT,
          ctx.userId,
        ],
      );

      // Add creator as Project PM with added_by (CB-001)
      await client.query(
        `INSERT INTO project_members (id, org_id, project_id, user_id, role, added_by, status)
         VALUES ($1, $2, $3, $4, 'R-PM', $5, 'ACTIVE')`,
        [uuidv7(), ctx.orgId, projectId, ctx.userId, ctx.userId],
      );

      return insertRes.rows[0];
    });
  }

  /**
   * API-033 PATCH /projects/:id (FR-PRJ-004, TC-PRJ-02)
   */
  async updateProject(
    ctx: ExecutionContext,
    projectId: string,
    dto: { name?: string; code?: string; clientPartyId?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      const proj = projRes.rows[0];

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
        if (proj.status !== ProjectStatus.DRAFT) {
          throw new ConflictException({
            code: 'PROJECT_CODE_IMMUTABLE',
            title: 'Project code cannot be changed',
            detail: 'Project code is immutable once the project is activated.',
          });
        }
      }

      const updatedRes = await client.query(
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

      return updatedRes.rows[0];
    });
  }

  /**
   * API-034 POST /projects/:id/activate (FR-PRJ-003, TC-PRJ-01)
   */
  async activateProject(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const projRes = await client.query(
        `SELECT * FROM projects WHERE org_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.orgId, projectId],
      );
      if (!projRes.rows.length) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }
      const proj = projRes.rows[0];

      if (proj.status !== ProjectStatus.DRAFT) {
        throw new ConflictException(`INVALID_STATE_TRANSITION: Cannot activate project in status ${proj.status}`);
      }

      // TC-PRJ-01: Activating without at least one managing member fails (FR-PRJ-003)
      const memberRes = await client.query(
        `SELECT id FROM project_members
          WHERE org_id = $1 AND project_id = $2 AND status = 'ACTIVE' AND role IN ('R-PM', 'R-ADMIN', 'R-OWNER')`,
        [ctx.orgId, projectId],
      );
      if (memberRes.rows.length === 0) {
        throw new UnprocessableEntityException({
          code: 'ACTIVATION_BLOCKED_NO_MANAGER',
          title: 'Project manager required',
          detail: 'Assign at least one project manager before activating the project.',
        });
      }

      // Increment active projects usage counter
      await client.query(
        `INSERT INTO usage_counters (id, org_id, metric, period, value)
         VALUES ($1, $2, 'ACTIVE_PROJECTS', 'ALL_TIME', 1)
         ON CONFLICT (org_id, metric, period)
         DO UPDATE SET value = usage_counters.value + 1`,
        [uuidv7(), ctx.orgId],
      );

      // Transition project status to ACTIVE
      const updatedRes = await client.query(
        `UPDATE projects
         SET status = $1, updated_at = now(), row_version = row_version + 1
         WHERE org_id = $2 AND id = $3
         RETURNING *`,
        [ProjectStatus.ACTIVE, ctx.orgId, proj.id],
      );

      return updatedRes.rows[0];
    });
  }

  /**
   * POST /projects/:id/suspend
   */
  async suspendProject(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE projects
            SET status = 'SUSPENDED', updated_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND id = $2 AND status = 'ACTIVE'
          RETURNING *`,
        [ctx.orgId, projectId],
      );
      if (!res.rows.length) throw new NotFoundException('PROJECT_NOT_FOUND_OR_NOT_ACTIVE');
      return res.rows[0];
    });
  }

  /**
   * POST /projects/:id/close
   */
  async closeProject(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
      const res = await client.query(
        `UPDATE projects
            SET status = 'CLOSED', updated_at = now(), row_version = row_version + 1
          WHERE org_id = $1 AND id = $2 AND status IN ('ACTIVE', 'HANDOVER')
          RETURNING *`,
        [ctx.orgId, projectId],
      );
      if (!res.rows.length) throw new NotFoundException('PROJECT_NOT_FOUND');
      return res.rows[0];
    });
  }

  /**
   * API-030 GET /projects
   */
  async listProjects(ctx: ExecutionContext) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
  async getProject(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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

  /**
   * API-035 GET /projects/:id/contracts
   */
  async listContracts(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
    ctx: ExecutionContext,
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
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
    ctx: ExecutionContext,
    projectId: string,
    contractId: string,
    dto: { variationRef: string; title: string; costDeltaPaise: number | bigint; scopeDeltaJson?: any },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
  async listSpecifications(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
    ctx: ExecutionContext,
    projectId: string,
    dto: { specNumber: string; title: string; division?: string; documentId?: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
  async listProjectMembers(ctx: ExecutionContext, projectId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
    ctx: ExecutionContext,
    projectId: string,
    dto: { userId: string; role: string },
  ) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
  async removeProjectMember(ctx: ExecutionContext, projectId: string, targetUserId: string) {
    return this.db.withTenantContext(ctx, async (client: PoolClient) => {
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
}
