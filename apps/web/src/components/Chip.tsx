import type { ButtonHTMLAttributes } from 'react';
import styles from './Chip.module.css';

/** A toggleable filter or shortcut. `pressed` is announced to assistive technology. */
export function Chip({
  pressed,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={[styles.chip, className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
