import { z } from 'zod';
import { mockFetchOnce } from '../test-utils';
import { ApiError, apiGet } from './client';

const schema = z.object({ ok: z.boolean() });

describe('apiGet', () => {
  it('returns validated data', async () => {
    mockFetchOnce({ '/x': { body: { ok: true } } });
    await expect(apiGet('/x', schema)).resolves.toEqual({ ok: true });
  });

  it('turns the server error envelope into an ApiError', async () => {
    mockFetchOnce({
      '/x': {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'Unknown category', requestId: 'r1' } },
      },
    });
    await expect(apiGet('/x', schema)).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'r1',
    });
  });

  it('rejects a response that does not match the shared schema', async () => {
    mockFetchOnce({ '/x': { body: { ok: 'yes' } } });
    await expect(apiGet('/x', schema)).rejects.toBeDefined();
  });

  it('accepts a schema-valid body on HTTP 503 (readiness reports itself that way)', async () => {
    mockFetchOnce({ '/x': { status: 503, body: { ok: false } } });
    await expect(apiGet('/x', schema)).resolves.toEqual({ ok: false });
  });

  it('ApiError carries the code', () => {
    expect(new ApiError(429, 'RATE_LIMITED', 'slow down').code).toBe('RATE_LIMITED');
  });
});
