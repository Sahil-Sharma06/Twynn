import { useState } from 'react';
import { Link } from 'react-router';
import {
  EVALUATION_MIN_SCORE,
  MIN_LABELS_FOR_RECOMMENDATION,
  outcomesAt,
  recommendThreshold,
  VOCABULARY,
  type EvaluationPair,
  type Recommendation,
} from '@twynn/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Skeleton } from '../../components/Spinner';
import { EmptyState, PageHeader, Panel, Segmented } from '../../components/Ui';
import { formatInteger, formatScore } from '../../lib/format';
import { useCacheSettings, useEvaluation, useLabelPair, useSaveSettings } from '../../lib/queries';
import styles from './Evaluate.module.css';

type View = 'todo' | 'done' | 'all';

const position = (score: number) =>
  `${(((Math.max(EVALUATION_MIN_SCORE, score) - EVALUATION_MIN_SCORE) / (1 - EVALUATION_MIN_SCORE)) * 100).toFixed(2)}%`;

/** Every pair on one axis, coloured by label, with the current and recommended thresholds. */
function ScoreStrip({
  pairs,
  current,
  recommended,
}: {
  pairs: EvaluationPair[];
  current: number;
  recommended: number | null;
}) {
  return (
    <figure className={styles.strip}>
      <div className={styles.track} aria-hidden="true">
        {pairs.map((p) => (
          <span
            key={p.requestId}
            className={styles.dot}
            data-label={p.label === null ? 'none' : p.label ? 'same' : 'different'}
            style={{ left: position(p.score) }}
          />
        ))}
        <span className={styles.marker} data-kind="current" style={{ left: position(current) }}>
          <span>Current</span>
        </span>
        {recommended !== null && recommended !== current && (
          <span
            className={styles.marker}
            data-kind="recommended"
            style={{ left: position(recommended) }}
          >
            <span>Recommended</span>
          </span>
        )}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>{EVALUATION_MIN_SCORE.toFixed(2)}</span>
        <span>1.00</span>
      </div>
      <figcaption className={styles.legend}>
        <span data-label="same">Same meaning</span>
        <span data-label="different">Different</span>
        <span data-label="none">Not reviewed</span>
      </figcaption>
    </figure>
  );
}

function RecommendationPanel({
  rec,
  current,
  labels,
}: {
  rec: Recommendation;
  current: number;
  labels: Array<{ score: number; same: boolean }>;
}) {
  const save = useSaveSettings();
  const now = outcomesAt(labels, current);
  if (rec.threshold === null) {
    return (
      <Callout title="Label a few more pairs">
        Review at least {MIN_LABELS_FOR_RECOMMENDATION} pairs ({formatInteger(rec.labelled)} so far)
        and Twynn will recommend a {VOCABULARY.twinThreshold.label.toLowerCase()}. Pairs near your
        current threshold are the most useful, so they are listed first.
      </Callout>
    );
  }
  const then = outcomesAt(labels, rec.threshold);
  const same = rec.threshold === current;
  return (
    <div className={styles.rec}>
      <div className={styles.recValue}>
        <span className={styles.recLabel}>Recommended</span>
        <strong>{formatScore(rec.threshold)}</strong>
        <span className={styles.confidence} data-level={rec.confidence}>
          {rec.confidence} confidence
        </span>
      </div>
      <div className={styles.recBody}>
        <p>
          {rec.basis === 'excludes-false-hits'
            ? `The lowest threshold at which none of the ${formatInteger(rec.different)} pairs you marked different would be served. It keeps ${formatInteger(rec.sameKept)} of ${formatInteger(rec.same)} genuine twins.`
            : `You have not marked any pair as different, so this keeps all ${formatInteger(rec.same)} twins you reviewed. Mark pairs that differ in a way that matters, so the recommendation can steer clear of them.`}
        </p>
        <p className={styles.compare}>
          At your current {formatScore(current)}: {formatInteger(now.twins)} twins served,{' '}
          <span data-bad={now.falseHits > 0 || undefined}>
            {formatInteger(now.falseHits)} false hits
          </span>
          . At {formatScore(rec.threshold)}: {formatInteger(then.twins)} twins,{' '}
          {formatInteger(then.falseHits)} false hits (among the pairs you reviewed).
        </p>
        <div className={styles.recActions}>
          <Button
            disabled={same}
            loading={save.isPending}
            onClick={() => save.mutate({ twinThreshold: rec.threshold ?? current })}
          >
            {same ? 'Already your threshold' : `Use ${formatScore(rec.threshold)}`}
          </Button>
          <Link to="/app/settings">Preview it in Settings first</Link>
        </div>
        {save.isSuccess && (
          <p role="status" className={styles.saved}>
            Saved. New requests use the new threshold.
          </p>
        )}
        {save.isError && <Callout tone="error">The threshold was not saved. Try again.</Callout>}
      </div>
    </div>
  );
}

function PairCard({ pair, current }: { pair: EvaluationPair; current: number }) {
  const label = useLabelPair();
  const set = (same: boolean | null) => label.mutate({ requestId: pair.requestId, same });
  return (
    <li
      className={styles.pair}
      data-label={pair.label === null ? 'none' : pair.label ? 'same' : 'different'}
    >
      <div className={styles.pairHead}>
        <span className={styles.score}>{formatScore(pair.score)}</span>
        {pair.label === null ? (
          <Badge tone="neutral">Not reviewed</Badge>
        ) : pair.label ? (
          <Badge tone="twin">Same meaning</Badge>
        ) : (
          <Badge tone="danger">Different</Badge>
        )}
        <span className={styles.served}>
          {pair.score >= current
            ? 'Served as a twin at your threshold'
            : 'Not served at your threshold'}
        </span>
      </div>
      <div className={styles.prompts}>
        <q>{pair.prompt ?? '(no text)'}</q>
        <q>{pair.matchedPrompt ?? '(not recorded)'}</q>
      </div>
      <div className={styles.verdict} role="group" aria-label="Do these mean the same?">
        <Button
          size="sm"
          variant={pair.label === true ? 'primary' : 'secondary'}
          aria-pressed={pair.label === true}
          onClick={() => set(pair.label === true ? null : true)}
        >
          Same meaning
        </Button>
        <Button
          size="sm"
          variant={pair.label === false ? 'danger' : 'secondary'}
          aria-pressed={pair.label === false}
          onClick={() => set(pair.label === false ? null : false)}
        >
          Different
        </Button>
        {label.isError && (
          <span role="alert" className={styles.error}>
            Not saved. Try again.
          </span>
        )}
      </div>
    </li>
  );
}

/** Review real twin-search pairs and get a threshold recommendation from the verdicts. */
export function Evaluate() {
  const evaluation = useEvaluation();
  const settings = useCacheSettings();
  const [view, setView] = useState<View>('todo');

  const pairs = evaluation.data?.pairs ?? [];
  const current = settings.data?.twinThreshold;
  const labels = pairs.flatMap((p) =>
    p.label === null ? [] : [{ score: p.score, same: p.label }],
  );
  const rec = recommendThreshold(labels);
  const todo = pairs.filter((p) => p.label === null);
  // Review the most informative pairs first: those closest to the current threshold.
  const shown = (
    view === 'todo' ? todo : view === 'done' ? pairs.filter((p) => p.label !== null) : pairs
  )
    .slice()
    .sort((a, b) =>
      current === undefined ? 0 : Math.abs(a.score - current) - Math.abs(b.score - current),
    );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Evaluate twins"
        description={`A false hit is a twin hit that should not have been one: two prompts that score close but need different answers. Review real pairs from your traffic, and Twynn recommends the ${VOCABULARY.twinThreshold.label.toLowerCase()} that avoids the false hits you find.`}
      />

      {evaluation.isError || settings.isError ? (
        <Callout tone="error">The evaluation could not be loaded. Refresh to try again.</Callout>
      ) : !evaluation.data || current === undefined ? (
        <Skeleton height="20rem" />
      ) : pairs.length === 0 ? (
        <Panel>
          <EmptyState title="Nothing to review yet">
            Pairs appear here when requests miss the exact cache and the twin search finds a stored
            prompt scoring {EVALUATION_MIN_SCORE.toFixed(2)} or higher, from the last 30 days. Send
            some real or reworded traffic, for example from the{' '}
            <Link to="/app/playground">playground</Link>.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <Panel title="Recommendation">
            <RecommendationPanel rec={rec} current={current} labels={labels} />
            <ScoreStrip pairs={pairs} current={current} recommended={rec.threshold} />
            <p className="visually-hidden">
              {formatInteger(pairs.length)} pairs: {formatInteger(rec.same)} marked same,{' '}
              {formatInteger(rec.different)} marked different, {formatInteger(todo.length)} not
              reviewed.
            </p>
          </Panel>

          <Panel
            title="Pairs"
            description="Each pair is a real request and the closest stored prompt the twin search found for it."
            actions={
              <Segmented
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  { value: 'todo', label: `To review (${todo.length})` },
                  { value: 'done', label: `Reviewed (${pairs.length - todo.length})` },
                  { value: 'all', label: 'All' },
                ]}
              />
            }
          >
            {shown.length === 0 ? (
              <p className={styles.muted}>
                {view === 'todo' ? 'Everything has been reviewed.' : 'No reviewed pairs yet.'}
              </p>
            ) : (
              <ul className={styles.pairs}>
                {shown.map((pair) => (
                  <PairCard key={pair.requestId} pair={pair} current={current} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
