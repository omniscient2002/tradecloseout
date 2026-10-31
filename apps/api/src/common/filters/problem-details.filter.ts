// apps/api/src/common/filters/problem-details.filter.ts
// RFC 9457 Problem Details Exception Filter (Invariant 1)

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected error occurred';
    let code = 'INTERNAL_ERROR';
    let invalidParams: any[] | undefined = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();
      if (typeof res === 'string') {
        detail = res;
      } else if (typeof res === 'object' && res !== null) {
        detail = res.message || res.detail || exception.message;
        code = res.code || res.error || 'HTTP_ERROR';
        if (Array.isArray(res.message)) {
          invalidParams = res.message.map((m: string) => ({ reason: m }));
          detail = 'Validation failed';
        }
      }
      title = exception.name.replace(/Exception$/, '');
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const problem = {
      type: `https://tradecloseout.com/errors/${code.toLowerCase()}`,
      title,
      status,
      detail,
      instance: request.url,
      code,
      invalidParams,
      timestamp: new Date().toISOString(),
    };

    response
      .status(status)
      .contentType('application/problem+json')
      .json(problem);
  }
}
