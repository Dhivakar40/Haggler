/** OTP and session policy. One place, so tests and docs quote the same numbers. */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300; // 5 minutes (spec D1)
export const OTP_MAX_VERIFY_TRIES = 5; // per code
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_SENDS_PER_PHONE_PER_HOUR = 5;
export const OTP_SENDS_PER_IP_PER_HOUR = 20;
/** Lockout: this many wrong codes for one phone inside the window blocks that phone. */
export const OTP_LOCKOUT_FAILURES = 10;
export const OTP_LOCKOUT_WINDOW_SECONDS = 1800; // 30 minutes
export const HOUR_SECONDS = 3600;
export const JWT_ISSUER = 'haggler-api';
export const JWT_AUDIENCE_USER = 'haggler-user';
export const JWT_AUDIENCE_ADMIN = 'haggler-admin';
