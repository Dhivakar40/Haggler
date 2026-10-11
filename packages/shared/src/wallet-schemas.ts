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

/** What a PaymentOrder is for (Phase 9, D-069; Phase Commerce B3 added JOB_PAYMENT). */
export const PAYMENT_PURPOSES = [
  'TOKEN_TOPUP',
  'PLUS_SUBSCRIPTION',
  'RUSH_FEE',
  'BOOSTED_LISTING',
  'JOB_PAYMENT',
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

// ---- Worker wallet (Phase Commerce B3/B4/B6) ---------------------------------------------------

export const WORKER_WALLET_LEDGER_TYPES = [
  'EARNING',
  'FEE_DUE',
  'DUES_SETTLED',
  'WITHDRAWAL',
  'ADJUSTMENT',
] as const;

export const workerWalletLedgerEntrySchema = z.object({
  id: uuid,
  type: z.enum(WORKER_WALLET_LEDGER_TYPES),
  amountPaise: z.number().int(),
  jobId: uuid.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type WorkerWalletLedgerEntryDto = z.infer<typeof workerWalletLedgerEntrySchema>;

export const workerWalletSchema = z.object({
  balancePaise: z.number().int().nonnegative(),
  duesPaise: z.number().int().nonnegative(),
  recentLedger: z.array(workerWalletLedgerEntrySchema),
});
export type WorkerWalletDto = z.infer<typeof workerWalletSchema>;

export const settleDuesSchema = z.object({ amountPaise: z.number().int().positive() });
export type SettleDuesInput = z.infer<typeof settleDuesSchema>;

export const withdrawSchema = z.object({ amountPaise: z.number().int().positive() });
export type WithdrawInput = z.infer<typeof withdrawSchema>;

// ---- Job payments (Phase Commerce B3) ----------------------------------------------------------

export const JOB_PAYMENT_MODES = ['CASH', 'ONLINE'] as const;
export const JOB_PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'MISMATCHED'] as const;

export const jobPaymentSchema = z.object({
  mode: z.enum(JOB_PAYMENT_MODES),
  servicePricePaise: paiseSchema,
  feePaise: paiseSchema,
  totalPaise: paiseSchema,
  cashRecordedPaise: paiseSchema.nullable(),
  cashConfirmedPaise: paiseSchema.nullable(),
  status: z.enum(JOB_PAYMENT_STATUSES),
});
export type JobPaymentDto = z.infer<typeof jobPaymentSchema>;

export const confirmJobSchema = z.object({
  /** Required only when the job's payment mode is CASH: what the customer actually paid. */
  cashConfirmedPaise: paiseSchema.optional(),
});
export type ConfirmJobInput = z.infer<typeof confirmJobSchema>;
