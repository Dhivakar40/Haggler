import { z } from 'zod';
import { paiseSchema } from './schemas';

/**
 * Contracts for the customer/employer wallet and payments pipeline (Phase 3 tokens; Phase 9
 * monetization, D-069). Rangers/students/contract workers are never charged anything here — see
 * docs/DECISIONS.md D-037/D-054/D-062. A "token" is consumed only when a job reaches
 * CONFIRMED_BY_CUSTOMER; it is reserved (held) from the moment a request is created.
 */

const uuid = z.string().uuid();

export const WALLET_LEDGER_TYPES = [
  'PURCHASE',
  'HOLD',
  'RELEASE',
  'CONSUME',
  'ADJUSTMENT',
] as const;

export const tokenBundleSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  tokens: z.number().int().positive(),
  pricePaise: paiseSchema,
});
export type TokenBundleDto = z.infer<typeof tokenBundleSchema>;

export const walletLedgerEntrySchema = z.object({
  id: uuid,
  type: z.enum(WALLET_LEDGER_TYPES),
  tokensDelta: z.number().int(),
  jobId: uuid.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type WalletLedgerEntryDto = z.infer<typeof walletLedgerEntrySchema>;

export const walletSchema = z.object({
  balanceTokens: z.number().int().nonnegative(),
  heldTokens: z.number().int().nonnegative(),
  recentLedger: z.array(walletLedgerEntrySchema),
});
export type WalletDto = z.infer<typeof walletSchema>;

export const PAYMENT_PROVIDERS = ['sandbox', 'razorpay'] as const;

/** What a PaymentOrder is for (Phase 9, D-069) — one payment pipeline, four purposes. */
export const PAYMENT_PURPOSES = [
  'TOKEN_TOPUP',
  'PLUS_SUBSCRIPTION',
  'RUSH_FEE',
  'BOOSTED_LISTING',
] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const createTopupOrderSchema = z.object({
  bundleId: uuid,
});
export type CreateTopupOrderInput = z.infer<typeof createTopupOrderSchema>;

/** Returned by every create*Order call (topup, Plus subscribe, rush, boost) — the client always
 * completes it the same way, via /wallet/orders/:orderId/verify or .../sandbox-pay. */
export const paymentOrderStartSchema = z.object({
  orderId: uuid,
  purpose: z.enum(PAYMENT_PURPOSES),
  provider: z.enum(PAYMENT_PROVIDERS),
  providerOrderId: z.string(),
  amountPaise: paiseSchema,
  /** Only meaningful for TOKEN_TOPUP. */
  tokens: z.number().int().positive().nullable(),
  /** Razorpay Checkout key id (public), present only when provider is "razorpay". */
  keyId: z.string().nullable(),
});
export type PaymentOrderStartDto = z.infer<typeof paymentOrderStartSchema>;

/** What the client gets back from Razorpay Checkout on success; sent here to be verified. */
export const verifyPaymentOrderSchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyPaymentOrderInput = z.infer<typeof verifyPaymentOrderSchema>;

export const paymentOrderSchema = z.object({
  id: uuid,
  purpose: z.enum(PAYMENT_PURPOSES),
  itemName: z.string(),
  tokens: z.number().int().positive().nullable(),
  amountPaise: paiseSchema,
  status: z.enum(['CREATED', 'PAID', 'FAILED', 'CANCELLED']),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type PaymentOrderDto = z.infer<typeof paymentOrderSchema>;

export const paymentOrderPageSchema = z.object({
  items: z.array(paymentOrderSchema),
  nextCursor: z.string().nullable(),
});

// ---- Haggler Plus (Phase 9, D-069) -----------------------------------------------------------

export const PLUS_AUDIENCES = ['CUSTOMER', 'EMPLOYER'] as const;
export type PlusAudience = (typeof PLUS_AUDIENCES)[number];

export const plusPlanSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  audience: z.enum(PLUS_AUDIENCES),
  durationDays: z.number().int().positive(),
  pricePaise: paiseSchema,
  /** Basis points off token bundle prices while active; 1000 = 10% off. */
  tokenDiscountBps: z.number().int().nonnegative(),
});
export type PlusPlanDto = z.infer<typeof plusPlanSchema>;

export const subscribePlusSchema = z.object({ planId: uuid });
export type SubscribePlusInput = z.infer<typeof subscribePlusSchema>;

export const plusMembershipSchema = z
  .object({
    planSlug: z.string(),
    planName: z.string(),
    audience: z.enum(PLUS_AUDIENCES),
    tokenDiscountBps: z.number().int().nonnegative(),
    expiresAt: z.string(),
    active: z.boolean(),
  })
  .nullable();
export type PlusMembershipDto = z.infer<typeof plusMembershipSchema>;
