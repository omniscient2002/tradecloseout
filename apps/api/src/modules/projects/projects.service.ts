// apps/api/src/modules/projects/projects.service.ts
// Projects & Plan Usage Locking (API-031, AUD-A-08, FR-PRJ-003, CB-001)

import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
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
          dto.code,
          dto.name,
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
   * API-034 POST /projects/:id/activate (FR-PRJ-003)
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
}
