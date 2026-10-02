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

  /** Seconds to wait, when the server rate-limited us. */
  get retryAfterSeconds(): number | undefined {
    return (this.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  }
}

/**
 * The session store plugs in here (avoids a circular import). `refresh` must be single-flight:
 * many requests failing with 401 at once must trigger ONE refresh, because refresh tokens are
 * single-use and a second concurrent use would look like theft (docs/DECISIONS.md D-023).
 */
export interface AuthHooks {
  getAccessToken: () => string | null;
  /** Resolves true when a new access token is available; false when the session is over. */
  refresh: () => Promise<boolean>;
  onSessionEnded: () => void;
}
let hooks: AuthHooks | null = null;
export function configureAuth(next: AuthHooks | null): void {
  hooks = next;
}

// A hosted free-tier backend (e.g. Render) can spin down after ~15 minutes idle and take up to a
// minute to wake on the next request; 10s was tuned for a LAN dev server and aborts before that
// cold start finishes, surfacing as a confusing generic error. Generous on purpose.
const TIMEOUT_MS = 60_000;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Validates the response body. Omit for 204 responses. */
  schema?: ZodType<T>;
  /** Attach the access token (default true) and refresh it once on 401. */
  auth?: boolean;
  signal?: AbortSignal;
}

async function send(
  path: string,
  opts: RequestOptions<unknown>,
  token: string | null,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  opts.signal?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiRequest<T = void>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  let res = await send(path, opts, useAuth ? (hooks?.getAccessToken() ?? null) : null);

  if (res.status === 401 && useAuth && hooks) {
    // Access token expired: refresh once, then replay the request with the new token.
    const refreshed = await hooks.refresh();
    if (refreshed) {
      res = await send(path, opts, hooks.getAccessToken());
    } else {
      hooks.onSessionEnded();
    }
  }

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const env = errorEnvelopeSchema.safeParse(json);
    if (env.success) {
      const { code, message, details, requestId } = env.data.error;
      throw new ApiError(res.status, code, message, details, requestId);
    }
    // /health/ready deliberately returns a valid body with HTTP 503 when the DB is down.
    const asBody = opts.schema?.safeParse(json);
    if (asBody?.success) return asBody.data;
    throw new ApiError(res.status, 'INTERNAL', `Unexpected response (${res.status})`);
  }
  return (opts.schema ? opts.schema.parse(json) : undefined) as T;
}

/** GET + validate against a shared zod schema. Kept for public endpoints (no auth). */
export function apiGet<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  return apiRequest(path, { schema, signal, auth: false });
}
