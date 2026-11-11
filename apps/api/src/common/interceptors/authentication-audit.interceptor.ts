import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Pool } from 'pg';
import { Observable, from } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { recordDeniedAuthenticationEvent } from '../../modules/identity/auth-security';

@Injectable()
export class AuthenticationAuditInterceptor implements NestInterceptor {
  constructor(private readonly pool:Pool) {}
  intercept(context:ExecutionContext,next:CallHandler):Observable<unknown> {
    const req=context.switchToHttp().getRequest();
    if(!/^\/api\/v1\/(?:auth|guest)(?:\/|$)/.test(req.path||''))return next.handle();
    return next.handle().pipe(catchError(error=>from(this.recordAndReject(req,error))));
  }
  private async recordAndReject(req:any,error:unknown):Promise<never> {
    // Guard failures have their own independent audit path; this catches
    // origin/intent, public guest, validation and transactional controller
    // failures after rollback. No exception, body, URL or header is persisted.
    await recordDeniedAuthenticationEvent(this.pool,'AUTH_ROUTE_DENIED',{
      userId:req.auth?.userId,orgId:req.auth?.activeOrgId,sessionId:req.auth?.sessionId,
      sourceIp:typeof req.ip==='string'?req.ip:undefined,
      reasonCode:'AUTH_OPERATION_REJECTED',
    });
    throw error;
  }
}
