import { useQuery } from '@tanstack/react-query';
import {
  type BlockUserInput,
  blockedUserSchema,
  jobReviewsSchema,
  type SubmitReviewInput,
  workerReviewPageSchema,
} from '@haggler/shared';
import { z } from 'zod';
import { apiRequest } from './client';

export const submitReview = (jobId: string, input: SubmitReviewInput) =>
  apiRequest(`/v1/jobs/${jobId}/review`, { method: 'POST', body: input, schema: jobReviewsSchema });
export const getJobReviews = (jobId: string) =>
  apiRequest(`/v1/jobs/${jobId}/reviews`, { schema: jobReviewsSchema });
export const getWorkerReviews = (workerId: string, cursor?: string) =>
  apiRequest(`/v1/rangers/${workerId}/reviews?limit=20${cursor ? `&cursor=${cursor}` : ''}`, {
    schema: workerReviewPageSchema,
  });

export const listBlocks = () => apiRequest('/v1/me/blocks', { schema: z.array(blockedUserSchema) });
export const blockUser = (input: BlockUserInput) =>
  apiRequest('/v1/me/blocks', {
    method: 'POST',
    body: input,
    schema: z.object({ blocked: z.boolean() }),
  });
export const unblockUser = (userId: string) =>
  apiRequest(`/v1/me/blocks/${userId}`, {
    method: 'DELETE',
    schema: z.object({ blocked: z.boolean() }),
  });

export function useJobReviews(jobId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['job', jobId, 'reviews'],
    queryFn: () => getJobReviews(jobId as string),
    enabled: enabled && !!jobId,
  });
}
export function useWorkerReviews(workerId: string | undefined) {
  return useQuery({
    queryKey: ['ranger', workerId, 'reviews'],
    queryFn: () => getWorkerReviews(workerId as string),
    enabled: !!workerId,
  });
}
export function useBlocks() {
  return useQuery({ queryKey: ['blocks'], queryFn: listBlocks });
}
