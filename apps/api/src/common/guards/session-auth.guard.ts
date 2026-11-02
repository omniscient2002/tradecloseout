// apps/api/src/common/guards/session-auth.guard.ts
// Session Authentication, CSRF & Tenant Context Guard (CB-009, AUD-014)

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AuthService } from '../../modules/auth/auth.service';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Extract session token
    const token =
      req.cookies?.['tc_session'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!token) {
      throw new UnauthorizedException('SESSION_MISSING: Authentication required');
    }

    // 2. Fetch session from database
    const session = await this.authService.getSessionByToken(token);
    if (!session) {
      throw new UnauthorizedException('SESSION_INVALID: Session has expired or is invalid');
    }

    // 3. Verify CSRF token on mutating requests
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader) {
        throw new ForbiddenException('CSRF_TOKEN_MISSING: X-CSRF-Token required');
      }
      const incomingHash = crypto.createHash('sha256').update(csrfHeader as string).digest('hex');
      if (incomingHash !== session.csrf_token_hash) {
        throw new ForbiddenException('CSRF_TOKEN_MISMATCH');
      }
    }

    // 4. Verify Route Tenant Context Isolation (AUD-014)
    if (req.params?.orgId === 'current' && session.active_org_id) {
      req.params.orgId = session.active_org_id;
    }
    if (req.params?.orgId && session.active_org_id && req.params.orgId !== session.active_org_id) {
      throw new ForbiddenException('CROSS_TENANT_ACCESS_FORBIDDEN: Session not scoped to requested organisation');
    }

    // 5. Populate user and tenant context for controllers & PermissionGuard
    req.user = {
      userId: session.user_id,
      name: session.user_name,
      orgId: session.active_org_id,
      orgRole: session.org_role,
      docControllerOrgWideDownload: false,
    };

    req.userContext = {
      orgId: session.active_org_id,
      userId: session.user_id,
      actorType: session.guest_grant_id ? 'GUEST' : 'USER',
      requestId: (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    };

    return true;
  }
}
