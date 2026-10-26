import { z } from 'zod';
import { paiseSchema, pincodeSchema } from './schemas';
import { contractApplicationStatusSchema, contractListingStatusSchema } from './contract-schemas';

/** Contracts for Campus (part-time student jobs, Phase 7). Shares its shape with Contract labour
 * (Phase 6) — same statuses, same job-board-not-dispatch model, same no-money-through-the-app
 * principle (docs/DECISIONS.md D-054) — plus Campus-specific safeguards: a hard 18+ age gate
 * (D-060), a weekly hours cap (D-061), and a night-shift opt-in that also requires a verified
 * employer (D-062). */

const uuid = z.string().uuid();
const dobSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** D-103: how far along a student is — free enough to cover diploma/postgraduate without a
 * rigid enum, specific enough to show up as a small set of chips in the app. */
export const YEARS_OF_STUDY = [
  'YEAR_1',
  'YEAR_2',
  'YEAR_3',
  'YEAR_4',
  'POSTGRADUATE',
  'GRADUATED',
] as const;
export const yearOfStudySchema = z.enum(YEARS_OF_STUDY);
export type YearOfStudy = z.infer<typeof yearOfStudySchema>;
export const MAX_STUDENT_SKILLS = 10;

export const studentProfileUpdateSchema = z.object({
  /** Self-declared, hard-blocked in code if it computes to under 18 (D-060/D-063). Once a
   * profile exists this cannot be changed (see StudentProfileService) — it is set once. */
  dateOfBirth: dobSchema,
  instituteName: z.string().trim().max(120).optional(),
});
export type StudentProfileUpdate = z.infer<typeof studentProfileUpdateSchema>;

/** D-103: the professional/skills detail, editable any time after the profile exists (unlike
 * dateOfBirth above) — kept as its own schema so the immutable DOB can never accidentally be
 * accepted on this path. */
export const studentProfileDetailsSchema = z.object({
  instituteName: z.string().trim().max(120).optional(),
  courseOfStudy: z.string().trim().max(120).optional(),
  yearOfStudy: yearOfStudySchema.optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(MAX_STUDENT_SKILLS).optional(),
  availabilityHoursPerWeek: z.number().int().min(1).max(80).optional(),
  bio: z.string().trim().max(500).optional(),
  portfolioUrl: z.string().trim().url().max(300).optional(),
});
export type StudentProfileDetailsUpdate = z.infer<typeof studentProfileDetailsSchema>;

export const studentProfileSchema = z.object({
  instituteName: z.string().nullable(),
  courseOfStudy: z.string().nullable(),
  yearOfStudy: yearOfStudySchema.nullable(),
  skills: z.array(z.string()),
  availabilityHoursPerWeek: z.number().int().nullable(),
  bio: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
});
export type StudentProfileDto = z.infer<typeof studentProfileSchema>;

export const createCampusListingSchema = z.object({
  categorySlug: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  hourlyRatePaise: paiseSchema.min(1),
  /** Weekly commitment for this listing; checked against the student's cap at apply/hire. */
  hoursPerWeek: z.number().int().min(1).max(80),
  /** Declares a shift overlapping 22:00-06:00. Creating one needs a verified employer (D-062). */
  isNightShift: z.boolean().default(false),
  openings: z.number().int().min(1).max(50).default(1),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: pincodeSchema,
});
export type CreateCampusListingInput = z.infer<typeof createCampusListingSchema>;

export const updateCampusListingSchema = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    hourlyRatePaise: paiseSchema.min(1).optional(),
    hoursPerWeek: z.number().int().min(1).max(80).optional(),
    isNightShift: z.boolean().optional(),
    openings: z.number().int().min(1).max(50).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    state: z.string().trim().min(1).max(80).optional(),
    pincode: pincodeSchema.optional(),
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED', 'CANCELLED']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateCampusListingInput = z.infer<typeof updateCampusListingSchema>;

export const campusListingSchema = z.object({
  id: uuid,
  employerId: uuid,
  businessName: z.string(),
  categorySlug: z.string(),
  title: z.string(),
  description: z.string(),
  hourlyRatePaise: paiseSchema,
  hoursPerWeek: z.number().int(),
  isNightShift: z.boolean(),
  openings: z.number().int(),
  filledCount: z.number().int(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  status: contractListingStatusSchema,
  /** A currently-active Boosted Listing fee is in effect (D-069). */
  isBoosted: z.boolean(),
  createdAt: z.string(),
  applicationCount: z.number().int().optional(),
  myApplicationStatus: contractApplicationStatusSchema.nullable().optional(),
});
export type CampusListingDto = z.infer<typeof campusListingSchema>;

export const campusListingPageSchema = z.object({
  /** Currently-boosted listings, up to 5, present only on the first page (D-069). */
  boosted: z.array(campusListingSchema).optional(),
  items: z.array(campusListingSchema),
  nextCursor: z.string().nullable(),
});

export const applyToCampusSchema = z.object({
  coverNote: z.string().trim().max(1000).optional(),
  /** Required true to apply to a listing with isNightShift=true (D-062); ignored otherwise. */
  acceptsNightShift: z.boolean().default(false),
});
export type ApplyToCampusInput = z.infer<typeof applyToCampusSchema>;

export const campusApplicationSchema = z.object({
  id: uuid,
  listingId: uuid,
  studentId: uuid,
  studentName: z.string().nullable(),
  coverNote: z.string().nullable(),
  acceptsNightShift: z.boolean(),
  status: contractApplicationStatusSchema,
  appliedAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type CampusApplicationDto = z.infer<typeof campusApplicationSchema>;

export const campusApplicationPageSchema = z.object({
  items: z.array(campusApplicationSchema),
  nextCursor: z.string().nullable(),
});

export const myCampusApplicationSchema = campusApplicationSchema.extend({
  listingTitle: z.string(),
  listingStatus: contractListingStatusSchema,
  businessName: z.string(),
});
export const myCampusApplicationPageSchema = z.object({
  items: z.array(myCampusApplicationSchema),
  nextCursor: z.string().nullable(),
});

export const campusDecisionSchema = z.object({
  decision: z.enum(['SHORTLIST', 'REJECT', 'HIRE']),
});
export type CampusDecisionInput = z.infer<typeof campusDecisionSchema>;

/** Admin: employer verification queue (D-062). */
export const employerVerificationQueueItemSchema = z.object({
  employerId: uuid,
  userId: uuid,
  businessName: z.string(),
  phone: z.string(),
  createdAt: z.string(),
});
export const employerVerificationQueuePageSchema = z.object({
  items: z.array(employerVerificationQueueItemSchema),
  nextCursor: z.string().nullable(),
});
