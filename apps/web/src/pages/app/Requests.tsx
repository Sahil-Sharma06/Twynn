import { X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { LayerBadge } from '../../components/LayerBadge';
import { Skeleton } from '../../components/Spinner';
import { Chip } from '../../components/Chip';
import { EmptyState, PageHeader, Panel, SearchInput, Select } from '../../components/Ui';
import {
  hasActiveFilters,
  readFilters,
  RESULT_FILTERS,
  toRequestQuery,
  writeFilters,
  type ExplorerFilters,
  type ResultFilter,
} from '../../lib/filters';
import {
  formatDateTime,
  formatInteger,
  formatMs,
  formatRelative,
  formatScore,
  formatUsd,
} from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { useGatewayKeys, useModels, useRequestLog } from '../../lib/queries';
import styles from './Requests.module.css';

const PAGE_SIZE = 50;
const RESULT_OPTIONS = (Object.keys(RESULT_FILTERS) as ResultFilter[]).map((value) => ({
  value,
  label: RESULT_FILTERS[value].label,
}));

/** Every request the gateway handled, filterable; filters live in the URL. */
export function Requests() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const models = useModels('30d');
  const gatewayKeys = useGatewayKeys();

  // Typing updates the URL at once; the fetch waits for a pause so each keystroke is not a request.
  const q = useDebounced(filters.q, 200);
  const log = useRequestLog(toRequestQuery({ ...filters, q }, PAGE_SIZE));
  const requests = log.data?.pages.flatMap((page) => page.requests) ?? [];

  const update = (patch: Partial<ExplorerFilters>) =>
    setParams(writeFilters({ ...filters, ...patch }), { replace: true });
  const keyName = new Map(gatewayKeys.data?.map((k) => [k.id, k.name]));
  const filtered = hasActiveFilters(filters);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Requests"
        description="Every request your gateway handled, with the layer that answered it."
      />

      <div className={styles.filters} role="search" aria-label="Filter requests">
        <SearchInput
          label="Search prompts and models"
          value={filters.q}
          onChange={(value) => update({ q: value })}
        />
        <div className={styles.chips} role="group" aria-label="Result">
          {RESULT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              pressed={filters.result === option.value}
              onClick={() => update({ result: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        <Select
          label="Model"
          hideLabel
          value={filters.model}
          onChange={(e) => update({ model: e.target.value })}
        >
          <option value="">All models</option>
          {filters.model && !models.data?.some((m) => m.model === filters.model) && (
            <option value={filters.model}>{filters.model}</option>
          )}
          {models.data?.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </Select>
        <Select
          label="Source"
          hideLabel
          value={filters.source}
          onChange={(e) => update({ source: e.target.value })}
        >
          <option value="">All sources</option>
          <option value="api">Apps (gateway keys)</option>
          <option value="playground">Playground</option>
        </Select>
        {(gatewayKeys.data?.length ?? 0) > 1 && (
          <Select
            label="Key"
            hideLabel
            value={filters.keyId}
            onChange={(e) => update({ keyId: e.target.value })}
          >
            <option value="">All keys</option>
            {gatewayKeys.data?.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
        )}
      </div>

      {(filters.from || filters.to) && (
        <p className={styles.window}>
          Showing{' '}
          {filters.from && filters.to
            ? `${formatDateTime(filters.from)} to ${formatDateTime(filters.to)}`
            : filters.from
              ? `from ${formatDateTime(filters.from)}`
              : `until ${formatDateTime(filters.to)}`}
          <Button
            variant="ghost"
            size="sm"
            icon={<X size={14} aria-hidden="true" />}
            onClick={() => update({ from: '', to: '' })}
          >
            Any time
          </Button>
        </p>
      )}

      <Panel>
        {log.isError ? (
          <Callout tone="error">
            The request log could not be loaded. Check your filters or refresh to try again.
          </Callout>
        ) : !log.data ? (
          <Skeleton height="20rem" />
        ) : requests.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No requests match"
              action={
                <Button variant="secondary" onClick={() => setParams({}, { replace: true })}>
                  Clear filters
                </Button>
              }
            >
              Try a broader search, another result type or a wider time range.
            </EmptyState>
          ) : (
            <EmptyState title="No requests yet">
              Requests appear here as soon as your app sends them through Twynn.{' '}
              <Link to="/onboarding">Get a snippet</Link>
            </EmptyState>
          )
        ) : (
          <>
            <div className={styles.tableWrap} aria-busy={log.isFetching || undefined}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Result</th>
                    <th scope="col">Prompt</th>
                    <th scope="col">Model</th>
                    <th scope="col" className={styles.num}>
                      Match
                    </th>
                    <th scope="col" className={styles.num}>
                      Latency
                    </th>
                    <th scope="col" className={styles.num}>
                      Tokens
                    </th>
                    <th scope="col" className={styles.num}>
                      Est. saved
                    </th>
                    <th scope="col" className={styles.num}>
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <LayerBadge layer={r.layer} status={r.status} />
                      </td>
                      <td className={styles.prompt}>
                        <Link
                          to={`/app/requests/${r.id}`}
                          state={{ back: params.toString() }}
                          className={styles.rowLink}
                        >
                          {r.promptPreview ?? '(no text)'}
                        </Link>
                        {r.source === 'playground' ? (
                          <span className={styles.key}>Playground</span>
                        ) : (
                          r.keyId &&
                          keyName.has(r.keyId) && (
                            <span className={styles.key}>{keyName.get(r.keyId)}</span>
                          )
                        )}
                      </td>
                      <td className={styles.model}>{r.model ?? '–'}</td>
                      <td className={styles.num}>
                        {r.matchScore === null ? '–' : formatScore(r.matchScore)}
                      </td>
                      <td className={styles.num}>
                        {r.statusCode === 200 ? formatMs(r.latencyMs) : `HTTP ${r.statusCode}`}
                      </td>
                      <td className={styles.num}>
                        {r.promptTokens === null && r.completionTokens === null
                          ? '–'
                          : formatInteger((r.promptTokens ?? 0) + (r.completionTokens ?? 0))}
                      </td>
                      <td className={styles.num}>
                        {r.costSavedUsd === null ? '–' : formatUsd(r.costSavedUsd)}
                      </td>
                      <td className={styles.num}>
                        <time dateTime={r.createdAt} title={formatDateTime(r.createdAt)}>
                          {formatRelative(r.createdAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.footer}>
              <p className={styles.count} aria-live="polite">
                Showing {formatInteger(requests.length)}
                {log.hasNextPage ? '+' : ''} {requests.length === 1 ? 'request' : 'requests'}
              </p>
              {log.hasNextPage && (
                <Button
                  variant="secondary"
                  loading={log.isFetchingNextPage}
                  onClick={() => void log.fetchNextPage()}
                >
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
