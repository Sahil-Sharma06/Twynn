import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { VOCABULARY, type CacheEntryView, type InvalidateInput } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { CodeBlock } from '../../components/CodeBlock';
import { Skeleton } from '../../components/Spinner';
import {
  ConfirmButton,
  EmptyState,
  Facts,
  PageHeader,
  Panel,
  SearchInput,
  Select,
} from '../../components/Ui';
import { formatDateTime, formatInteger, formatRelative } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import {
  useCacheEntries,
  useCacheEntry,
  useDeleteEntry,
  useInvalidate,
  useModels,
} from '../../lib/queries';
import styles from './Cache.module.css';

/** The assistant's text from a stored chat completion, for a readable preview. */
export function answerText(response: unknown): string | null {
  const choices = (response as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

function EntryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const entry = useCacheEntry(id);
  const remove = useDeleteEntry();
  const e = entry.data;
  return (
    <Panel
      title="Cached response"
      className={styles.detail}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<X size={15} aria-hidden="true" />}
          onClick={onClose}
          aria-label="Close details"
        />
      }
    >
      {entry.isError ? (
        <Callout tone="warning">
          This entry no longer exists; it may have expired or been deleted.
        </Callout>
      ) : !e ? (
        <Skeleton height="12rem" />
      ) : (
        <>
          <div className={styles.qa}>
            <p className={styles.label}>Prompt</p>
            <blockquote>{e.prompt ?? '(not recorded)'}</blockquote>
            <p className={styles.label}>Stored answer</p>
            <blockquote>
              {answerText(e.response) ?? '(no text content; see the raw response)'}
            </blockquote>
          </div>
          <Facts
            items={[
              ['Model', e.model],
              ['Hits', formatInteger(e.hitCount)],
              ['Last hit', e.lastHitAt ? formatRelative(e.lastHitAt) : 'Never'],
              ['Stored', formatDateTime(e.createdAt)],
              ['Expires', formatDateTime(e.expiresAt)],
              [VOCABULARY.twinHit.label, e.twinEligible ? 'Can match twins' : 'Exact repeats only'],
            ]}
          />
          <details className={styles.raw}>
            <summary>Raw response</summary>
            <CodeBlock code={JSON.stringify(e.response, null, 2)} label="Copy raw response" />
          </details>
          <div>
            <ConfirmButton
              label="Delete entry"
              confirmLabel="Delete"
              prompt="Delete this cached response?"
              icon={<Trash2 size={15} aria-hidden="true" />}
              loading={remove.isPending}
              onConfirm={() => remove.mutate(e.id, { onSuccess: onClose })}
            />
          </div>
        </>
      )}
    </Panel>
  );
}

const AGE_OPTIONS = [
  { value: '3600', label: 'older than 1 hour' },
  { value: '86400', label: 'older than 1 day' },
  { value: '604800', label: 'older than 7 days' },
];

/** Bulk deletion, scoped by model, age or everything; always confirmed in place. */
function ClearCache({ model }: { model: string }) {
  const invalidate = useInvalidate();
  const [scope, setScope] = useState('all');
  const [result, setResult] = useState<number | null>(null);
  const criteria: InvalidateInput =
    scope === 'model' && model
      ? { model }
      : scope === 'all'
        ? { all: true }
        : { olderThanSeconds: Number(scope) };
  const describe =
    scope === 'model'
      ? `every entry for ${model}`
      : scope === 'all'
        ? 'every entry'
        : `entries ${AGE_OPTIONS.find((o) => o.value === scope)?.label}`;

  return (
    <Panel
      title="Clear cache"
      description="Deleted entries are gone from both layers immediately; the next matching request goes to your provider."
    >
      <div className={styles.clear}>
        <Select
          label="What to delete"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setResult(null);
          }}
        >
          <option value="all">Everything</option>
          {model && <option value="model">Only {model}</option>}
          {AGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Entries {o.label}
            </option>
          ))}
        </Select>
        <ConfirmButton
          key={scope}
          label="Delete…"
          confirmLabel="Delete"
          prompt={`Delete ${describe}?`}
          icon={<Trash2 size={15} aria-hidden="true" />}
          loading={invalidate.isPending}
          onConfirm={() => invalidate.mutate(criteria, { onSuccess: setResult })}
        />
      </div>
      {result !== null && (
        <p role="status" className={styles.muted}>
          Deleted {formatInteger(result)} {result === 1 ? 'entry' : 'entries'}.
        </p>
      )}
      {invalidate.isError && <Callout tone="error">Nothing was deleted. Please try again.</Callout>}
    </Panel>
  );
}

function EntryRow({
  entry,
  selected,
  onSelect,
}: {
  entry: CacheEntryView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button type="button" className={styles.entry} aria-pressed={selected} onClick={onSelect}>
        <span className={styles.entryPrompt}>{entry.prompt ?? '(no text)'}</span>
        <span className={styles.entryMeta}>
          {entry.model} · {formatInteger(entry.hitCount)} {entry.hitCount === 1 ? 'hit' : 'hits'} ·
          stored {formatRelative(entry.createdAt)}
          {!entry.twinEligible && ' · exact only'}
        </span>
      </button>
    </li>
  );
}

/** Browse what is cached, inspect stored answers and delete entries. */
export function Cache() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const model = params.get('model') ?? '';
  const selected = params.get('entry');
  const models = useModels('30d');
  const debouncedQ = useDebounced(q, 200);
  const list = useCacheEntries({ q: debouncedQ.trim() || undefined, model: model || undefined });
  const entries = list.data?.pages.flatMap((p) => p.entries) ?? [];

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Cache"
        description="The responses Twynn has stored for your workspace. Entries expire after the time to live in Settings."
      />
      <div className={styles.filters} role="search" aria-label="Filter cache entries">
        <SearchInput
          label="Search stored prompts"
          value={q}
          onChange={(value) => update({ q: value })}
        />
        <Select
          label="Model"
          hideLabel
          value={model}
          onChange={(e) => update({ model: e.target.value })}
        >
          <option value="">All models</option>
          {models.data?.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.layout} data-detail={selected ? true : undefined}>
        <Panel>
          {list.isError ? (
            <Callout tone="error">The cache could not be loaded. Refresh to try again.</Callout>
          ) : !list.data ? (
            <Skeleton height="16rem" />
          ) : entries.length === 0 ? (
            q || model ? (
              <EmptyState title="No entries match">Try a different search or model.</EmptyState>
            ) : (
              <EmptyState title="The cache is empty">
                Every successful answer from your provider is stored here, ready to serve repeats
                and twins.
              </EmptyState>
            )
          ) : (
            <>
              <ul className={styles.entries} aria-busy={list.isFetching || undefined}>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === selected}
                    onSelect={() => update({ entry: entry.id === selected ? null : entry.id })}
                  />
                ))}
              </ul>
              {list.hasNextPage && (
                <div>
                  <Button
                    variant="secondary"
                    loading={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </Panel>
        {selected && (
          <EntryDetail key={selected} id={selected} onClose={() => update({ entry: null })} />
        )}
      </div>

      <ClearCache model={model} />
    </div>
  );
}
