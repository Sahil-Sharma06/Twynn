import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import { PROMPT_PREVIEW_CHARS, VOCABULARY, type RequestDetailView } from '@twynn/shared';
import { Callout } from '../../components/Callout';
import { LayerBadge } from '../../components/LayerBadge';
import { ScoreMeter } from '../../components/ScoreMeter';
import { Skeleton } from '../../components/Spinner';
import { Facts, Panel } from '../../components/Ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, formatInteger, formatMs, formatScore, formatUsd } from '../../lib/format';
import { useCacheSettings, useGatewayKeys, useRequestDetail } from '../../lib/queries';
import styles from './RequestDetail.module.css';

/** Plain-language account of how the request was answered. */
function outcome(r: RequestDetailView): string {
  if (r.statusCode !== 200) {
    return r.layer === null
      ? `Twynn rejected this request before it reached the cache (HTTP ${r.statusCode}).`
      : `Your provider returned an error (HTTP ${r.statusCode}); nothing was cached.`;
  }
  if (r.status === 'HIT' && r.layer === 'exact')
    return 'Answered from the exact cache: an identical request had been answered before, so your provider was not called.';
  if (r.status === 'HIT' && r.layer === 'twin')
    return 'Answered from the twin cache: an earlier prompt meant the same thing, so its stored answer was reused and your provider was not called.';
  if (r.status === 'BYPASS')
    return 'The request asked Twynn to skip the cache, so your provider answered it and the stored answer was refreshed.';
  return 'Nothing in the cache matched, so your provider answered it. The answer is now stored for repeats and twins.';
}

function TwinComparison({ r, threshold }: { r: RequestDetailView; threshold: number | null }) {
  const twinHit = r.status === 'HIT' && r.layer === 'twin';
  const score = r.matchScore ?? r.nearestScore;
  if (score === null) return null;
  return (
    <Panel
      title={twinHit ? 'The twin it matched' : 'Closest stored prompt'}
      description={
        twinHit
          ? `This request was answered with the stored response to the prompt on the right. ${VOCABULARY.matchScore.label} is ${VOCABULARY.matchScore.technical.toLowerCase()}: 1 means the same meaning.`
          : `The twin search found this as the nearest stored prompt, but it was not close enough to reuse.`
      }
    >
      <div className={styles.pair}>
        <figure>
          <figcaption>This request</figcaption>
          <blockquote>{r.promptPreview ?? '(no text)'}</blockquote>
        </figure>
        <figure>
          <figcaption>{twinHit ? 'Stored prompt it matched' : 'Closest stored prompt'}</figcaption>
          <blockquote>{r.matchedPrompt ?? '(not recorded)'}</blockquote>
        </figure>
      </div>
      {/* Twin hits are judged against the threshold in force at the time, which met it. */}
      {threshold !== null && <ScoreMeter score={score} threshold={threshold} />}
      {!twinHit && threshold !== null && score < threshold && (
        <p className={styles.muted}>
          At a {VOCABULARY.twinThreshold.label.toLowerCase()} of{' '}
          {formatScore(Math.floor(score * 1000) / 1000)} or lower, a request like this would have
          been answered from the cache. <Link to="/app/settings">Review the threshold</Link>
        </p>
      )}
    </Panel>
  );
}

export function RequestDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back;
  const detail = useRequestDetail(id);
  const settings = useCacheSettings();
  const gatewayKeys = useGatewayKeys();
  const r = detail.data;

  const backLink = (
    <Link to={`/app/requests${back ? `?${back}` : ''}`} className={styles.back}>
      <ArrowLeft size={16} aria-hidden="true" /> All requests
    </Link>
  );

  if (detail.isError) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <div className={styles.page}>
        {backLink}
        <Callout
          tone={missing ? 'warning' : 'error'}
          title={missing ? 'Request not found' : 'Could not load this request'}
        >
          {missing
            ? 'It may be older than the log retention window, or belong to another workspace.'
            : 'Refresh the page to try again.'}
        </Callout>
      </div>
    );
  }

  if (!r) {
    return (
      <div className={styles.page}>
        {backLink}
        <Skeleton height="3rem" width="60%" />
        <Skeleton height="12rem" />
      </div>
    );
  }

  const key = gatewayKeys.data?.find((k) => k.id === r.keyId);
  return (
    <div className={styles.page}>
      {backLink}
      <header className={styles.header}>
        <LayerBadge layer={r.layer} status={r.status} />
        <h1>{r.model ?? 'Request'}</h1>
        <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
      </header>
      <p className={styles.outcome}>{outcome(r)}</p>

      <Panel
        title="Prompt"
        description={`The final user message, as logged (up to ${PROMPT_PREVIEW_CHARS} characters).`}
      >
        <blockquote className={styles.prompt}>{r.promptPreview ?? '(no text)'}</blockquote>
      </Panel>

      <TwinComparison r={r} threshold={settings.data?.twinThreshold ?? null} />

      <Panel title="Details">
        <Facts
          items={[
            ['Status', `HTTP ${r.statusCode}`],
            ['Latency', formatMs(r.latencyMs)],
            ['Prompt tokens', r.promptTokens === null ? '–' : formatInteger(r.promptTokens)],
            [
              'Completion tokens',
              r.completionTokens === null ? '–' : formatInteger(r.completionTokens),
            ],
            ['Estimated saved', r.costSavedUsd === null ? '–' : formatUsd(r.costSavedUsd)],
            [VOCABULARY.matchScore.label, r.matchScore === null ? '–' : formatScore(r.matchScore)],
            ['Embedding model', r.embeddingModel ?? '–'],
            [
              'Embedding tokens',
              r.embeddingTokens === null ? '–' : formatInteger(r.embeddingTokens),
            ],
            [
              'Sent from',
              r.source === 'playground'
                ? 'Playground'
                : key
                  ? `Key "${key.name}"${key.revokedAt ? ' (revoked)' : ''}`
                  : '–',
            ],
            ['Request ID', <code key="id">{r.id}</code>],
          ]}
        />
      </Panel>
    </div>
  );
}
