import i18n from '../i18n';
import { ApiError } from '../api/client';
import { errorMessage } from './errors';

const t = i18n.t.bind(i18n);

describe('errorMessage', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('maps server codes to friendly text', () => {
    expect(errorMessage(new ApiError(400, 'OTP_INVALID', 'x'), t)).toBe(
      'That code is incorrect or has expired.',
    );
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', 'x', { retryAfterSeconds: 25 }), t)).toBe(
      'Too many attempts. Try again in 25 seconds.',
    );
    expect(errorMessage(new ApiError(403, 'ACCOUNT_UNAVAILABLE', 'x'), t)).toBe(
      'This account is scheduled for deletion.',
    );
  });

  it('a network failure (fetch TypeError) says to check the connection', () => {
    expect(errorMessage(new TypeError('Network request failed'), t)).toBe(
      'Could not load this. Check your connection.',
    );
  });

  it('never leaks server internals for unknown errors', () => {
    expect(errorMessage(new ApiError(500, 'INTERNAL', 'SQL exploded at db.internal'), t)).toBe(
      'Something went wrong. Please try again.',
    );
    expect(errorMessage(new Error('boom'), t)).toBe('Something went wrong. Please try again.');
  });

  it('is localised', async () => {
    await i18n.changeLanguage('hi');
    expect(errorMessage(new ApiError(400, 'OTP_INVALID', 'x'), t)).toBe(
      'यह कोड गलत है या समाप्त हो चुका है।',
    );
    await i18n.changeLanguage('en');
  });
});
