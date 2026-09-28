import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Server-side calls to the Haggler API. The admin token lives in an httpOnly cookie, so page
 * scripts (and any XSS) can never read it; only server components/actions attach it.
 */
export const TOKEN_COOKIE = 'haggler_admin_token';
const API_URL = (process.env.ADMIN_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  const token = init.token ?? (await cookies()).get(TOKEN_COOKIE)?.value;
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    if (res.status === 401 && !path.includes('/auth/login')) redirect('/login');
    throw new AdminApiError(
      res.status,
      e?.code ?? 'ERROR',
      e?.message ?? `Request failed (${res.status})`,
      e?.details,
    );
  }
  return json as T;
}
