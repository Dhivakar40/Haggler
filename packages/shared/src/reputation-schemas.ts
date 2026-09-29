import { z } from 'zod';

/** Contracts for reviews and blocking (Phase 4). */

const uuid = z.string().uuid();

export const submitReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;

export const reviewSchema = z.object({
  id: uuid,
  raterRole: z.enum(['CUSTOMER', 'WORKER']),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewDto = z.infer<typeof reviewSchema>;

export const jobReviewsSchema = z.object({
  canReview: z.boolean(),
  submitted: z.boolean(),
  reviews: z.array(reviewSchema),
});
export type JobReviewsDto = z.infer<typeof jobReviewsSchema>;

export const workerReviewSchema = z.object({
  id: uuid,
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  customerFirstName: z.string().nullable(),
  createdAt: z.string(),
});
export const workerReviewPageSchema = z.object({
  items: z.array(workerReviewSchema),
  nextCursor: z.string().nullable(),
});

export const blockUserSchema = z.object({
  userId: uuid,
  reason: z.string().trim().max(200).optional(),
});
export type BlockUserInput = z.infer<typeof blockUserSchema>;

export const blockedUserSchema = z.object({
  userId: uuid,
  firstName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type BlockedUserDto = z.infer<typeof blockedUserSchema>;
