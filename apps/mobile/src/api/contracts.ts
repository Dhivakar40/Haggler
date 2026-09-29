import { useQuery } from '@tanstack/react-query';
import {
  type ApplyToContractInput,
  type ContractDecisionInput,
  contractApplicationPageSchema,
  contractApplicationSchema,
  contractListingPageSchema,
  contractListingSchema,
  type CreateContractListingInput,
  type EmployerProfileDto,
  employerProfileSchema,
  type EmployerProfileUpdate,
  myContractApplicationPageSchema,
  type UpdateContractListingInput,
} from '@haggler/shared';
import { z } from 'zod';
import { apiRequest } from './client';

/** Employer profile */
export const getEmployerProfile = () =>
  apiRequest('/v1/employer/profile', { schema: employerProfileSchema });
export const updateEmployerProfile = (body: EmployerProfileUpdate) =>
  apiRequest('/v1/employer/profile', { method: 'PATCH', body, schema: employerProfileSchema });

export function useEmployerProfile(enabled: boolean) {
  return useQuery<EmployerProfileDto, unknown>({
    queryKey: ['employer', 'profile'],
    queryFn: getEmployerProfile,
    enabled,
    retry: false,
  });
}

/** Browsing (Ranger side) */
export const browseContracts = (filters: {
  categorySlug?: string;
  city?: string;
  cursor?: string;
}) => {
  const params = new URLSearchParams();
  if (filters.categorySlug) params.set('categorySlug', filters.categorySlug);
  if (filters.city) params.set('city', filters.city);
  if (filters.cursor) params.set('cursor', filters.cursor);
  return apiRequest(`/v1/contracts?${params.toString()}`, { schema: contractListingPageSchema });
};
export const getContract = (id: string) =>
  apiRequest(`/v1/contracts/${id}`, { schema: contractListingSchema });
export const applyToContract = (id: string, body: ApplyToContractInput) =>
  apiRequest(`/v1/contracts/${id}/apply`, {
    method: 'POST',
    body,
    schema: contractApplicationSchema,
  });
export const withdrawFromContract = (id: string) =>
  apiRequest(`/v1/contracts/${id}/apply`, {
    method: 'DELETE',
    schema: z.object({ ok: z.literal(true) }),
  });
export const getMyApplications = (cursor?: string) =>
  apiRequest(`/v1/me/contract-applications${cursor ? `?cursor=${cursor}` : ''}`, {
    schema: myContractApplicationPageSchema,
  });

export function useBrowseContracts(filters: { categorySlug?: string; city?: string }) {
  return useQuery({
    queryKey: ['contracts', 'browse', filters],
    queryFn: () => browseContracts(filters),
  });
}
export function useContract(id: string) {
  return useQuery({ queryKey: ['contracts', id], queryFn: () => getContract(id) });
}
export function useMyApplications() {
  return useQuery({
    queryKey: ['contracts', 'my-applications'],
    queryFn: () => getMyApplications(),
  });
}

/** Posting and managing (Employer side) */
export const createListing = (body: CreateContractListingInput) =>
  apiRequest('/v1/employer/contracts', { method: 'POST', body, schema: contractListingSchema });
export const updateListing = (id: string, body: UpdateContractListingInput) =>
  apiRequest(`/v1/employer/contracts/${id}`, {
    method: 'PATCH',
    body,
    schema: contractListingSchema,
  });
export const getMyListings = (cursor?: string) =>
  apiRequest(`/v1/employer/contracts${cursor ? `?cursor=${cursor}` : ''}`, {
    schema: contractListingPageSchema,
  });
export const getListingApplications = (listingId: string, cursor?: string) =>
  apiRequest(
    `/v1/employer/contracts/${listingId}/applications${cursor ? `?cursor=${cursor}` : ''}`,
    { schema: contractApplicationPageSchema },
  );
export const decideOnApplication = (
  listingId: string,
  applicationId: string,
  body: ContractDecisionInput,
) =>
  apiRequest(`/v1/employer/contracts/${listingId}/applications/${applicationId}/decision`, {
    method: 'POST',
    body,
    schema: contractApplicationSchema,
  });

export function useMyListings() {
  return useQuery({ queryKey: ['employer', 'listings'], queryFn: () => getMyListings() });
}
export function useListingApplications(listingId: string) {
  return useQuery({
    queryKey: ['employer', 'listings', listingId, 'applications'],
    queryFn: () => getListingApplications(listingId),
  });
}
