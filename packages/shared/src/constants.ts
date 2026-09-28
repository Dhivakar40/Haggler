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

export const CONSENT_PURPOSES = ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'KYC_PROCESSING'] as const;
export type ConsentPurposeName = (typeof CONSENT_PURPOSES)[number];

/**
 * Version of the (placeholder) legal texts users consent to. Bump it when the text changes so
 * everyone is asked again. Texts are placeholders that counsel must replace (COMPLIANCE.md).
 */
export const LEGAL_VERSION = '2026-09-placeholder-1';

export const KYC_DOCUMENT_TYPES = [
  'AADHAAR_FRONT',
  'AADHAAR_BACK',
  'SELFIE',
  'ADDRESS_PROOF',
  'TRADE_LICENSE',
] as const;
export type KycDocumentTypeName = (typeof KYC_DOCUMENT_TYPES)[number];

export const KYC_CHECK_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_INFO',
  'APPROVED',
  'REJECTED',
] as const;
export type KycCheckStatusName = (typeof KYC_CHECK_STATUSES)[number];

export const MAX_EMERGENCY_CONTACTS = 5;
export const MAX_ADDRESSES = 10;
export const MAX_WORKER_CATEGORIES = 5;
export const MIN_ADULT_AGE = 18;

/** Machine-readable error codes returned in the error envelope. */
export const ERROR_CODES = {
  OTP_INVALID: 'OTP_INVALID',
  ACCOUNT_UNAVAILABLE: 'ACCOUNT_UNAVAILABLE',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  UNDERAGE: 'UNDERAGE',
  UNPROCESSABLE: 'UNPROCESSABLE',
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
