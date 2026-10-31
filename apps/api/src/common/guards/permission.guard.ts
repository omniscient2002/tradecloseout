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
import { hasPermission } from '@tradecloseout/shared';

export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (permission: string) => SetMetadata(REQUIRE_PERMISSION_KEY, permission);

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true; // No permission required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('UNAUTHENTICATED');
    }

    // Evaluate effective capabilities
    const evaluation = hasPermission(
      {
        orgRole: user.orgRole,
        projectRole: user.projectRole,
        guestCapabilities: user.guestCapabilities,
        docControllerOrgWideDownload: user.docControllerOrgWideDownload,
      },
      requiredPermission,
    );

    if (!evaluation.allowed) {
      throw new ForbiddenException(`PERMISSION_DENIED: Requires ${requiredPermission}`);
    }

    // Attach permission scope to request for downstream resource-level checks
    request.permissionScope = evaluation.scope;
    return true;
  }
}
