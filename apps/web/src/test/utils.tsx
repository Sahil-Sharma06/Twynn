import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';

type Handler = (init: RequestInit | undefined) => { status: number; body?: unknown };

/** Stubs fetch for /api paths. Unknown paths fail the test loudly. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/, '');
      calls.push({ path, init });
      const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
      const handler = routes[key];
      if (!handler) throw new Error(`Unexpected API call: ${key}`);
      const { status, body } = handler(init);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

/** Minimal EventSource stand-in; tests push events with `emit`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Array<(e: MessageEvent<string>) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  close() {
    this.closed = true;
  }
}

export function installEventSource() {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
}

export function renderWithProviders(ui: ReactNode, routes?: RouteObject[], initialPath = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes ?? [{ path: '*', element: ui }], {
    initialEntries: [initialPath],
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
