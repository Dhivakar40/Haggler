import { z } from 'zod';
import { paiseSchema } from './schemas';

/**
 * Contracts for the customer token wallet (Phase 3). Rangers are never charged anything here —
 * see docs/DECISIONS.md D-037. A "token" is consumed only when a job reaches
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

export const createTopupOrderSchema = z.object({
  bundleId: uuid,
});
export type CreateTopupOrderInput = z.infer<typeof createTopupOrderSchema>;

export const topupOrderSchema = z.object({
  orderId: uuid,
  provider: z.enum(PAYMENT_PROVIDERS),
  providerOrderId: z.string(),
  amountPaise: paiseSchema,
  tokens: z.number().int().positive(),
  /** Razorpay Checkout key id (public), present only when provider is "razorpay". */
  keyId: z.string().nullable(),
});
export type TopupOrderDto = z.infer<typeof topupOrderSchema>;

/** What the client gets back from Razorpay Checkout on success; sent here to be verified. */
export const verifyTopupSchema = z.object({
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});
export type VerifyTopupInput = z.infer<typeof verifyTopupSchema>;

export const paymentOrderSchema = z.object({
  id: uuid,
  bundleName: z.string(),
  tokens: z.number().int().positive(),
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
