import { z } from 'zod';
import { CITY_TIERS, ERROR_CODES, PRICE_BAND_SCOPES } from './constants';

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
    sms: z.string(),
    kyc: z.string(),
    payments: z.string(),
    calls: z.string(),
    push: z.string(),
    maps: z.string(),
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const serviceCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nameKey: z.string(),
  icon: z.string(),
  requiresLicense: z.boolean(),
  /// D-080 (A2): non-null means "uncertain scope" — the customer books this fixed inspection
  /// charge instead of a catalogue price, and add-ons come later via JobAddOn.
  inspectionChargePaise: paiseSchema.nullable(),
});
export type ServiceCategoryDto = z.infer<typeof serviceCategorySchema>;

// ---- Price list (D-080, Sub-phase A) ---------------------------------------------------

export const priceListEntrySchema = z.object({
  id: z.string().uuid(),
  categorySlug: z.string(),
  cityTier: z.enum(CITY_TIERS),
  pricePaise: paiseSchema,
  needsSurvey: z.boolean(),
  isActive: z.boolean(),
});
export type PriceListEntryDto = z.infer<typeof priceListEntrySchema>;

export const priceListAddOnSchema = z.object({
  id: z.string().uuid(),
  categorySlug: z.string(),
  name: z.string(),
  pricePaise: paiseSchema,
  isActive: z.boolean(),
});
export type PriceListAddOnDto = z.infer<typeof priceListAddOnSchema>;

/** Admin create/update of one (category, city tier) price. `needsSurvey` defaults to false here
 * — an admin setting a price explicitly is, by definition, no longer using a placeholder. */
export const adminPriceListEntryUpsertSchema = z.object({
  categoryId: z.string().uuid(),
  cityTier: z.enum(CITY_TIERS).default('DEFAULT'),
  pricePaise: z.number().int().min(1).max(100_000_00),
  needsSurvey: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});
export type AdminPriceListEntryUpsertInput = z.infer<typeof adminPriceListEntryUpsertSchema>;

export const adminPriceListAddOnUpsertSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  pricePaise: z.number().int().min(1).max(100_000_00),
  isActive: z.boolean().optional().default(true),
});
export type AdminPriceListAddOnUpsertInput = z.infer<typeof adminPriceListAddOnUpsertSchema>;

/** Admin set/clear of a category's fixed inspection charge (A2). Null clears it, putting the
 * category back on the normal fixed-price list. */
export const adminInspectionChargeSchema = z.object({
  inspectionChargePaise: z.number().int().min(1).max(100_000_00).nullable(),
});
export type AdminInspectionChargeInput = z.infer<typeof adminInspectionChargeSchema>;
