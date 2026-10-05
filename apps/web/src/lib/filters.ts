import type { RequestQuery } from './queries';

/** Result filters offered in the explorer, each a combination of API filters. */
export const RESULT_FILTERS = {
  all: { label: 'All', query: {} },
  exact: { label: 'Exact hits', query: { layer: 'exact', status: 'HIT' } },
  twin: { label: 'Twin hits', query: { layer: 'twin', status: 'HIT' } },
  miss: { label: 'Misses', query: { status: 'MISS' } },
  bypass: { label: 'Bypassed', query: { status: 'BYPASS' } },
  errors: { label: 'Errors', query: { errorsOnly: 'true' } },
} as const satisfies Record<string, { label: string; query: RequestQuery }>;
export type ResultFilter = keyof typeof RESULT_FILTERS;

export interface ExplorerFilters {
  result: ResultFilter;
  q: string;
  model: string;
  keyId: string;
  from: string;
  to: string;
}

const isResult = (value: string | null): value is ResultFilter =>
  value !== null && value in RESULT_FILTERS;

/** Explorer filters from the URL, so every view can be linked to and survives reloads. */
export function readFilters(params: URLSearchParams): ExplorerFilters {
  const result = params.get('result');
  return {
    result: isResult(result) ? result : 'all',
    q: params.get('q') ?? '',
    model: params.get('model') ?? '',
    keyId: params.get('keyId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

/** The URL for a set of filters; defaults are left out. */
export function writeFilters(filters: ExplorerFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === 'result' && value === 'all')) params.set(key, value);
  }
  return params;
}

/** The API query for a set of filters. */
export function toRequestQuery(filters: ExplorerFilters, limit: number): RequestQuery {
  return {
    ...RESULT_FILTERS[filters.result].query,
    q: filters.q.trim() || undefined,
    model: filters.model || undefined,
    keyId: filters.keyId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    limit,
  };
}

export const hasActiveFilters = (filters: ExplorerFilters) =>
  writeFilters(filters).toString() !== '';
