import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ZodType } from 'zod';
import { errorEnvelopeSchema } from '@haggler/shared';

/**
 * Base URL resolution:
 *  - EXPO_PUBLIC_API_URL wins (required for a physical phone: use your PC's LAN IP).
 *  - Android emulator reaches the host machine at 10.0.2.2.
 *  - iOS simulator / web use localhost.
 */
export function apiBaseUrl(): string {
  const fromEnv =
    process.env.EXPO_PUBLIC_API_URL ??
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 10_000;

/** GET + validate the response against a shared zod schema, so contract drift fails loudly. */
export async function apiGet<T>(
  path: string,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;

    // /health/ready deliberately returns a valid body with HTTP 503 when the DB is down.
    if (!res.ok) {
      const env = errorEnvelopeSchema.safeParse(json);
      if (env.success) {
        const { code, message, details, requestId } = env.data.error;
        throw new ApiError(res.status, code, message, details, requestId);
      }
      const asBody = schema.safeParse(json);
      if (asBody.success) return asBody.data;
      throw new ApiError(res.status, 'INTERNAL', `Unexpected response (${res.status})`);
    }
    return schema.parse(json);
  } finally {
    clearTimeout(timer);
  }
}
