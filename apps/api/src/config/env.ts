import { z } from 'zod';

/**
 * Adapter modes (docs/DECISIONS.md D-016, D-019, D-020, D-021):
 *  - sms:      sandbox (logs the OTP) | live (MSG91)
 *  - kyc:      manual_admin (the only implementation; admins review documents by hand)
 *  - payments: sandbox (in-process fake) | test (real Razorpay API, rzp_test_ keys ONLY)
 *  - calls:    disabled (masked calling is out of scope for now)
 *  - push:     sandbox | live (FCM)
 *  - maps:     sandbox (no geocoding) | osm (OpenStreetMap Nominatim, no key)
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    ADMIN_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** 32 random bytes, base64. Encrypts date of birth and Aadhaar last-4 at rest. */
    FIELD_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
      ),

    /** Global per-IP limit (requests per window). Auth routes have stricter, dedicated limits. */
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

    /** Base URL used in links people share (live trip links). */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    /** Set to false to disable BullMQ maintenance jobs (tests run them by hand). */
    QUEUES_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Set to false to disable the in-process scheduler (tests drive it by hand). */
    SCHEDULER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    S3_ENDPOINT: z.string().url().optional(),
    /** Host used in presigned URLs handed to phones (e.g. your LAN IP). Defaults to S3_ENDPOINT. */
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Set to AES256 (or aws:kms) to require server-side encryption headers on uploads. */
    S3_SSE: z.string().optional(),
    S3_BUCKET_MEDIA: z.string().default('haggler-media'),
    S3_BUCKET_KYC: z.string().default('haggler-kyc'),

    /** QA/testing builds only (D-074): when true, OTP verification also accepts a fixed
     * "123456" code for ANY phone number, alongside the real sandbox/live flow. Never allowed
     * when NODE_ENV=production (refused below, same pattern as the sandbox adapter modes). */
    TESTING_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    SMS_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
    KYC_PROVIDER: z.literal('manual_admin').default('manual_admin'),
    PAYMENTS_MODE: z.enum(['sandbox', 'test']).default('sandbox'),
    CALLS_MODE: z.literal('disabled').default('disabled'),
    PUSH_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
    MAPS_MODE: z.enum(['sandbox', 'osm']).default('sandbox'),

    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    /** HMAC secret the sandbox payments provider signs with (never used when PAYMENTS_MODE=test,
     * and PAYMENTS_MODE=sandbox is refused in production above, so a fixed dev default is safe). */
    PAYMENTS_SANDBOX_SECRET: z.string().default('sandbox-payments-secret-dev-only'),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
    NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
    NOMINATIM_USER_AGENT: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const need = (cond: boolean, key: keyof typeof env, why: string) => {
      if (cond && !env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${String(key)} is required ${why}`,
        });
      }
    };
    need(env.SMS_MODE === 'live', 'MSG91_AUTH_KEY', 'when SMS_MODE=live');
    need(env.SMS_MODE === 'live', 'MSG91_TEMPLATE_ID', 'when SMS_MODE=live');
    need(env.PAYMENTS_MODE === 'test', 'RAZORPAY_KEY_ID', 'when PAYMENTS_MODE=test');
    need(env.PAYMENTS_MODE === 'test', 'RAZORPAY_KEY_SECRET', 'when PAYMENTS_MODE=test');
    need(env.PAYMENTS_MODE === 'test', 'RAZORPAY_WEBHOOK_SECRET', 'when PAYMENTS_MODE=test');
    need(env.PUSH_MODE === 'live', 'FCM_SERVICE_ACCOUNT_JSON', 'when PUSH_MODE=live');
    need(
      env.MAPS_MODE === 'osm',
      'NOMINATIM_USER_AGENT',
      'when MAPS_MODE=osm (Nominatim policy requires an identifying agent)',
    );

    // D-020: no real money anywhere, for now. Test mode must use Razorpay TEST keys.
    if (
      env.PAYMENTS_MODE === 'test' &&
      env.RAZORPAY_KEY_ID &&
      !env.RAZORPAY_KEY_ID.startsWith('rzp_test_')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_KEY_ID'],
        message:
          'Only Razorpay TEST keys (rzp_test_...) are allowed; live payments are not enabled (D-020)',
      });
    }

    // A sandbox adapter in production is a silent way to ship fakes.
    if (env.NODE_ENV === 'production') {
      const sandboxed = (['SMS_MODE', 'PUSH_MODE', 'MAPS_MODE', 'PAYMENTS_MODE'] as const).filter(
        (k) => env[k] === 'sandbox',
      );
      for (const key of sandboxed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key}=sandbox is not allowed when NODE_ENV=production`,
        });
      }
      // A fixed test OTP that works for any phone number must never exist in production (D-074).
      if (env.TESTING_MODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TESTING_MODE'],
          message: 'TESTING_MODE=true is not allowed when NODE_ENV=production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parse and validate raw env once at boot. Fails fast with every problem listed. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}

export function adapterModes(env: Env) {
  return {
    sms: env.SMS_MODE,
    kyc: env.KYC_PROVIDER,
    payments: env.PAYMENTS_MODE,
    calls: env.CALLS_MODE,
    push: env.PUSH_MODE,
    maps: env.MAPS_MODE,
  };
}
