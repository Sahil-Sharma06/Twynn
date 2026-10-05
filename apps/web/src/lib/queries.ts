import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnalyticsSummary,
  CreatedGatewayKey,
  Credentials,
  GatewayKeyView,
  ProviderInput,
  ProviderView,
  PublicConfig,
  RequestPage,
  SessionView,
  SignupInput,
} from '@twynn/shared';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Client errors will not fix themselves; only retry network and server failures.
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

export const keys = {
  session: ['session'] as const,
  config: ['config'] as const,
  provider: ['provider'] as const,
  gatewayKeys: ['gateway-keys'] as const,
  summary: ['analytics', 'summary'] as const,
  recentRequests: ['requests', 'recent'] as const,
};

/** The signed-in session, or null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      try {
        return await api<SessionView>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useConfig() {
  return useQuery({
    queryKey: keys.config,
    queryFn: () => api<PublicConfig>('/config'),
    staleTime: Infinity,
  });
}

export function useSignup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SignupInput) =>
      api<SessionView>('/auth/signup', { method: 'POST', body: input }),
    onSuccess: (session) => client.setQueryData(keys.session, session),
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Credentials) =>
      api<SessionView>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (session) => client.setQueryData(keys.session, session),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<undefined>('/auth/logout', { method: 'POST', body: {} }),
    onSuccess: () => {
      client.clear();
      client.setQueryData(keys.session, null);
    },
  });
}

export function useProvider() {
  return useQuery({
    queryKey: keys.provider,
    queryFn: async () => (await api<{ provider: ProviderView | null }>('/provider')).provider,
  });
}

export function useSaveProvider() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProviderInput) =>
      (await api<{ provider: ProviderView }>('/provider', { method: 'PUT', body: input })).provider,
    onSuccess: (provider) => client.setQueryData(keys.provider, provider),
  });
}

export function useGatewayKeys() {
  return useQuery({
    queryKey: keys.gatewayKeys,
    queryFn: async () => (await api<{ keys: GatewayKeyView[] }>('/keys')).keys,
  });
}

export function useCreateKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api<CreatedGatewayKey>('/keys', { method: 'POST', body: { name } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.gatewayKeys }),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => api<AnalyticsSummary>('/analytics/summary'),
  });
}

export function useRecentRequests(limit = 8) {
  return useQuery({
    queryKey: [...keys.recentRequests, limit],
    queryFn: () => api<RequestPage>(`/requests?limit=${limit}`),
  });
}
