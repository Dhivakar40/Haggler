import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  chatMessageSchema,
  chatPageSchema,
  type CreateRequestInput,
  incomingListSchema,
  jobDtoSchema,
  jobListSchema,
  jobPhotoPresignSchema,
  mediaPresignSchema,
  type MediaPresignRequest,
  paymentOrderStartSchema,
  presenceSchema,
  priceBandSchema,
  priceListAddOnSchema,
  priceListEntrySchema,
  type QuoteInput,
  shareLinkSchema,
  trackSchema,
} from '@haggler/shared';
import { apiRequest } from './client';

/** Typed wrappers for the on-demand marketplace endpoints (Phase 2). */

const ok = z.object({}).passthrough();

// ---- requests -----------------------------------------------------------------------------------
export const createRequest = (body: CreateRequestInput) =>
  apiRequest('/v1/requests', { method: 'POST', body, schema: jobDtoSchema });
export const getRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}`, { schema: jobDtoSchema });
export const cancelRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}/cancel`, { method: 'POST', schema: jobDtoSchema });
export const rebroadcastRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}/rebroadcast`, { method: 'POST', schema: jobDtoSchema });
/** Rush fee (Phase 9, D-069): starts a payment order; complete it via wallet's verify/sandbox-pay. */
export const rushRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}/rush`, { method: 'POST', schema: paymentOrderStartSchema });
export const presignRequestMedia = (body: MediaPresignRequest) =>
  apiRequest('/v1/requests/media', { method: 'POST', body, schema: mediaPresignSchema });
export const confirmRequestMedia = (mediaId: string) =>
  apiRequest(`/v1/requests/media/${mediaId}/confirm`, { method: 'POST', schema: ok });
export const getPriceBand = (category: string, pincode: string, city: string) =>
  apiRequest(
    `/v1/price-bands?category=${encodeURIComponent(category)}&pincode=${pincode}&city=${encodeURIComponent(city)}`,
    { auth: false, schema: priceBandSchema },
  );
/** D-080: the fixed listed price for a category. 404s for "other", which has no fixed price. */
export const getPriceListEntry = (category: string) =>
  apiRequest(`/v1/price-list?category=${encodeURIComponent(category)}`, {
    auth: false,
    schema: priceListEntrySchema,
  });
export const getPriceListAddOns = (category: string) =>
  apiRequest(`/v1/price-list/add-ons?category=${encodeURIComponent(category)}`, {
    auth: false,
    schema: z.array(priceListAddOnSchema),
  });

// ---- Ranger: accept / decline / presence -----------------------------------------------------------
export const acceptRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}/accept`, {
    method: 'POST',
    schema: z.object({ jobId: z.string(), requestId: z.string() }),
  });
export const declineRequest = (requestId: string) =>
  apiRequest(`/v1/requests/${requestId}/decline`, { method: 'POST', schema: ok });
export const goOnline = (latitude: number, longitude: number) =>
  apiRequest('/v1/worker/online', {
    method: 'POST',
    body: { latitude, longitude },
    schema: presenceSchema,
  });
export const goOffline = () =>
  apiRequest('/v1/worker/offline', { method: 'POST', schema: presenceSchema });
export const getPresence = () => apiRequest('/v1/worker/presence', { schema: presenceSchema });
export const sendLocation = (latitude: number, longitude: number, accuracyM?: number) =>
  apiRequest('/v1/worker/location', {
    method: 'POST',
    body: { latitude, longitude, ...(accuracyM !== undefined ? { accuracyM } : {}) },
    schema: ok,
  });
export const getIncoming = () => apiRequest('/v1/worker/incoming', { schema: incomingListSchema });

// ---- jobs -------------------------------------------------------------------------------------------
export const getJob = (jobId: string) => apiRequest(`/v1/jobs/${jobId}`, { schema: jobDtoSchema });
export const listJobs = (role?: 'CUSTOMER' | 'WORKER') =>
  apiRequest(`/v1/jobs?limit=30${role ? `&role=${role}` : ''}`, { schema: jobListSchema });
// D-080 (A4): "other"-category quotes, replacing offers/negotiation for every other category.
export const sendQuote = (jobId: string, body: QuoteInput) =>
  apiRequest(`/v1/jobs/${jobId}/quotes`, { method: 'POST', body, schema: jobDtoSchema });
export const withdrawQuote = (jobId: string, quoteId: string) =>
  apiRequest(`/v1/jobs/${jobId}/quotes/${quoteId}/withdraw`, { method: 'POST', schema: ok });
export const acceptQuote = (jobId: string, quoteId: string) =>
  apiRequest(`/v1/jobs/${jobId}/quotes/${quoteId}/accept`, { method: 'POST', schema: jobDtoSchema });
export const declineQuote = (jobId: string, quoteId: string) =>
  apiRequest(`/v1/jobs/${jobId}/quotes/${quoteId}/decline`, {
    method: 'POST',
    schema: jobDtoSchema,
  });

const act = (jobId: string, path: string, body?: unknown) =>
  apiRequest(`/v1/jobs/${jobId}/${path}`, { method: 'POST', body, schema: jobDtoSchema });
export const enRoute = (jobId: string) => act(jobId, 'en-route');
export const arrive = (jobId: string) => act(jobId, 'arrive');
export const verifyArrival = (jobId: string, code: string) =>
  act(jobId, 'verify-arrival', { code });
export const startJob = (jobId: string) => act(jobId, 'start');
export const completeJob = (
  jobId: string,
  paymentMethod: 'CASH' | 'UPI',
  cashCollectedPaise?: number,
) => act(jobId, 'complete', { paymentMethod, ...(cashCollectedPaise !== undefined ? { cashCollectedPaise } : {}) });
export const confirmJob = (jobId: string, cashConfirmedPaise?: number) =>
  act(jobId, 'confirm', cashConfirmedPaise !== undefined ? { cashConfirmedPaise } : {});
/** Phase Commerce B3: starts the Razorpay-sandbox order for a completed ONLINE job; complete it
 * via wallet's verify/sandbox-pay, same pipeline as a token top-up. */
export const startOnlinePayment = (jobId: string) =>
  apiRequest(`/v1/jobs/${jobId}/payment/online`, {
    method: 'POST',
    schema: paymentOrderStartSchema,
  });
export const cancelJob = (jobId: string, reason?: string) =>
  act(jobId, 'cancel', reason ? { reason } : {});
export const reportNoShow = (jobId: string) => act(jobId, 'report-no-show');
/** D-080 (Sub-phase C): raise a safety alert; the other party is pushed immediately. */
export const triggerSos = (jobId: string, note?: string) =>
  act(jobId, 'sos', note ? { note } : {});
/** D-080 (Sub-phase D): raise a dispute on a confirmed job, for admin review. */
export const raiseDispute = (jobId: string, reason: string) =>
  act(jobId, 'dispute', { reason });
export const presignJobPhoto = (
  jobId: string,
  body: { kind: 'BEFORE' | 'AFTER'; contentType: string; sizeBytes: number },
) =>
  apiRequest(`/v1/jobs/${jobId}/photos`, { method: 'POST', body, schema: jobPhotoPresignSchema });
export const confirmJobPhoto = (jobId: string, photoId: string) =>
  apiRequest(`/v1/jobs/${jobId}/photos/${photoId}/confirm`, { method: 'POST', schema: ok });

// ---- tracking, sharing, chat ------------------------------------------------------------------------------
export const getTrack = (jobId: string) =>
  apiRequest(`/v1/jobs/${jobId}/track`, { schema: trackSchema });
export const createShareLink = (jobId: string) =>
  apiRequest(`/v1/jobs/${jobId}/share-link`, { method: 'POST', schema: shareLinkSchema });
export const getThread = (jobId: string) =>
  apiRequest(`/v1/jobs/${jobId}/thread`, {
    schema: z.object({ id: z.string(), jobId: z.string() }),
  });
export const getMessages = (threadId: string, cursor?: string) =>
  apiRequest(`/v1/threads/${threadId}/messages?limit=30${cursor ? `&cursor=${cursor}` : ''}`, {
    schema: chatPageSchema,
  });
export const sendMessageRest = (threadId: string, body: { clientMsgId: string; body: string }) =>
  apiRequest(`/v1/threads/${threadId}/messages`, {
    method: 'POST',
    body,
    schema: chatMessageSchema,
  });

// ---- react-query hooks --------------------------------------------------------------------------------------
export const jobKey = (jobId: string) => ['job', jobId] as const;
export const requestKey = (requestId: string) => ['request', requestId] as const;

/** Reads a job. Realtime events invalidate this; the interval is only a safety net if the socket drops. */
export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: jobKey(jobId ?? ''),
    queryFn: () => getJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: 20_000,
  });
}
export function useRequest(requestId: string | undefined) {
  return useQuery({
    queryKey: requestKey(requestId ?? ''),
    queryFn: () => getRequest(requestId as string),
    enabled: !!requestId,
    refetchInterval: 10_000,
  });
}
export function useJobs(role?: 'CUSTOMER' | 'WORKER', enabled = true) {
  return useQuery({
    queryKey: ['jobs', role ?? 'ALL'],
    queryFn: () => listJobs(role),
    enabled,
    refetchInterval: 30_000,
  });
}
export function usePresence(enabled: boolean) {
  return useQuery({
    queryKey: ['presence'],
    queryFn: getPresence,
    enabled,
    refetchInterval: 30_000,
  });
}
export function useIncoming(enabled: boolean) {
  return useQuery({
    queryKey: ['incoming'],
    queryFn: getIncoming,
    enabled,
    refetchInterval: 15_000,
  });
}
