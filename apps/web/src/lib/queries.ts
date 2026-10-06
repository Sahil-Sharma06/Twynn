import {
  keepPreviousData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AnalyticsSummary,
  CacheEntryDetail,
  CacheEntryPage,
  CacheSettings,
  CacheSettingsUpdate,
  CreatedGatewayKey,
  EvaluationData,
  Credentials,
  GatewayKeyView,
  InvalidateInput,
  ModelBreakdown,
  ProviderInput,
  ProviderView,
  PublicConfig,
  RequestDetailView,
  RequestPage,
  SessionView,
  SignupInput,
  ThresholdPreview,
  Timeseries,
} from '@twynn/shared';
import { api, ApiError } from './api';
import { rangeParams, type RangeKey } from './range';

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
  analytics: ['analytics'] as const,
  summary: ['analytics', 'summary'] as const,
  requests: ['requests'] as const,
  recentRequests: ['requests', 'recent'] as const,
  cache: ['cache'] as const,
  settings: ['settings'] as const,
  evaluation: ['evaluation'] as const,
};

/** Drops undefined and empty values so URLs and query keys stay canonical. */
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) search.set(key, String(value));
  }
  return search.toString();
}

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

export function useRevokeKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.gatewayKeys }),
  });
}

export function useSummary(range: RangeKey = '24h') {
  return useQuery({
    queryKey: [...keys.summary, range],
    queryFn: () => api<AnalyticsSummary>(`/analytics/summary?${rangeParams(range)}`),
    placeholderData: keepPreviousData,
  });
}

export function useTimeseries(range: RangeKey) {
  return useQuery({
    queryKey: [...keys.analytics, 'timeseries', range],
    queryFn: () => api<Timeseries>(`/analytics/timeseries?${rangeParams(range)}`),
    placeholderData: keepPreviousData,
  });
}

export function useModels(range: RangeKey) {
  return useQuery({
    queryKey: [...keys.analytics, 'models', range],
    queryFn: async () =>
      (await api<{ models: ModelBreakdown[] }>(`/analytics/models?${rangeParams(range)}`)).models,
    placeholderData: keepPreviousData,
  });
}

export type RequestQuery = Record<string, string | number | boolean | undefined>;

/** The request log, newest first, paged with a cursor. */
export function useRequestLog(filters: RequestQuery, { enabled = true } = {}) {
  const query = toQuery(filters);
  return useInfiniteQuery({
    queryKey: [...keys.requests, 'log', query],
    queryFn: ({ pageParam }) =>
      api<RequestPage>(`/requests?${toQuery({ ...filters, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRequestDetail(id: string) {
  return useQuery({
    queryKey: [...keys.requests, 'detail', id],
    queryFn: async () => (await api<{ request: RequestDetailView }>(`/requests/${id}`)).request,
    staleTime: Infinity, // logged requests never change
  });
}

export function useRecentRequests(limit = 8) {
  return useQuery({
    queryKey: [...keys.recentRequests, limit],
    queryFn: () => api<RequestPage>(`/requests?limit=${limit}`),
  });
}

export function useCacheEntries(filters: { q?: string | undefined; model?: string | undefined }) {
  const query = toQuery(filters);
  return useInfiniteQuery({
    queryKey: [...keys.cache, 'list', query],
    queryFn: ({ pageParam }) =>
      api<CacheEntryPage>(`/cache?${toQuery({ ...filters, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCacheEntry(id: string | null) {
  return useQuery({
    queryKey: [...keys.cache, 'detail', id],
    queryFn: async () => (await api<{ entry: CacheEntryDetail }>(`/cache/${id}`)).entry,
    enabled: id !== null,
  });
}

export function useDeleteEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/cache/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.cache }),
  });
}

export function useInvalidate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (criteria: InvalidateInput) =>
      (await api<{ deleted: number }>('/cache/invalidate', { method: 'POST', body: criteria }))
        .deleted,
    onSuccess: () => client.invalidateQueries({ queryKey: keys.cache }),
  });
}

export function useCacheSettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => (await api<{ settings: CacheSettings }>('/settings')).settings,
  });
}

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: CacheSettingsUpdate) =>
      (await api<{ settings: CacheSettings }>('/settings', { method: 'PATCH', body: patch }))
        .settings,
    onSuccess: (settings) => client.setQueryData(keys.settings, settings),
  });
}

export function useThresholdPreview(days = 7) {
  return useQuery({
    queryKey: [...keys.analytics, 'threshold-preview', days],
    queryFn: () => api<ThresholdPreview>(`/analytics/threshold-preview?days=${days}`),
  });
}

export function useEvaluation() {
  return useQuery({
    queryKey: keys.evaluation,
    queryFn: () => api<EvaluationData>('/evaluation'),
  });
}

/** Sets (true/false) or clears (null) a pair's label, updating the list immediately. */
export function useLabelPair() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, same }: { requestId: string; same: boolean | null }) =>
      same === null
        ? api<undefined>(`/evaluation/labels/${requestId}`, { method: 'DELETE' })
        : api<undefined>(`/evaluation/labels/${requestId}`, { method: 'PUT', body: { same } }),
    onMutate: async ({ requestId, same }) => {
      await client.cancelQueries({ queryKey: keys.evaluation });
      const previous = client.getQueryData<EvaluationData>(keys.evaluation);
      client.setQueryData<EvaluationData>(
        keys.evaluation,
        (data) =>
          data && {
            pairs: data.pairs.map((p) => (p.requestId === requestId ? { ...p, label: same } : p)),
          },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) client.setQueryData(keys.evaluation, context.previous);
    },
  });
}
