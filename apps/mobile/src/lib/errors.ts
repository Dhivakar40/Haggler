import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Turns any thrown error into a message a person can act on, in their language. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'OTP_INVALID':
        return t('auth.otpInvalid');
      case 'RATE_LIMITED':
        return t('auth.wait', { seconds: err.retryAfterSeconds ?? 60 });
      case 'ACCOUNT_UNAVAILABLE':
        return t('auth.accountDeleting');
      case 'VALIDATION_FAILED':
        return t('common.error');
      default:
        return t('common.error');
    }
  }
  // fetch() rejects with a TypeError when the phone is offline or the server is unreachable.
  if (err instanceof TypeError) return t('states.error');
  return t('common.error');
}
