// apps/api/src/common/interceptors/visibility-projection.interceptor.ts
// Field-Level Visibility Projection Interceptor (05 §6.4, AUD-S-24, TC-PTY-02, T03)

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const PROJECTION_ALLOWLIST_KEY = 'PROJECTION_ALLOWLIST';
export const ProjectionAllowlist = (fields: string[]) => SetMetadata(PROJECTION_ALLOWLIST_KEY, fields);

const RESTRICTED_ROLES = new Set([
  'R-CLIENT',
  'R-CONSULTANT',
  'R-CONSULT',
  'R-MC',
  'R-SUPPLIER-OEM',
  'R-SUBCONTRACTOR',
  'GUEST',
]);

// Explicit allowlists for external / restricted roles per known resource type (T03)
export const EXTERNAL_RESOURCE_ALLOWLISTS: Record<string, Set<string>> = {
  project: new Set([
    'id', 'code', 'name', 'status', 'description', 'site_json', 'address', 'city', 'state',
    'created_at', 'updated_at', 'client_name', 'main_contractor_name',
  ]),
  document: new Set([
    'id', 'document_id', 'version_id', 'project_id', 'title', 'category_key', 'doc_type_key',
    'version_no', 'revision_code', 'file_name', 'file_size_bytes', 'mime_type', 'mime',
    'file_status', 'review_status', 'status', 'issue_date', 'expiry_date', 'created_at',
    'updated_at', 'download_url', 'downloadUrl', 'sha256',
  ]),
  requirement: new Set([
    'id', 'requirement_key', 'project_id', 'group_key', 'scope_key', 'title', 'description',
    'doc_type_key', 'mandatory', 'status', 'due_at', 'hasApprovedEvidence', 'has_approved_evidence',
  ]),
  asset: new Set([
    'id', 'tag', 'name', 'project_id', 'category_key', 'make', 'model', 'serial_no',
    'location', 'status', 'warranty_start', 'warranty_end', 'warranty_start_basis',
  ]),
  comment: new Set([
    'id', 'document_version_id', 'author_name', 'comment_text', 'created_at', 'visibility',
  ]),
};

const COMMERCIAL_DENYLIST_PATTERNS = [
  /_paise$/i,
  /_bps$/i,
  /rate/i,
  /price/i,
  /cost/i,
  /margin/i,
  /budget/i,
  /retention/i,
  /internal_/i,
];

@Injectable()
export class VisibilityProjectionInterceptor implements NestInterceptor {
  constructor(private readonly reflector?: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const userCtx = (req as any).userContext;
    const isGuest = Boolean(
      req.auth?.guestGrantId ||
      req.user?.guestGrantId ||
      userCtx?.guestGrantId ||
      userCtx?.actorType === 'GUEST' ||
      userCtx?.isGuest
    );
    const role =
      req.auth?.orgRole ||
      req.user?.orgRole ||
      userCtx?.orgRole ||
      req.auth?.role ||
      req.user?.role ||
      userCtx?.role ||
      (isGuest ? 'GUEST' : undefined);
    const isRestricted = Boolean((role && RESTRICTED_ROLES.has(role)) || isGuest);

    const explicitAllowlist = this.reflector
      ? this.reflector.getAllAndOverride<string[]>(PROJECTION_ALLOWLIST_KEY, [
          context.getHandler(),
          context.getClass(),
        ])
      : undefined;

    return next.handle().pipe(
      map((data) => {
        if (!isRestricted || !data) return data;
        return this.sanitizePayload(data, role || 'GUEST', req.auth?.guestScope, explicitAllowlist);
      }),
    );
  }

  private detectResourceType(data: Record<string, any>): string | null {
    if ('tag' in data && 'category_key' in data) return 'asset';
    if ('requirement_key' in data && 'mandatory' in data) return 'requirement';
    if ('version_no' in data && ('file_status' in data || 'revision_code' in data)) return 'document';
    if ('comment_text' in data && 'visibility' in data) return 'comment';
    if ('code' in data && 'name' in data && ('site_json' in data || 'site' in data || 'status' in data)) return 'project';
    return null;
  }

  private sanitizePayload(data: any, role: string, guestScope?: any, explicitAllowlist?: string[]): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (data instanceof Date) {
      return data.toISOString();
    }

    if (Buffer.isBuffer(data)) {
      return data;
    }

    if (Array.isArray(data)) {
      return data
        .filter((item) => {
          // If guest supplier and item is linked to another supplier
          if ((role === 'R-SUPPLIER-OEM' || role === 'GUEST') && guestScope?.supplierPartyId) {
            if (item && typeof item === 'object' && item.party_id && item.party_id !== guestScope.supplierPartyId) {
              return false;
            }
          }
          return true;
        })
        .map((item) => this.sanitizePayload(item, role, guestScope, explicitAllowlist))
        .filter((item) => item !== null);
    }

    if (data !== null && typeof data === 'object') {
      // Check if this object is a review comment with visibility === 'INTERNAL' (05 §6.4)
      if (data.visibility === 'INTERNAL') {
        return null;
      }

      const sanitized: any = {};
      const allowSet = explicitAllowlist ? new Set(explicitAllowlist) : null;
      const detectedType = this.detectResourceType(data);
      const resourceAllowSet = detectedType ? EXTERNAL_RESOURCE_ALLOWLISTS[detectedType] : null;

      for (const [key, value] of Object.entries(data)) {
        // 1. Explicit route allowlist takes highest precedence
        if (allowSet && !allowSet.has(key)) {
          continue;
        }

        // 2. Resource-level allowlist applies when recognized
        if (!allowSet && resourceAllowSet && !resourceAllowSet.has(key)) {
          continue;
        }

        // 3. Fallback protection against commercial and internal field patterns
        const isCommercialOrInternal = COMMERCIAL_DENYLIST_PATTERNS.some((p) => p.test(key));
        if (isCommercialOrInternal) {
          continue;
        }

        // 4. If comments array, filter out INTERNAL comments
        if (key === 'comments' && Array.isArray(value)) {
          sanitized[key] = value
            .filter((c: any) => c.visibility !== 'INTERNAL')
            .map((c: any) => this.sanitizePayload(c, role, guestScope));
          continue;
        }

        sanitized[key] = this.sanitizePayload(value, role, guestScope);
      }
      return sanitized;
    }

    return data;
  }
}
