import { z } from 'zod';

/** Every third-party adapter runs in "sandbox" (fake) or "live" (real vendor) mode. */
export const ADAPTER_MODES = ['sandbox', 'live'] as const;
const adapterMode = z.enum(ADAPTER_MODES).default('sandbox');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('ap-south-1'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET_MEDIA: z.string().default('haggler-media'),
    S3_BUCKET_KYC: z.string().default('haggler-kyc'),

    SMS_MODE: adapterMode,
    KYC_MODE: adapterMode,
    PAYMENTS_MODE: adapterMode,
    CALLS_MODE: adapterMode,
    PUSH_MODE: adapterMode,
    MAPS_MODE: adapterMode,

    MSG91_AUTH_KEY: z.string().optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    EXOTEL_SID: z.string().optional(),
    EXOTEL_API_KEY: z.string().optional(),
    EXOTEL_API_TOKEN: z.string().optional(),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Refuse to boot in "live" mode without the credentials that mode needs.
    const requireWhenLive = (
      mode: (typeof ADAPTER_MODES)[number],
      adapter: string,
      keys: (keyof typeof env)[],
    ) => {
      if (mode !== 'live') return;
      for (const key of keys) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${String(key)} is required when ${adapter}_MODE=live`,
          });
        }
      }
    };
    requireWhenLive(env.SMS_MODE, 'SMS', ['MSG91_AUTH_KEY']);
    requireWhenLive(env.PAYMENTS_MODE, 'PAYMENTS', [
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ]);
    requireWhenLive(env.CALLS_MODE, 'CALLS', ['EXOTEL_SID', 'EXOTEL_API_KEY', 'EXOTEL_API_TOKEN']);
    requireWhenLive(env.PUSH_MODE, 'PUSH', ['FCM_SERVICE_ACCOUNT_JSON']);
    requireWhenLive(env.MAPS_MODE, 'MAPS', ['GOOGLE_MAPS_API_KEY']);

    // A sandbox adapter in production is a silent way to ship fake payments/KYC.
    if (env.NODE_ENV === 'production') {
      const sandboxed = (
        ['SMS_MODE', 'KYC_MODE', 'PAYMENTS_MODE', 'CALLS_MODE', 'PUSH_MODE', 'MAPS_MODE'] as const
      ).filter((k) => env[k] === 'sandbox');
      for (const key of sandboxed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key}=sandbox is not allowed when NODE_ENV=production`,
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
    kyc: env.KYC_MODE,
    payments: env.PAYMENTS_MODE,
    calls: env.CALLS_MODE,
    push: env.PUSH_MODE,
    maps: env.MAPS_MODE,
  };
}
