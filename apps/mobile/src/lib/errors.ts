import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** Turns any thrown error into a message a person can act on, in their language. */
export function errorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    // Domain-specific codes (e.g. REQUEST_TAKEN, NOT_AT_LOCATION) have their own translated messages.
    const details = err.details as { code?: string; distanceM?: number } | undefined;
    if (details?.code) {
      const msg = t(`apiErrors.${details.code}`, { defaultValue: '', distance: details.distanceM });
      if (msg) return msg;
    }
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
  // fetch() rejects with a TypeError when the phone is offline or the server is unreachable, and
  // with an AbortError (a DOMException) when our own request timeout fires, e.g. a slow cold
  // start on a hosted free-tier backend. Both are connectivity issues, not app bugs.
  if (err instanceof TypeError) return t('states.error');
  if (err instanceof Error && err.name === 'AbortError') return t('states.error');
  return t('common.error');
}
