import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Copy, Play, Square } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { VOCABULARY, type RequestDetailView } from '@twynn/shared';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { LayerBadge } from '../../components/LayerBadge';
import { ScoreMeter } from '../../components/ScoreMeter';
import { PageHeader, Panel } from '../../components/Ui';
import { api, ApiError } from '../../lib/api';
import { formatMs } from '../../lib/format';
import { runPlayground, type PlaygroundResult } from '../../lib/playground';
import { keys, useCacheSettings, useModels, useProvider } from '../../lib/queries';
import styles from './Playground.module.css';

type Side = 'a' | 'b';

interface PaneState {
  prompt: string;
  skipCache: boolean;
  running: boolean;
  /** Answer text received so far while streaming. */
  partial: string;
  result: PlaygroundResult | null;
  error: string | null;
}

const emptyPane = (): PaneState => ({
  prompt: '',
  skipCache: false,
  running: false,
  partial: '',
  result: null,
  error: null,
});

/** The stored prompt a twin hit matched. The log is written just after the response, so retry briefly. */
function useMatchedPrompt(requestId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.requests, 'detail', requestId],
    queryFn: async () =>
      (await api<{ request: RequestDetailView }>(`/requests/${requestId}`)).request,
    enabled: enabled && requestId !== null,
    staleTime: Infinity,
    retry: (count, error) => count < 5 && error instanceof ApiError && error.status === 404,
    retryDelay: 300,
  });
}

function Outcome({ result, threshold }: { result: PlaygroundResult; threshold: number | null }) {
  const twin = result.status === 'HIT' && result.layer === 'twin';
  const detail = useMatchedPrompt(result.requestId, twin);
  return (
    <div className={styles.outcome}>
      <div className={styles.outcomeHead}>
        <LayerBadge layer={result.layer} status={result.status} />
        <span className={styles.timing}>
          {formatMs(result.totalMs)}
          {result.totalMs - result.firstByteMs > 50 &&
            ` · first byte ${formatMs(result.firstByteMs)}`}
        </span>
        {result.requestId && (
          <Link to={`/app/requests/${result.requestId}`} className={styles.link}>
            View request
          </Link>
        )}
      </div>
      {twin && result.matchScore !== null && threshold !== null && (
        <ScoreMeter score={result.matchScore} threshold={threshold} />
      )}
      {twin && detail.data?.matchedPrompt && (
        <p className={styles.matched}>
          Reused the answer to: <q>{detail.data.matchedPrompt}</q>
        </p>
      )}
    </div>
  );
}

function Pane({
  side,
  label,
  state,
  threshold,
  onChange,
  onSend,
  onStop,
  disabled,
}: {
  side: Side;
  label: string;
  state: PaneState;
  threshold: number | null;
  onChange: (patch: Partial<PaneState>) => void;
  onSend: () => void;
  onStop: () => void;
  disabled: boolean;
}) {
  const promptId = useId();
  const skipId = useId();
  const answer = state.result?.text ?? state.partial;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!disabled && state.prompt.trim()) onSend();
    }
  };

  return (
    <Panel title={label} className={styles.pane}>
      <div className={styles.promptField}>
        <label htmlFor={promptId} className={styles.label}>
          Prompt
        </label>
        <textarea
          id={promptId}
          className={styles.textarea}
          rows={4}
          value={state.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder={side === 'a' ? 'Ask anything…' : 'Try the same question, or reword it…'}
          aria-describedby={`${promptId}-hint`}
        />
        <p id={`${promptId}-hint`} className={styles.hint}>
          Ctrl or ⌘ + Enter to send.
        </p>
      </div>
      <div className={styles.paneActions}>
        <label htmlFor={skipId} className={styles.check}>
          <input
            id={skipId}
            type="checkbox"
            checked={state.skipCache}
            onChange={(e) => onChange({ skipCache: e.target.checked })}
          />
          Skip the cache
        </label>
        {state.running ? (
          <Button
            variant="secondary"
            icon={<Square size={14} aria-hidden="true" />}
            onClick={onStop}
          >
            Stop
          </Button>
        ) : (
          <Button
            icon={<Play size={14} aria-hidden="true" />}
            onClick={onSend}
            disabled={disabled || !state.prompt.trim()}
          >
            Send {label}
          </Button>
        )}
      </div>

      <div className={styles.result} aria-live="polite" aria-busy={state.running || undefined}>
        {state.error ? (
          <Callout tone="error">{state.error}</Callout>
        ) : state.result || state.running ? (
          <>
            {state.result ? (
              <Outcome result={state.result} threshold={threshold} />
            ) : (
              <p className={styles.waiting}>Waiting for the gateway…</p>
            )}
            {state.result?.error ? (
              <Callout tone="error">{state.result.error}</Callout>
            ) : (
              answer && <div className={styles.answer}>{answer}</div>
            )}
          </>
        ) : (
          <p className={styles.idle}>
            The answer appears here, labelled with the layer that produced it.
          </p>
        )}
      </div>
    </Panel>
  );
}

/** One line comparing two finished runs, from what was actually measured. */
export function compareRuns(a: PlaygroundResult, b: PlaygroundResult): string | null {
  if (a.error || b.error || a.httpStatus !== 200 || b.httpStatus !== 200) return null;
  const [fast, slow, fastLabel] = a.totalMs <= b.totalMs ? [a, b, 'A'] : [b, a, 'B'];
  if (slow.totalMs === 0 || fast.totalMs === slow.totalMs) return 'Both took the same time.';
  const ratio = slow.totalMs / Math.max(1, fast.totalMs);
  return ratio >= 1.5
    ? `${fastLabel} was ${ratio.toFixed(1)}× faster (${formatMs(fast.totalMs)} vs ${formatMs(slow.totalMs)}).`
    : `${fastLabel} was ${formatMs(slow.totalMs - fast.totalMs)} faster (${formatMs(fast.totalMs)} vs ${formatMs(slow.totalMs)}).`;
}

/** Send prompts through your own gateway, side by side, and see which layer answers each. */
export function Playground() {
  const provider = useProvider();
  const settings = useCacheSettings();
  const models = useModels('30d');
  const [model, setModel] = useState<string | null>(null);
  const [system, setSystem] = useState('');
  const [stream, setStream] = useState(false);
  const [panes, setPanes] = useState<Record<Side, PaneState>>({ a: emptyPane(), b: emptyPane() });
  const controllers = useRef<Partial<Record<Side, AbortController>>>({});
  const systemId = useId();
  const streamId = useId();

  // Default to the model the workspace uses most; editable either way.
  const modelValue = model ?? models.data?.[0]?.model ?? 'gpt-4o-mini';
  const update = (side: Side, patch: Partial<PaneState>) =>
    setPanes((p) => ({ ...p, [side]: { ...p[side], ...patch } }));

  const send = async (side: Side, prompt = panes[side].prompt) => {
    controllers.current[side]?.abort();
    const controller = new AbortController();
    controllers.current[side] = controller;
    update(side, { running: true, partial: '', result: null, error: null });
    try {
      const result = await runPlayground(
        { model: modelValue.trim(), system, prompt, stream, skipCache: panes[side].skipCache },
        { signal: controller.signal, onText: (partial) => update(side, { partial }) },
      );
      update(side, { running: false, result });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      update(side, {
        running: false,
        error: aborted ? 'Stopped.' : 'Could not reach Twynn. Check your connection and try again.',
      });
    }
  };

  // B goes after A so it can be answered by what A just stored.
  const sendBoth = async () => {
    await send('a');
    await send('b');
  };

  const noProvider = provider.data === null;
  const running = panes.a.running || panes.b.running;
  const comparison =
    panes.a.result && panes.b.result ? compareRuns(panes.a.result, panes.b.result) : null;
  const threshold = settings.data?.semanticEnabled ? settings.data.twinThreshold : null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Playground"
        description={`Real requests through your gateway: they use your provider, fill your cache and appear in your request log, marked as playground. Send a question, then repeat or reword it to watch an ${VOCABULARY.exactHit.label.toLowerCase()} or ${VOCABULARY.twinHit.label.toLowerCase()} happen.`}
      />

      {noProvider && (
        <Callout tone="warning" title="Connect a provider first">
          Requests that miss the cache are forwarded to your provider.{' '}
          <Link to="/app/settings">Connect one in Settings</Link>
        </Callout>
      )}

      <Panel>
        <div className={styles.shared}>
          <Field
            label="Model"
            value={modelValue}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
            className={styles.model}
          />
          <div className={styles.systemField}>
            <label htmlFor={systemId} className={styles.label}>
              System prompt <span className={styles.optional}>(optional, shared by both)</span>
            </label>
            <textarea
              id={systemId}
              className={styles.textarea}
              rows={2}
              value={system}
              onChange={(e) => setSystem(e.target.value)}
            />
          </div>
        </div>
        <div className={styles.toolbar}>
          <label htmlFor={streamId} className={styles.check}>
            <input
              id={streamId}
              type="checkbox"
              checked={stream}
              onChange={(e) => setStream(e.target.checked)}
            />
            Stream responses
          </label>
          <div className={styles.toolbarActions}>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy size={14} aria-hidden="true" />}
              onClick={() => update('b', { prompt: panes.a.prompt })}
              disabled={!panes.a.prompt}
            >
              Copy A to B
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowRightLeft size={14} aria-hidden="true" />}
              onClick={() =>
                setPanes((p) => ({
                  a: { ...p.a, prompt: p.b.prompt },
                  b: { ...p.b, prompt: p.a.prompt },
                }))
              }
            >
              Swap prompts
            </Button>
            <Button
              icon={<Play size={14} aria-hidden="true" />}
              loading={running}
              disabled={noProvider || !panes.a.prompt.trim() || !panes.b.prompt.trim()}
              onClick={() => void sendBoth()}
            >
              Send both
            </Button>
          </div>
        </div>
      </Panel>

      {comparison && (
        <p className={styles.comparison} role="status">
          {comparison}
        </p>
      )}

      <div className={styles.panes}>
        {(['a', 'b'] as const).map((side) => (
          <Pane
            key={side}
            side={side}
            label={side.toUpperCase()}
            state={panes[side]}
            threshold={threshold}
            onChange={(patch) => update(side, patch)}
            onSend={() => void send(side)}
            onStop={() => controllers.current[side]?.abort()}
            disabled={noProvider}
          />
        ))}
      </div>
    </div>
  );
}
