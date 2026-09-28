import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@haggler/shared';

/** HttpException carrying a stable machine-readable `code` (the filter puts it in the envelope). */
export class CodedException extends HttpException {
  constructor(status: HttpStatus, code: ErrorCode, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export class RateLimitedException extends CodedException {
  constructor(
    retryAfterSeconds: number,
    message = 'Too many attempts. Please wait and try again.',
  ) {
    super(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED, message, {
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    });
  }
}

export const otpInvalid = () =>
  new CodedException(
    HttpStatus.BAD_REQUEST,
    ERROR_CODES.OTP_INVALID,
    'That code is incorrect or has expired.',
  );

export const unauthenticated = (message = 'Please sign in again.') =>
  new CodedException(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, message);

export const forbidden = (message = 'You are not allowed to do that.') =>
  new CodedException(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN, message);

export const notFound = (message = 'Not found') =>
  new CodedException(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);

export const conflict = (message: string, details?: unknown) =>
  new CodedException(HttpStatus.CONFLICT, ERROR_CODES.CONFLICT, message, details);

export const unprocessable = (
  message: string,
  details?: unknown,
  code: ErrorCode = ERROR_CODES.UNPROCESSABLE,
) => new CodedException(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
