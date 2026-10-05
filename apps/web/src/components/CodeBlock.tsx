import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './CodeBlock.module.css';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (permissions, insecure context): the text stays selectable.
    }
  };

  return (
    <button
      type="button"
      className={styles.copy}
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

export function CodeBlock({ code, label = 'Copy code' }: { code: string; label?: string }) {
  return (
    <div className={styles.block}>
      <div className={styles.toolbar}>
        <CopyButton text={code} label={label} />
      </div>
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Code examples in several languages behind an accessible tab list. */
export function CodeTabs<T extends string>({
  tabs,
  labels,
  initial,
}: {
  tabs: Record<T, string>;
  labels: Record<T, string>;
  initial: T;
}) {
  const [active, setActive] = useState<T>(initial);
  const base = useId();
  const keys = Object.keys(tabs) as T[];

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    const next = keys[(index + delta + keys.length) % keys.length] ?? active;
    setActive(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };

  return (
    <div className={styles.block}>
      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Language" className={styles.tabs}>
          {keys.map((key, index) => (
            <button
              key={key}
              id={`${base}-tab-${key}`}
              role="tab"
              type="button"
              aria-selected={key === active}
              aria-controls={`${base}-panel`}
              tabIndex={key === active ? 0 : -1}
              className={styles.tab}
              onClick={() => setActive(key)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {labels[key]}
            </button>
          ))}
        </div>
        <CopyButton text={tabs[active]} label={`Copy ${labels[active]} example`} />
      </div>
      <pre
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${active}`}
        className={styles.pre}
        tabIndex={0}
      >
        <code>{tabs[active]}</code>
      </pre>
    </div>
  );
}
