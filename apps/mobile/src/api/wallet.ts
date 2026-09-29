import { useQuery } from '@tanstack/react-query';
import {
  type CreateTopupOrderInput,
  paymentOrderPageSchema,
  tokenBundleSchema,
  topupOrderSchema,
  type VerifyTopupInput,
  walletSchema,
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
  apiRequest('/v1/wallet/topup', { method: 'POST', body: input, schema: topupOrderSchema });
export const verifyTopup = (orderId: string, input: VerifyTopupInput) =>
  apiRequest(`/v1/wallet/topup/${orderId}/verify`, {
    method: 'POST',
    body: input,
    schema: walletSchema,
  });
export const sandboxPay = (orderId: string) =>
  apiRequest(`/v1/wallet/topup/${orderId}/sandbox-pay`, { method: 'POST', schema: walletSchema });

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
