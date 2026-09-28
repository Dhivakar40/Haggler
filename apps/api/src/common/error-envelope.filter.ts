import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from '@haggler/shared';
import type { Request, Response } from 'express';

/** Map an HTTP status to our stable machine-readable code. */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return ERROR_CODES.VALIDATION_FAILED;
    case 401:
      return ERROR_CODES.UNAUTHENTICATED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 429:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return ERROR_CODES.INTERNAL;
  }
}

/**
 * Every error leaves the API as { error: { code, message, details?, requestId } }.
 * Unknown errors are logged with the stack but the client only sees a generic message,
 * so internals (SQL, file paths) never leak.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string | number }>();
    const requestId = req.id !== undefined ? String(req.id) : undefined;

    const { status, code, message, details } = this.normalise(exception);

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    const body: ErrorEnvelope = { error: { code, message, details, requestId } };
    res.status(status).json(body);
  }

  private normalise(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      // Nest's ValidationPipe puts the field messages in response.message (string[]).
      if (typeof response === 'object' && response !== null) {
        const r = response as { message?: string | string[]; details?: unknown; error?: string };
        if (Array.isArray(r.message)) {
          return {
            status,
            code: codeForStatus(status),
            message: 'Request validation failed',
            details: r.message,
          };
        }
        return {
          status,
          code: codeForStatus(status),
          message: r.message ?? exception.message,
          details: r.details,
        };
      }
      return { status, code: codeForStatus(status), message: String(response) };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return {
        status: HttpStatus.CONFLICT,
        code: ERROR_CODES.CONFLICT,
        message: 'A record with these values already exists',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL,
      message: 'Something went wrong on our side',
    };
  }
}
