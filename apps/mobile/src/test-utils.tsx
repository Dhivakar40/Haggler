import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import '../src/i18n';
import { ThemeProvider } from './theme/ThemeProvider';

/** Renders with the same providers the real app uses (theme, i18n, react-query). */
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

export function mockFetchOnce(routes: Record<string, { status?: number; body: unknown }>) {
  const fn = jest.fn(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const hit = routes[path];
    if (!hit) throw new Error(`unmocked fetch ${path}`);
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      text: async () => JSON.stringify(hit.body),
    };
  });
  (global as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}
