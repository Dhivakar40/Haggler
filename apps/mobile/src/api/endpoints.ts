import { z } from 'zod';
import {
  type AddressInput,
  addressSchema,
  authSessionSchema,
  type ConsentInput,
  type EmergencyContactInput,
  emergencyContactSchema,
  kycCheckDtoSchema,
  kycDocumentDtoSchema,
  kycPresignSchema,
  kycStatusSchema,
  type KycSubmitInput,
  meSchema,
  type OnboardingInput,
  type ProfileUpdate,
  type RegisterPushTokenInput,
  type WorkerProfileUpdate,
  leagueStatusSchema,
  workerProfileSchema,
} from '@haggler/shared';
import { apiRequest } from './client';

/** Thin typed wrappers over the REST API. Every response is validated against a shared zod schema. */

export const sendOtp = (phone: string) =>
  apiRequest('/v1/auth/otp/send', {
    method: 'POST',
    auth: false,
    body: { phone },
    schema: z.object({
      sent: z.boolean(),
      expiresInSeconds: z.number(),
      resendAfterSeconds: z.number(),
    }),
  });

export const verifyOtp = (input: {
  phone: string;
  code: string;
  deviceId: string;
  platform: 'android' | 'ios' | 'web';
  rememberMe?: boolean;
}) =>
  apiRequest('/v1/auth/otp/verify', {
    method: 'POST',
    auth: false,
    body: input,
    schema: authSessionSchema,
  });

export const completeOnboarding = (body: OnboardingInput) =>
  apiRequest('/v1/me/onboarding', { method: 'POST', body, schema: meSchema });

export const updateProfile = (body: ProfileUpdate) =>
  apiRequest('/v1/me', { method: 'PATCH', body, schema: meSchema });

export const registerPushToken = (body: RegisterPushTokenInput) =>
  apiRequest('/v1/me/push-token', {
    method: 'PATCH',
    body,
    schema: z.object({ ok: z.literal(true) }),
  });

export const addRole = (role: 'CUSTOMER' | 'WORKER' | 'EMPLOYER' | 'STUDENT') =>
  apiRequest('/v1/me/roles', { method: 'POST', body: { role }, schema: meSchema });

export const grantConsent = (body: ConsentInput) =>
  apiRequest('/v1/me/consents', {
    method: 'POST',
    body,
    schema: z.object({ purpose: z.string() }).passthrough(),
  });

export const requestDeletion = () =>
  apiRequest('/v1/me', {
    method: 'DELETE',
    schema: z.object({ status: z.string() }).passthrough(),
  });

export const exportMyData = () => apiRequest('/v1/me/export', { schema: z.record(z.unknown()) });

export const listAddresses = () =>
  apiRequest('/v1/me/addresses', { schema: z.array(addressSchema) });
export const createAddress = (body: AddressInput) =>
  apiRequest('/v1/me/addresses', { method: 'POST', body, schema: addressSchema });
export const setDefaultAddress = (id: string) =>
  apiRequest(`/v1/me/addresses/${id}`, {
    method: 'PATCH',
    body: { isDefault: true },
    schema: addressSchema,
  });
export const deleteAddress = (id: string) =>
  apiRequest(`/v1/me/addresses/${id}`, { method: 'DELETE' });

export const listContacts = () =>
  apiRequest('/v1/me/emergency-contacts', { schema: z.array(emergencyContactSchema) });
export const createContact = (body: EmergencyContactInput) =>
  apiRequest('/v1/me/emergency-contacts', { method: 'POST', body, schema: emergencyContactSchema });
export const deleteContact = (id: string) =>
  apiRequest(`/v1/me/emergency-contacts/${id}`, { method: 'DELETE' });

export const getWorkerProfile = () =>
  apiRequest('/v1/worker/profile', { schema: workerProfileSchema });
export const getLeagueStatus = () =>
  apiRequest('/v1/worker/league', { schema: leagueStatusSchema });
export const updateWorkerProfile = (body: WorkerProfileUpdate) =>
  apiRequest('/v1/worker/profile', { method: 'PATCH', body, schema: workerProfileSchema });

export const getKycStatus = () => apiRequest('/v1/kyc/status', { schema: kycStatusSchema });
export const startKyc = (tier: 1 | 2) =>
  apiRequest('/v1/kyc/start', { method: 'POST', body: { tier }, schema: kycCheckDtoSchema });
export const presignKycDocument = (body: {
  checkId: string;
  type: string;
  contentType: string;
  sizeBytes: number;
}) => apiRequest('/v1/kyc/documents', { method: 'POST', body, schema: kycPresignSchema });
export const confirmKycDocument = (id: string) =>
  apiRequest(`/v1/kyc/documents/${id}/confirm`, { method: 'POST', schema: kycDocumentDtoSchema });
export const submitKyc = (body: KycSubmitInput) =>
  apiRequest('/v1/kyc/submit', { method: 'POST', body, schema: kycCheckDtoSchema });
