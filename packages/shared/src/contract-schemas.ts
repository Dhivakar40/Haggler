import { z } from 'zod';
import { paiseSchema, pincodeSchema } from './schemas';

/** Contracts for the Contract-labour job board (Phase 6). A job board, not on-demand dispatch —
 * money never moves through the app here (docs/DECISIONS.md D-054). */

const uuid = z.string().uuid();

export const CONTRACT_PAY_TYPES = ['ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export const contractPayTypeSchema = z.enum(CONTRACT_PAY_TYPES);
export type ContractPayType = z.infer<typeof contractPayTypeSchema>;

export const CONTRACT_LISTING_STATUSES = [
  'OPEN',
  'PAUSED',
  'FILLED',
  'CLOSED',
  'CANCELLED',
] as const;
export const contractListingStatusSchema = z.enum(CONTRACT_LISTING_STATUSES);
export type ContractListingStatus = z.infer<typeof contractListingStatusSchema>;

export const CONTRACT_APPLICATION_STATUSES = [
  'APPLIED',
  'SHORTLISTED',
  'REJECTED',
  'HIRED',
  'WITHDRAWN',
] as const;
export const contractApplicationStatusSchema = z.enum(CONTRACT_APPLICATION_STATUSES);
export type ContractApplicationStatus = z.infer<typeof contractApplicationStatusSchema>;

export const employerProfileUpdateSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
});
export type EmployerProfileUpdate = z.infer<typeof employerProfileUpdateSchema>;

export const employerProfileSchema = z.object({
  businessName: z.string(),
});
export type EmployerProfileDto = z.infer<typeof employerProfileSchema>;

export const createContractListingSchema = z.object({
  categorySlug: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  payType: contractPayTypeSchema,
  payAmountPaise: paiseSchema.min(1),
  openings: z.number().int().min(1).max(50).default(1),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: pincodeSchema,
  startDate: z.string().date().optional(),
});
export type CreateContractListingInput = z.infer<typeof createContractListingSchema>;

/** Only OPEN/PAUSED listings may be edited; a status may be set to PAUSED/OPEN/CLOSED/CANCELLED
 * directly (FILLED is computed, never set here). */
export const updateContractListingSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    payType: contractPayTypeSchema.optional(),
    payAmountPaise: paiseSchema.min(1).optional(),
    openings: z.number().int().min(1).max(50).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
    pincode: pincodeSchema.optional(),
    startDate: z.string().date().optional(),
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED', 'CANCELLED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateContractListingInput = z.infer<typeof updateContractListingSchema>;

export const contractListingSchema = z.object({
  id: uuid,
  employerId: uuid,
  businessName: z.string(),
  categorySlug: z.string(),
  title: z.string(),
  description: z.string(),
  payType: contractPayTypeSchema,
  payAmountPaise: paiseSchema,
  openings: z.number().int(),
  filledCount: z.number().int(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  startDate: z.string().nullable(),
  status: contractListingStatusSchema,
  /** A currently-active Boosted Listing fee is in effect (D-069). */
  isBoosted: z.boolean(),
  createdAt: z.string(),
  /** Only present for the employer who owns the listing, or omitted entirely for a browsing Ranger. */
  applicationCount: z.number().int().optional(),
  /** Only present for a Ranger who is signed in and has WORKER role: their own application status. */
  myApplicationStatus: contractApplicationStatusSchema.nullable().optional(),
});
export type ContractListingDto = z.infer<typeof contractListingSchema>;

export const contractListingPageSchema = z.object({
  /** Currently-boosted listings, up to 5, present only on the first page (D-069). */
  boosted: z.array(contractListingSchema).optional(),
  items: z.array(contractListingSchema),
  nextCursor: z.string().nullable(),
});
export type ContractListingPage = z.infer<typeof contractListingPageSchema>;

export const applyToContractSchema = z.object({
  coverNote: z.string().trim().max(1000).optional(),
});
export type ApplyToContractInput = z.infer<typeof applyToContractSchema>;

export const contractApplicationSchema = z.object({
  id: uuid,
  listingId: uuid,
  workerId: uuid,
  workerName: z.string().nullable(),
  coverNote: z.string().nullable(),
  status: contractApplicationStatusSchema,
  appliedAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type ContractApplicationDto = z.infer<typeof contractApplicationSchema>;

export const contractApplicationPageSchema = z.object({
  items: z.array(contractApplicationSchema),
  nextCursor: z.string().nullable(),
});

/** My own application, with a summary of the listing it's for. */
export const myContractApplicationSchema = contractApplicationSchema.extend({
  listingTitle: z.string(),
  listingStatus: contractListingStatusSchema,
  businessName: z.string(),
});
export const myContractApplicationPageSchema = z.object({
  items: z.array(myContractApplicationSchema),
  nextCursor: z.string().nullable(),
});

export const contractDecisionSchema = z.object({
  decision: z.enum(['SHORTLIST', 'REJECT', 'HIRE']),
});
export type ContractDecisionInput = z.infer<typeof contractDecisionSchema>;
