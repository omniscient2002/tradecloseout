// apps/api/src/common/guards/permission.guard.ts
// Positive-only additive permission guard (05 §3.2, RT-004, RT-018)

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { hasPermission } from '@tradecloseout/shared';
import { validateRouteIdentifiers } from './route-identifiers';

export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (permission: string) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector, private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      throw new ForbiddenException({ code: 'PERMISSION_POLICY_REQUIRED' });
    }

    const request = context.switchToHttp().getRequest();
    validateRouteIdentifiers(request.params);
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('UNAUTHENTICATED');
    }

    const isGuest = Boolean(user.guestGrantId || user.actorType === 'GUEST');

    if (isGuest) {
      // FV01: Strictly deny organisation administration to ordinary project guests
      const FORBIDDEN_GUEST_PERMISSIONS = new Set([
        'org.manage',
        'org.delete',
        'org.transfer_ownership',
        'billing.manage',
        'billing.read',
        'party.manage',
        'template.manage',
      ]);
      if (FORBIDDEN_GUEST_PERMISSIONS.has(requiredPermission)) {
        throw new ForbiddenException(`PERMISSION_DENIED: Guests cannot perform organisation administration (${requiredPermission})`);
      }
    }

    // Evaluate effective capabilities
    // FV01: For guests, orgRole and projectRole are strictly undefined so internal member privileges cannot be adopted
    const evaluation = hasPermission(
      {
        orgRole: isGuest ? undefined : user.orgRole,
        projectRole: isGuest ? undefined : user.projectRole,
        guestCapabilities: user.guestCapabilities || [],
        docControllerOrgWideDownload: isGuest ? false : user.docControllerOrgWideDownload,
      },
      requiredPermission,
    );

    if (!evaluation.allowed) {
      throw new ForbiddenException(`PERMISSION_DENIED: Requires ${requiredPermission}`);
    }

    // If scope is Project-scoped ('S'), verify project membership or guest grant scope (TC2-008, PA01)
    const targetProjectId =
      request.params?.projectId ||
      (request.path?.startsWith('/api/v1/projects/') ? request.params?.id : undefined);

    if (user.guestGrantId) {
      let scopedProjectId = targetProjectId;
      if (!scopedProjectId) {
        const route = String(request.route?.path || request.path || '');
        const id = request.params?.versionId || request.params?.documentVersionId ||
          request.params?.requirementId || request.params?.assetId || request.params?.reviewId ||
          request.params?.packageId || request.params?.submissionId || request.params?.id;
        const resourceTables: Array<[string, string]> = [
          ['/document-versions/', 'document_versions'],
          ['/documents/', 'documents'],
          ['/requirements/', 'requirements'],
          ['/assets/', 'assets'],
          ['/reviews/', 'reviews'],
          ['/packages/', 'handover_packages'],
          ['/submissions/', 'submissions'],
        ];
        const resource = resourceTables.find(([fragment]) => route.includes(fragment));
        if (resource && id) {
          const client = await this.pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [user.orgId]);
            await client.query(`SELECT set_config('app.current_user', $1, true)`, [user.userId]);
            const { rows } = await client.query(
              `SELECT project_id FROM ${resource[1]} WHERE org_id = $1 AND id = $2 LIMIT 1`,
              [user.orgId, id],
            );
            scopedProjectId = rows[0]?.project_id;
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw new ForbiddenException({
              code: 'RESOURCE_SCOPE_LOOKUP_FAILED',
              title: 'Resource access could not be verified',
              detail: 'The request was denied because the resource project could not be established.',
            });
          } finally {
            client.release();
          }
        }
      }

      if (scopedProjectId && user.guestProjectId && scopedProjectId !== user.guestProjectId) {
        throw new ForbiddenException({
          code: 'PROJECT_ACCESS_DENIED',
          title: 'Not assigned to project',
          detail: 'You do not have guest access to this project.',
        });
      }
      if (!scopedProjectId) {
        throw new ForbiddenException({
          code: 'PROJECT_SCOPE_REQUIRED',
          title: 'Project scope required',
          detail: 'Guest sessions are restricted to their assigned project.',
        });
      }
    } else if (evaluation.scope === 'S' &&
        user.orgRole !== 'R-OWNER' && user.orgRole !== 'R-ADMIN') {
      let scopedProjectId = targetProjectId;
      if (!scopedProjectId) {
        const route = String(request.route?.path || request.path || '');
        const id = request.params?.versionId || request.params?.documentVersionId ||
          request.params?.requirementId || request.params?.assetId || request.params?.reviewId ||
          request.params?.packageId || request.params?.submissionId || request.params?.id;
        const resourceTables: Array<[string, string]> = [
          ['/document-versions/', 'document_versions'],
          ['/documents/', 'documents'],
          ['/requirements/', 'requirements'],
          ['/assets/', 'assets'],
          ['/reviews/', 'reviews'],
          ['/packages/', 'handover_packages'],
          ['/submissions/', 'submissions'],
        ];
        const resource = resourceTables.find(([fragment]) => route.includes(fragment));
        if (resource && id) {
          const client = await this.pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [user.orgId]);
            await client.query(`SELECT set_config('app.current_user', $1, true)`, [user.userId]);
            const { rows } = await client.query(
              `SELECT project_id FROM ${resource[1]} WHERE org_id = $1 AND id = $2 LIMIT 1`,
              [user.orgId, id],
            );
            scopedProjectId = rows[0]?.project_id;
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw new ForbiddenException({
              code: 'RESOURCE_SCOPE_LOOKUP_FAILED',
              title: 'Resource access could not be verified',
              detail: 'The request was denied because the resource project could not be established.',
            });
          } finally {
            client.release();
          }
        }
      }

      if (scopedProjectId) {
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [user.orgId]);
          await client.query(`SELECT set_config('app.current_user', $1, true)`, [user.userId]);
          const { rows } = await client.query(
            `SELECT 1 FROM project_members
              WHERE org_id = $1 AND project_id = $2 AND user_id = $3 AND status = 'ACTIVE'
              LIMIT 1`,
            [user.orgId, scopedProjectId, user.userId],
          );
          await client.query('COMMIT');
          if (rows.length === 0) {
            throw new ForbiddenException({
              code: 'PROJECT_ACCESS_DENIED',
              title: 'Not assigned to project',
              detail: 'You do not have an active project membership for this resource.',
            });
          }
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (err instanceof ForbiddenException) throw err;
          throw new ForbiddenException({
            code: 'PROJECT_AUTHORITY_LOOKUP_FAILED',
            title: 'Project access could not be verified',
            detail: 'The request was denied because active project membership could not be established.',
          });
        } finally {
          client.release();
        }
      } else if (Array.isArray(request.body?.reviewIds) && request.body.reviewIds.length > 0) {
        const reviewIds = request.body.reviewIds;
        if (reviewIds.length > 100) throw new ForbiddenException('BULK_SCOPE_LIMIT_EXCEEDED');
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.current_org', $1, true), set_config('app.current_org_id', $1, true)`, [user.orgId]);
          await client.query(`SELECT set_config('app.current_user', $1, true)`, [user.userId]);
          const { rows } = await client.query(
            `SELECT count(DISTINCT r.id)::int AS accessible_count
               FROM reviews r
               JOIN project_members pm
                 ON pm.org_id = r.org_id AND pm.project_id = r.project_id
                AND pm.user_id = $3 AND pm.status = 'ACTIVE'
              WHERE r.org_id = $1 AND r.id = ANY($2::uuid[])`,
            [user.orgId, reviewIds, user.userId],
          );
          await client.query('COMMIT');
          if (Number(rows[0]?.accessible_count) !== new Set(reviewIds).size) {
            throw new ForbiddenException('PROJECT_ACCESS_DENIED');
          }
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (err instanceof ForbiddenException) throw err;
          throw new ForbiddenException('BULK_SCOPE_LOOKUP_FAILED');
        } finally {
          client.release();
        }
      } else if (request.method !== 'GET' || targetProjectId || request.params?.id || request.params?.versionId ||
                 request.params?.reviewId || request.params?.requirementId) {
        throw new ForbiddenException({
          code: 'RESOURCE_SCOPE_UNRESOLVED',
          title: 'Resource access could not be verified',
          detail: 'The request was denied because its project scope could not be established.',
        });
      }
    }

    // Attach permission scope to request for downstream resource-level checks
    request.permissionScope = evaluation.scope;
    return true;
  }
}
