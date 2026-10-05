import { z } from 'zod';
import {
  CLIENT_LEAGUE_TIERS,
  JOB_STATES,
  LEAGUE_TIERS,
  MAX_REQUEST_PHOTOS,
  MAX_VOICE_SECONDS,
  PRICE_BAND_SCOPES,
} from './constants';
import { paiseSchema } from './schemas';

/** Contracts for the on-demand marketplace (Phase 2), shared by API and mobile. */

const uuid = z.string().uuid();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// ---- Media (photos and a voice note attached to a request) -------------------------------

export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VOICE_MIME = [
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
] as const;

export const mediaPresignRequestSchema = z
  .object({
    kind: z.enum(['PHOTO', 'VOICE']),
    contentType: z.string().min(3).max(60),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    /** Voice notes only. The phone declares it; the server can only bound the file size. */
    durationSeconds: z.number().int().min(1).max(MAX_VOICE_SECONDS).optional(),
  })
  .refine((m) => m.kind === 'PHOTO' || m.durationSeconds !== undefined, {
    message: 'durationSeconds is required for a voice note',
    path: ['durationSeconds'],
  });
export type MediaPresignRequest = z.infer<typeof mediaPresignRequestSchema>;

export const mediaPresignSchema = z.object({
  mediaId: uuid,
  uploadUrl: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string()),
  expiresInSeconds: z.number().int(),
});
export type MediaPresign = z.infer<typeof mediaPresignSchema>;

// ---- Requests ------------------------------------------------------------------------------

export const createRequestSchema = z
  .object({
    categorySlug: z.string().min(1).max(64),
    description: z.string().trim().min(5).max(1000),
    addressId: uuid,
    urgency: z.enum(['IMMEDIATE', 'SCHEDULED']),
    /** ISO timestamp. Must be 30 minutes to 14 days from now (checked by the server). */
    scheduledFor: z.string().datetime().optional(),
    /** A soft preference: it can improve ranking but never blocks matching. */
    genderPreference: z.enum(['ANY', 'FEMALE', 'MALE']).default('ANY'),
    mediaIds: z
      .array(uuid)
      .max(MAX_REQUEST_PHOTOS + 1)
      .default([]),
  })
  .refine((r) => r.urgency === 'IMMEDIATE' || !!r.scheduledFor, {
    message: 'scheduledFor is required for a scheduled request',
    path: ['scheduledFor'],
  });
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

const bandSchema = z.object({
  scope: z.enum(PRICE_BAND_SCOPES),
  minPaise: paiseSchema,
  medianPaise: paiseSchema,
  maxPaise: paiseSchema,
});

export const offerDtoSchema = z.object({
  id: uuid,
  round: z.number().int(),
  fromRole: z.enum(['CUSTOMER', 'WORKER']),
  amountPaise: paiseSchema,
  outsideBand: z.boolean(),
  status: z.enum(['PENDING', 'ACCEPTED', 'COUNTERED', 'REJECTED', 'EXPIRED']),
  expiresAt: z.string(),
});
export type OfferDto = z.infer<typeof offerDtoSchema>;

const partySchema = z.object({ id: uuid, firstName: z.string().nullable() });

export const jobDtoSchema = z.object({
  id: uuid,
  requestId: uuid,
  /** Who is looking: decides which fields are present. */
  viewerRole: z.enum(['CUSTOMER', 'WORKER']),
  status: z.enum(JOB_STATES),
  categorySlug: z.string(),
  description: z.string(),
  urgency: z.enum(['IMMEDIATE', 'SCHEDULED']),
  scheduledFor: z.string().nullable(),
  city: z.string(),
  pincode: z.string(),
  /** Full address and exact point: customer always; Ranger only after matching. */
  addressLine: z.string().nullable(),
  location: z.object({ latitude, longitude }).nullable(),
  band: bandSchema,
  agreedPricePaise: paiseSchema.nullable(),
  genderPreference: z.enum(['ANY', 'FEMALE', 'MALE']),
  genderPreferenceMet: z.boolean().nullable(),
  /** Rush (Phase 9, D-069): a paid Rush fee or an active Haggler Plus membership at request time.
   * Skipped straight to the widest broadcast radius in one wave. */
  isRush: z.boolean(),
  /** How the broadcast is going (customer only). */
  broadcast: z
    .object({
      wave: z.number().int(),
      deadline: z.string().nullable(),
      slaEstimateMinutes: z.number().int(),
    })
    .nullable(),
  customer: partySchema,
  worker: partySchema
    .extend({
      kycTier: z.number().int(),
      league: z.string(),
      jobsCompleted: z.number().int(),
      /** null when the Ranger has no ratings yet (never shown as "0 stars"). */
      ratingAvg: z.number().nullable(),
      ratingCount: z.number().int(),
    })
    .nullable(),
  offers: z.array(offerDtoSchema),
  /** Phase 4: whether the viewer can/did leave a review for this job. */
  review: z.object({ canReview: z.boolean(), submitted: z.boolean() }),
  /** The 4-digit code the customer reads out; shown to the CUSTOMER only, while the Ranger is there. */
  arrivalCode: z.string().nullable(),
  arrivalVerified: z.boolean(),
  hasBeforePhoto: z.boolean(),
  hasAfterPhoto: z.boolean(),
  paymentMethod: z.enum(['CASH', 'UPI']).nullable(),
  cancellation: z
    .object({ by: z.string().nullable(), reason: z.string().nullable(), feeApplies: z.boolean() })
    .nullable(),
  media: z.array(z.object({ id: uuid, kind: z.enum(['PHOTO', 'VOICE']), url: z.string() })),
  threadId: uuid.nullable(),
  createdAt: z.string(),
});
export type JobDto = z.infer<typeof jobDtoSchema>;

export const jobListItemSchema = z.object({
  id: uuid,
  viewerRole: z.enum(['CUSTOMER', 'WORKER']),
  status: z.enum(JOB_STATES),
  categorySlug: z.string(),
  description: z.string(),
  agreedPricePaise: paiseSchema.nullable(),
  createdAt: z.string(),
});
export const jobListSchema = z.object({
  items: z.array(jobListItemSchema),
  nextCursor: z.string().nullable(),
});
export type JobListItem = z.infer<typeof jobListItemSchema>;

// ---- Offers ----------------------------------------------------------------------------------

export const offerInputSchema = z.object({
  amountPaise: z.number().int().min(100).max(10_000_000),
  /** Required when the amount is outside the price band (both parties must confirm, D3). */
  confirmOutsideBand: z.boolean().optional(),
});
export type OfferInput = z.infer<typeof offerInputSchema>;

export const offerResponseSchema = z.object({ confirmOutsideBand: z.boolean().optional() });

// ---- Ranger presence and broadcasts ---------------------------------------------------------

export const goOnlineSchema = z.object({ latitude, longitude });
export const locationUpdateSchema = z.object({
  latitude,
  longitude,
  accuracyM: z.number().min(0).max(10_000).optional(),
});
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;

export const presenceSchema = z.object({ isOnline: z.boolean() });

/** Part D (D-076): the Ranger league screen — current league, progress toward the next, and the
 * full ordered ladder so a Ranger can see what's coming. */
export const leagueTierSchema = z.enum(LEAGUE_TIERS);
export const leagueStatusSchema = z.object({
  league: leagueTierSchema,
  nextLeague: leagueTierSchema.nullable(),
  /** 0..1, bounded by whichever requirement for nextLeague is furthest from being met. */
  progress: z.number().min(0).max(1),
  jobsCompleted: z.number().int(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  cancellationRate: z.number().min(0),
  ladder: z.array(z.object({ tier: leagueTierSchema, reached: z.boolean() })),
});
export type LeagueStatus = z.infer<typeof leagueStatusSchema>;

/** Part E (D-077): the client league screen — the customer-side mirror of leagueStatusSchema. */
export const clientLeagueTierSchema = z.enum(CLIENT_LEAGUE_TIERS);
export const clientLeagueStatusSchema = z.object({
  league: clientLeagueTierSchema,
  nextLeague: clientLeagueTierSchema.nullable(),
  progress: z.number().min(0).max(1),
  bookingsCompleted: z.number().int(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int(),
  cancellationRate: z.number().min(0),
  ladder: z.array(z.object({ tier: clientLeagueTierSchema, reached: z.boolean() })),
});
export type ClientLeagueStatus = z.infer<typeof clientLeagueStatusSchema>;

/** What an invited Ranger sees. Deliberately no exact address until they win the job. */
export const incomingRequestSchema = z.object({
  jobId: uuid,
  requestId: uuid,
  categorySlug: z.string(),
  description: z.string(),
  city: z.string(),
  pincode: z.string(),
  distanceM: z.number().int(),
  wave: z.number().int(),
  urgency: z.enum(['IMMEDIATE', 'SCHEDULED']),
  scheduledFor: z.string().nullable(),
  band: bandSchema,
  deadline: z.string().nullable(),
  photoCount: z.number().int(),
  hasVoiceNote: z.boolean(),
});
export type IncomingRequest = z.infer<typeof incomingRequestSchema>;
export const incomingListSchema = z.array(incomingRequestSchema);

// ---- Job actions ------------------------------------------------------------------------------

export const verifyArrivalSchema = z.object({
  code: z.string().regex(/^[0-9]{4}$/, 'Code is 4 digits'),
});
export const jobPhotoPresignRequestSchema = z.object({
  kind: z.enum(['BEFORE', 'AFTER']),
  contentType: z.string().min(3).max(60),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
export const completeJobSchema = z.object({ paymentMethod: z.enum(['CASH', 'UPI']) });
export const cancelJobSchema = z.object({ reason: z.string().trim().min(3).max(300).optional() });
export const jobPhotoPresignSchema = z.object({
  photoId: uuid,
  uploadUrl: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string()),
  expiresInSeconds: z.number().int(),
});

// ---- Tracking and sharing --------------------------------------------------------------------

export const trackSchema = z.object({
  jobId: uuid,
  status: z.enum(JOB_STATES),
  worker: z
    .object({ latitude, longitude, accuracyM: z.number().nullable(), recordedAt: z.string() })
    .nullable(),
  trail: z.array(z.object({ latitude, longitude, recordedAt: z.string() })),
  destination: z.object({ latitude, longitude }).nullable(),
});
export type TrackDto = z.infer<typeof trackSchema>;

export const shareLinkSchema = z.object({ url: z.string(), expiresAt: z.string() });

// ---- Chat --------------------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  clientMsgId: z.string().min(8).max(64),
  body: z.string().trim().min(1).max(2000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const chatMessageSchema = z.object({
  id: uuid,
  threadId: uuid,
  senderId: uuid,
  body: z.string(),
  clientMsgId: z.string(),
  createdAt: z.string(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;
export const chatPageSchema = z.object({
  items: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});

// ---- Realtime event names (server -> client and client -> server) -----------------------------

export const SOCKET_EVENTS = {
  broadcast: 'request.broadcast',
  taken: 'request.taken',
  matched: 'request.matched',
  timeout: 'request.timeout',
  jobUpdated: 'job.updated',
  offerUpdated: 'offer.updated',
  location: 'location.update',
  chat: 'chat.message',
  accept: 'request.accept',
} as const;
