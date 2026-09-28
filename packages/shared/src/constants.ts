/**
 * Internal role identifiers. The database and API use `WORKER`; every user-facing
 * string calls this role "Ranger" (see USER_FACING_ROLE_LABEL and docs/DECISIONS.md D-003).
 */
export const USER_ROLES = ['CUSTOMER', 'WORKER', 'EMPLOYER', 'STUDENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_FACING_ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  WORKER: 'Ranger',
  EMPLOYER: 'Employer',
  STUDENT: 'Student',
};

export const ADMIN_ROLES = ['KYC_REVIEWER', 'DISPUTE_AGENT', 'FINANCE', 'SUPER_ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Supported UI languages at launch. */
export const SUPPORTED_LANGUAGES = ['en', 'hi', 'ta', 'kn', 'te'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** Job lifecycle (D3). Transitions are enforced server-side in Phase 2. */
export const JOB_STATES = [
  'requested',
  'broadcasting',
  'matched',
  'negotiating',
  'agreed',
  'en_route',
  'arrived',
  'in_progress',
  'completed_by_worker',
  'confirmed_by_customer',
  'cancelled',
  'no_show_worker',
  'no_show_customer',
  'disputed',
  'refunded',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export const BADGE_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

/** Where a price band came from, best to worst (D3 fallback chain). */
export const PRICE_BAND_SCOPES = ['PINCODE_CLUSTER', 'CITY', 'DEFAULT'] as const;
export type PriceBandScope = (typeof PRICE_BAND_SCOPES)[number];

/** Machine-readable error codes returned in the error envelope. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
