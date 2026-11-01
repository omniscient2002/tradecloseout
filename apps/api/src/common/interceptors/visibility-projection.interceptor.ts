// apps/api/src/common/interceptors/visibility-projection.interceptor.ts
// Field-Level Visibility Projection Interceptor (05 §6.4, AUD-S-24, TC-PTY-02)

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const RESTRICTED_ROLES = new Set(['R-CLIENT', 'R-MC', 'R-SUPPLIER-OEM', 'GUEST']);

const COMMERCIAL_FIELDS = new Set([
  'value_paise',
  'retention_bps',
  'commercial_rate',
  'unit_rate_paise',
  'contract_sum_paise',
  'subtotal_paise',
  'tax_paise',
  'total_paise',
]);

@Injectable()
export class VisibilityProjectionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const role = req.auth?.orgRole || req.user?.orgRole || (req.auth?.guestGrantId ? 'GUEST' : undefined);
    const isRestricted = role && RESTRICTED_ROLES.has(role);

    return next.handle().pipe(
      map((data) => {
        if (!isRestricted || !data) return data;
        return this.sanitizePayload(data, role, req.auth?.guestScope);
      }),
    );
  }

  private sanitizePayload(data: any, role: string, guestScope?: any): any {
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
        .map((item) => this.sanitizePayload(item, role, guestScope))
        .filter((item) => item !== null);
    }

    if (data !== null && typeof data === 'object') {
      // Check if this object is a review comment with visibility === 'INTERNAL' (05 §6.4)
      if (data.visibility === 'INTERNAL') {
        return null;
      }

      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        // Redact commercial / financial rates
        if (COMMERCIAL_FIELDS.has(key)) {
          continue;
        }

        // If comments array, filter out INTERNAL comments
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
