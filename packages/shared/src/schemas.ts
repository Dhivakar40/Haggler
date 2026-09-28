import { z } from 'zod';
import { ERROR_CODES, PRICE_BAND_SCOPES } from './constants';

/** Indian PIN code: 6 digits, first digit 1-9. */
export const pincodeSchema = z
  .string()
  .regex(/^[1-9][0-9]{5}$/, 'Must be a 6-digit Indian PIN code');

/** E.164 Indian mobile number, e.g. +919876543210. */
export const indianPhoneSchema = z
  .string()
  .regex(/^\+91[6-9][0-9]{9}$/, 'Must be an Indian mobile number in +91XXXXXXXXXX format');

/** Money is always integer paise (1 INR = 100 paise). Never floats. */
export const paiseSchema = z.number().int().nonnegative();

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.nativeEnum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const cursorPageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export const priceBandSchema = z.object({
  categorySlug: z.string(),
  scope: z.enum(PRICE_BAND_SCOPES),
  minPaise: paiseSchema,
  medianPaise: paiseSchema,
  maxPaise: paiseSchema,
  sampleSize: z.number().int().nonnegative(),
  isSeededDefault: z.boolean(),
});
export type PriceBandDto = z.infer<typeof priceBandSchema>;

export const ADAPTER_NAMES = ['sms', 'kyc', 'payments', 'calls', 'push', 'maps'] as const;
export type AdapterName = (typeof ADAPTER_NAMES)[number];

export const readinessSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']),
  checks: z.object({ postgres: z.enum(['up', 'down']), redis: z.enum(['up', 'down']) }),
  adapters: z.object({
    sms: z.enum(['sandbox', 'live']),
    kyc: z.enum(['sandbox', 'live']),
    payments: z.enum(['sandbox', 'live']),
    calls: z.enum(['sandbox', 'live']),
    push: z.enum(['sandbox', 'live']),
    maps: z.enum(['sandbox', 'live']),
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const serviceCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameKey: z.string(),
  icon: z.string(),
  requiresLicense: z.boolean(),
});
export type ServiceCategoryDto = z.infer<typeof serviceCategorySchema>;
