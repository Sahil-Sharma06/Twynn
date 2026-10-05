import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'twynn-theme';

function read(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Applies a preference by setting data-theme on <html>; tokens.css does the rest. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(read);

  useEffect(() => applyTheme(preference), [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode): the choice still applies for this visit.
    }
  }, []);

  return { preference, choose };
}

/** Called before React renders so the first paint already uses the stored theme. */
export function applyStoredTheme(): void {
  applyTheme(read());
}
