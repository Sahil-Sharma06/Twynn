import { Search } from 'lucide-react';
import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Mark } from './Logo';
import { Button } from './Button';
import styles from './Ui.module.css';

/** Page title row with an optional description and actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageTitle}>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

/** A bordered surface section with a heading. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  const id = useId();
  return (
    <section
      className={[styles.panel, className].filter(Boolean).join(' ')}
      aria-labelledby={title ? id : undefined}
    >
      {(title || actions) && (
        <div className={styles.panelHeader}>
          <div>
            {title && <h2 id={id}>{title}</h2>}
            {description && <p className={styles.panelDescription}>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A small set of mutually exclusive options shown as buttons. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  /** Hide the label visually; it stays available to assistive technology. */
  hideLabel?: boolean;
  children: ReactNode;
}

export function Select({ label, hideLabel, children, className, ...rest }: SelectProps) {
  const id = useId();
  return (
    <div className={[styles.selectField, className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : styles.selectLabel}>
        {label}
      </label>
      <select id={id} className={styles.select} {...rest}>
        {children}
      </select>
    </div>
  );
}

/**
 * A destructive action that asks for confirmation in place, instead of a modal: the button
 * turns into "confirm" and "cancel".
 */
export function ConfirmButton({
  label,
  confirmLabel,
  prompt,
  onConfirm,
  loading,
  icon,
}: {
  label: string;
  confirmLabel: string;
  prompt?: string;
  onConfirm: () => void;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="ghost" size="sm" icon={icon} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className={styles.confirm} role="group" aria-label={prompt ?? confirmLabel}>
      {prompt && <span className={styles.confirmPrompt}>{prompt}</span>}
      <Button
        variant="danger"
        size="sm"
        loading={loading ?? false}
        onClick={onConfirm}
        // Move focus here so keyboard users land on the decision.
        autoFocus
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

/** A designed empty state: what will appear here, and how to make it appear. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Mark size={36} animated />
      <p className={styles.emptyTitle}>{title}</p>
      {children && <div className={styles.emptyBody}>{children}</div>}
      {action}
    </div>
  );
}

/** A labelled key/value list. */
export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className={styles.facts}>
      {items.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A search box with a visually hidden label. */
export function SearchInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className={styles.search}>
      <Search size={16} aria-hidden="true" className={styles.searchIcon} />
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input
        id={id}
        type="search"
        placeholder={label}
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
