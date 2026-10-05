import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '../lib/theme';
import styles from './ThemeToggle.module.css';

const options: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'Match system theme', Icon: Monitor },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

export function ThemeToggle() {
  const { preference, choose } = useTheme();
  return (
    <div className={styles.group} role="radiogroup" aria-label="Theme">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          className={styles.option}
          onClick={() => choose(value)}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
