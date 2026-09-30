import { z } from 'zod';
import {
  CONSENT_PURPOSES,
  KYC_CHECK_STATUSES,
  KYC_DOCUMENT_TYPES,
  SUPPORTED_LANGUAGES,
  USER_ROLES,
} from './constants';
import { indianPhoneSchema, pincodeSchema } from './schemas';

/** Request and response contracts shared by the API, the mobile app and the admin app. */

// ---- Auth -----------------------------------------------------------------------------

export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, 'deviceId must be 8-64 chars: letters, digits, - or _');

export const otpSendSchema = z.object({ phone: indianPhoneSchema });
export type OtpSendInput = z.infer<typeof otpSendSchema>;

export const otpVerifySchema = z.object({
  phone: indianPhoneSchema,
  code: z.string().regex(/^[0-9]{6}$/, 'Code is 6 digits'),
  deviceId: deviceIdSchema,
  platform: z.enum(['android', 'ios', 'web']),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
  deviceId: deviceIdSchema,
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const userRoleSchema = z.enum(USER_ROLES);

export const meSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  fullName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  preferredLanguage: z.enum(SUPPORTED_LANGUAGES),
  languages: z.array(z.string()),
  roles: z.array(userRoleSchema),
  status: z.string(),
  /** Consent purposes the user has not yet granted at the current legal version. */
  missingConsents: z.array(z.enum(CONSENT_PURPOSES)),
  workerKycTier: z.number().int().nullable(),
});
export type Me = z.infer<typeof meSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int(),
  isNewUser: z.boolean(),
  user: meSchema,
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresInSeconds: z.number().int(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

// ---- Profile --------------------------------------------------------------------------

export const profileUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(80).optional(),
    preferredLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
    languages: z.array(z.enum(SUPPORTED_LANGUAGES)).min(1).max(5).optional(),
  })
  .strict();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const addRoleSchema = z.object({
  role: z.enum(['CUSTOMER', 'WORKER', 'EMPLOYER', 'STUDENT']),
});

export const consentInputSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  version: z.string().min(1).max(40),
});
export type ConsentInput = z.infer<typeof consentInputSchema>;

// ---- Addresses ------------------------------------------------------------------------

const addressFields = {
  label: z.string().trim().min(1).max(30),
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: pincodeSchema,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  isDefault: z.boolean().optional(),
};

export const addressInputSchema = z
  .object(addressFields)
  .refine((a) => (a.latitude === undefined) === (a.longitude === undefined), {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });
export type AddressInput = z.infer<typeof addressInputSchema>;

export const addressUpdateSchema = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((a) => (a.latitude === undefined) === (a.longitude === undefined), {
    message: 'latitude and longitude must be provided together',
    path: ['latitude'],
  });
export type AddressUpdate = z.infer<typeof addressUpdateSchema>;

export const addressSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  isDefault: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type AddressDto = z.infer<typeof addressSchema>;

// ---- Emergency contacts ---------------------------------------------------------------

export const emergencyContactInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: indianPhoneSchema,
  relationship: z.string().trim().min(2).max(40),
});
export type EmergencyContactInput = z.infer<typeof emergencyContactInputSchema>;

export const emergencyContactSchema = emergencyContactInputSchema.extend({ id: z.string().uuid() });
export type EmergencyContactDto = z.infer<typeof emergencyContactSchema>;

// ---- Ranger (worker) profile ----------------------------------------------------------

export const workerProfileUpdateSchema = z
  .object({
    bio: z.string().trim().max(500).optional(),
    experienceYears: z.number().int().min(0).max(70).optional(),
    categorySlugs: z.array(z.string().min(1).max(64)).min(1).max(5).optional(),
  })
  .strict();
export type WorkerProfileUpdate = z.infer<typeof workerProfileUpdateSchema>;

export const workerProfileSchema = z.object({
  kycTier: z.number().int(),
  bio: z.string().nullable(),
  experienceYears: z.number().int().nullable(),
  categorySlugs: z.array(z.string()),
});
export type WorkerProfileDto = z.infer<typeof workerProfileSchema>;

// ---- KYC (manual admin review, D-016) --------------------------------------------------

export const kycTierSchema = z.union([z.literal(1), z.literal(2)]);
export const kycStartSchema = z.object({ tier: kycTierSchema });

export const kycDocumentRequestSchema = z.object({
  checkId: z.string().uuid(),
  type: z.enum(KYC_DOCUMENT_TYPES),
  contentType: z.string().min(3).max(60),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(8 * 1024 * 1024),
});
export type KycDocumentRequest = z.infer<typeof kycDocumentRequestSchema>;

export const kycReferenceInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: indianPhoneSchema,
  relationship: z.string().trim().min(2).max(40),
});

export const kycSubmitSchema = z.object({
  checkId: z.string().uuid(),
  reference: kycReferenceInputSchema.optional(),
});
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

export const kycDocumentDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(KYC_DOCUMENT_TYPES),
  status: z.enum(['PENDING_UPLOAD', 'UPLOADED', 'DELETED']),
});

export const kycCheckDtoSchema = z.object({
  id: z.string().uuid(),
  tier: z.number().int(),
  status: z.enum(KYC_CHECK_STATUSES),
  reviewerMessage: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  requiredDocuments: z.array(z.enum(KYC_DOCUMENT_TYPES)),
  documents: z.array(kycDocumentDtoSchema),
});
export type KycCheckDto = z.infer<typeof kycCheckDtoSchema>;

export const kycStatusSchema = z.object({
  tier: z.number().int(),
  checks: z.array(kycCheckDtoSchema),
});
export type KycStatus = z.infer<typeof kycStatusSchema>;

export const kycPresignSchema = z.object({
  documentId: z.string().uuid(),
  uploadUrl: z.string().url(),
  method: z.literal('PUT'),
  headers: z.record(z.string()),
  expiresInSeconds: z.number().int(),
});
export type KycPresign = z.infer<typeof kycPresignSchema>;

// ---- Admin ----------------------------------------------------------------------------

export const adminLoginSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(200),
});

export const referenceCallOutcomeSchema = z.enum(['VERIFIED', 'NOT_REACHABLE', 'NEGATIVE']);

export const adminKycDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']),
    reason: z.string().trim().min(5).max(500).optional(),
    /** Tier 1 approval: typed by the reviewer from the masked Aadhaar. */
    aadhaarLast4: z
      .string()
      .regex(/^[0-9]{4}$/)
      .optional(),
    /** Tier 1 approval: YYYY-MM-DD, from the Aadhaar. Under-18 can never be approved. */
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Tier 2 approval: the reviewer's logged verification call to the reference. */
    referenceCall: z
      .object({ outcome: referenceCallOutcomeSchema, notes: z.string().trim().max(500).optional() })
      .optional(),
  })
  .refine((d) => d.decision === 'APPROVE' || !!d.reason, {
    message: 'A reason is required to reject or request more information',
    path: ['reason'],
  });
export type AdminKycDecision = z.infer<typeof adminKycDecisionSchema>;
