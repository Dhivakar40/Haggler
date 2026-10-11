import { useQuery } from '@tanstack/react-query';
import {
  type CreateTopupOrderInput,
  paymentOrderPageSchema,
  paymentOrderStartSchema,
  type PlusAudience,
  plusMembershipSchema,
  plusPlanSchema,
  type SubscribePlusInput,
  tokenBundleSchema,
  type VerifyPaymentOrderInput,
  walletSchema,
  workerWalletSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { apiRequest } from './client';

export const getWallet = () => apiRequest('/v1/wallet', { schema: walletSchema });
export const getBundles = () =>
  apiRequest('/v1/wallet/bundles', { schema: z.array(tokenBundleSchema) });
export const getOrders = (cursor?: string) =>
  apiRequest(`/v1/wallet/orders?limit=20${cursor ? `&cursor=${cursor}` : ''}`, {
    schema: paymentOrderPageSchema,
  });

export const createTopupOrder = (input: CreateTopupOrderInput) =>
  apiRequest('/v1/wallet/topup', { method: 'POST', body: input, schema: paymentOrderStartSchema });
export const subscribePlus = (input: SubscribePlusInput) =>
  apiRequest('/v1/wallet/plus/subscribe', {
    method: 'POST',
    body: input,
    schema: paymentOrderStartSchema,
  });
export const verifyOrder = (orderId: string, input: VerifyPaymentOrderInput) =>
  apiRequest(`/v1/wallet/orders/${orderId}/verify`, {
    method: 'POST',
    body: input,
    schema: z.object({ ok: z.literal(true) }),
  });
export const sandboxPay = (orderId: string) =>
  apiRequest(`/v1/wallet/orders/${orderId}/sandbox-pay`, {
    method: 'POST',
    schema: z.object({ ok: z.literal(true) }),
  });

// ---- worker wallet (Phase Commerce B3/B4/B6) -------------------------------------------------
export const getWorkerWallet = () =>
  apiRequest('/v1/worker/wallet', { schema: workerWalletSchema });
export const settleDues = (amountPaise: number) =>
  apiRequest('/v1/worker/wallet/dues/settle', {
    method: 'POST',
    body: { amountPaise },
    schema: z.object({ settledPaise: z.number().int() }),
  });
export const withdraw = (amountPaise: number) =>
  apiRequest('/v1/worker/wallet/withdraw', {
    method: 'POST',
    body: { amountPaise },
    schema: z.object({ withdrawnPaise: z.number().int() }),
  });

export const getPlusPlans = (audience: PlusAudience) =>
  apiRequest(`/v1/plus/plans?audience=${audience}`, { schema: z.array(plusPlanSchema) });
export const getPlusMembership = () =>
  apiRequest('/v1/plus/membership', { schema: plusMembershipSchema });

export const walletKey = ['wallet'] as const;
export function useWallet() {
  return useQuery({ queryKey: walletKey, queryFn: getWallet, refetchInterval: 30_000 });
}
export function useBundles() {
  return useQuery({ queryKey: ['wallet', 'bundles'], queryFn: getBundles, staleTime: 5 * 60_000 });
}
export function useOrders() {
  return useQuery({ queryKey: ['wallet', 'orders'], queryFn: () => getOrders() });
}
export function usePlusPlans(audience: PlusAudience) {
  return useQuery({
    queryKey: ['plus', 'plans', audience],
    queryFn: () => getPlusPlans(audience),
    staleTime: 5 * 60_000,
  });
}
export function usePlusMembership() {
  return useQuery({ queryKey: ['plus', 'membership'], queryFn: getPlusMembership });
}

export const workerWalletKey = ['worker-wallet'] as const;
export function useWorkerWallet() {
  return useQuery({ queryKey: workerWalletKey, queryFn: getWorkerWallet });
}
