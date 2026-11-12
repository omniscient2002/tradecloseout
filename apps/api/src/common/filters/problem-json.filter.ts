import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  fieldErrors: Array<{ field: string; message: string }>;
}

@Catch()
export class ProblemJsonExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) || 'req_unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let title = 'Unexpected server error';
    let detail = 'An unexpected error occurred. Quote the requestId if contacting support.';
    let retryable = false;
    let retryAfterSeconds: number | undefined;
    let fieldErrors: Array<{ field: string; message: string }> = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as Record<string, any> | string;

      if (typeof body === 'object' && body !== null) {
        code = body.code || this.defaultCodeForStatus(status);
        title = body.title || this.defaultTitleForStatus(status);
        if (Array.isArray(body.message)) {
          fieldErrors = body.message.map((msg: string) => ({
            field: typeof msg === 'string' ? msg.split(' ')[0] : 'field',
            message: msg,
          }));
          detail = 'Request payload validation failed.';
        } else {
          detail = body.detail || body.message || detail;
          fieldErrors = Array.isArray(body.fieldErrors) ? body.fieldErrors : [];
        }
        retryable = Boolean(body.retryable ?? (status === 429 || status === 503));
        retryAfterSeconds = body.retryAfterSeconds;
      } else if (typeof body === 'string') {
        code = this.defaultCodeForStatus(status);
        title = this.defaultTitleForStatus(status);
        detail = body;
      }
    } else if (exception instanceof Error) {
      // Map known domain / database error codes without leaking SQL details (10 §4)
      const anyErr = exception as any;
      if (anyErr.code === 'PLAN_LIMIT_EXCEEDED') {
        status = HttpStatus.CONFLICT;
        code = 'PLAN_LIMIT_EXCEEDED';
        title = 'Plan limit reached';
        detail = exception.message;
      } else if (anyErr.code === 'AUTH_SESSION_CONTEXT_CHANGED') {
        // The guard may have admitted the request before a concurrent
        // revocation/offboarding. This is a current-authority denial, not a
        // storage failure, credential expiry or an unhandled HTTP 500. Do not
        // disclose which eligibility row was removed.
        status = HttpStatus.FORBIDDEN;
        code = 'AUTH_SESSION_CONTEXT_CHANGED';
        title = 'Access has changed';
        detail = 'The current session is no longer authorized for this action.';
      } else {
        this.logger.error(
          { requestId, err: exception.message, stack: exception.stack },
          'Unhandled internal exception',
        );
      }
    }

    const slug = code.toLowerCase().replace(/_/g, '-');
    const problem: ProblemDetails = {
      type: `https://errors.tradecloseout.in/${slug}`,
      title,
      status,
      code,
      detail,
      requestId,
      retryable,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      fieldErrors,
    };

    if (retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
    }
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Content-Type', 'application/problem+json');
    res.status(status).json(problem);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case 400: return 'VALIDATION_FAILED';
      case 401: return 'UNAUTHENTICATED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 412: return 'PRECONDITION_FAILED';
      case 413: return 'FILE_TOO_LARGE';
      case 422: return 'METADATA_INCOMPLETE';
      case 429: return 'RATE_LIMITED';
      case 503: return 'DEPENDENCY_UNAVAILABLE';
      default:  return 'INTERNAL_ERROR';
    }
  }

  private defaultTitleForStatus(status: number): string {
    switch (status) {
      case 400: return 'Validation failed';
      case 401: return 'Authentication required';
      case 403: return 'Action not permitted';
      case 404: return 'Resource not found';
      case 409: return 'State or version conflict';
      case 412: return 'Precondition failed (If-Match mismatch)';
      case 413: return 'File exceeds size limit';
      case 422: return 'Semantically invalid request';
      case 429: return 'Too many requests';
      case 503: return 'Service dependency unavailable';
      default:  return 'Internal server error';
    }
  }
}
