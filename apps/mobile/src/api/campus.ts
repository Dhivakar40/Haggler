import { useQuery } from '@tanstack/react-query';
import {
  type ApplyToCampusInput,
  campusApplicationPageSchema,
  campusApplicationSchema,
  campusListingPageSchema,
  campusListingSchema,
  type CampusDecisionInput,
  type CreateCampusListingInput,
  myCampusApplicationPageSchema,
  paymentOrderStartSchema,
  type StudentProfileDto,
  studentProfileSchema,
  type StudentProfileUpdate,
  type UpdateCampusListingInput,
} from '@haggler/shared';
import { z } from 'zod';
import { apiRequest } from './client';

/** Student profile (D-060) */
export const getStudentProfile = () =>
  apiRequest('/v1/student/profile', { schema: studentProfileSchema });
export const createStudentProfile = (body: StudentProfileUpdate) =>
  apiRequest('/v1/student/profile', { method: 'POST', body, schema: studentProfileSchema });
export const updateStudentInstitute = (instituteName: string | undefined) =>
  apiRequest('/v1/student/profile', {
    method: 'PATCH',
    body: { instituteName },
    schema: studentProfileSchema,
  });

export function useStudentProfile(enabled: boolean) {
  return useQuery<StudentProfileDto, unknown>({
    queryKey: ['student', 'profile'],
    queryFn: getStudentProfile,
    enabled,
    retry: false,
  });
}

/** Browsing (student side) */
export const browseCampus = (filters: {
  categorySlug?: string;
  city?: string;
  cursor?: string;
}) => {
  const params = new URLSearchParams();
  if (filters.categorySlug) params.set('categorySlug', filters.categorySlug);
  if (filters.city) params.set('city', filters.city);
  if (filters.cursor) params.set('cursor', filters.cursor);
  return apiRequest(`/v1/campus?${params.toString()}`, { schema: campusListingPageSchema });
};
export const getCampusListing = (id: string) =>
  apiRequest(`/v1/campus/${id}`, { schema: campusListingSchema });
export const applyToCampus = (id: string, body: ApplyToCampusInput) =>
  apiRequest(`/v1/campus/${id}/apply`, { method: 'POST', body, schema: campusApplicationSchema });
export const withdrawFromCampus = (id: string) =>
  apiRequest(`/v1/campus/${id}/apply`, {
    method: 'DELETE',
    schema: z.object({ ok: z.literal(true) }),
  });
export const getMyCampusApplications = (cursor?: string) =>
  apiRequest(`/v1/me/campus-applications${cursor ? `?cursor=${cursor}` : ''}`, {
    schema: myCampusApplicationPageSchema,
  });

export function useBrowseCampus(filters: { categorySlug?: string; city?: string }) {
  return useQuery({
    queryKey: ['campus', 'browse', filters],
    queryFn: () => browseCampus(filters),
  });
}
export function useCampusListing(id: string) {
  return useQuery({ queryKey: ['campus', id], queryFn: () => getCampusListing(id) });
}
export function useMyCampusApplications() {
  return useQuery({
    queryKey: ['campus', 'my-applications'],
    queryFn: () => getMyCampusApplications(),
  });
}

/** Posting and managing (employer side) */
export const createCampusListing = (body: CreateCampusListingInput) =>
  apiRequest('/v1/employer/campus', { method: 'POST', body, schema: campusListingSchema });
export const updateCampusListing = (id: string, body: UpdateCampusListingInput) =>
  apiRequest(`/v1/employer/campus/${id}`, { method: 'PATCH', body, schema: campusListingSchema });
export const getMyCampusListings = (cursor?: string) =>
  apiRequest(`/v1/employer/campus${cursor ? `?cursor=${cursor}` : ''}`, {
    schema: campusListingPageSchema,
  });
export const getCampusListingApplications = (listingId: string, cursor?: string) =>
  apiRequest(`/v1/employer/campus/${listingId}/applications${cursor ? `?cursor=${cursor}` : ''}`, {
    schema: campusApplicationPageSchema,
  });
/** Boosted listing fee (Phase 9, D-069): starts a payment order; complete it via wallet's
 * verify/sandbox-pay. */
export const boostCampusListing = (listingId: string) =>
  apiRequest(`/v1/employer/campus/${listingId}/boost`, {
    method: 'POST',
    schema: paymentOrderStartSchema,
  });
export const decideOnCampusApplication = (
  listingId: string,
  applicationId: string,
  body: CampusDecisionInput,
) =>
  apiRequest(`/v1/employer/campus/${listingId}/applications/${applicationId}/decision`, {
    method: 'POST',
    body,
    schema: campusApplicationSchema,
  });

export function useMyCampusListings() {
  return useQuery({
    queryKey: ['employer', 'campus-listings'],
    queryFn: () => getMyCampusListings(),
  });
}
export function useCampusListingApplications(listingId: string) {
  return useQuery({
    queryKey: ['employer', 'campus-listings', listingId, 'applications'],
    queryFn: () => getCampusListingApplications(listingId),
  });
}
