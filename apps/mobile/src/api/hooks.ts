import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { readinessSchema, serviceCategorySchema } from '@haggler/shared';
import { apiGet } from './client';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => apiGet('/v1/categories', z.array(serviceCategorySchema), signal),
    staleTime: 60 * 60 * 1000, // the catalog changes rarely
  });
}

export function useServerStatus() {
  return useQuery({
    queryKey: ['server-status'],
    queryFn: ({ signal }) => apiGet('/health/ready', readinessSchema, signal),
    staleTime: 0,
  });
}
