import { useEffect, useState } from 'react';

/**
 * Resolves colour tokens (which use light-dark()) to concrete rgb() strings for canvas and
 * WebGL code, and re-resolves when the theme changes.
 */
export function useTokenColors<const T extends readonly string[]>(
  names: T,
): Record<T[number], string> {
  const read = () => {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.append(probe);
    const out = {} as Record<T[number], string>;
    for (const name of names) {
      probe.style.color = `var(${name})`;
      out[name as T[number]] = getComputedStyle(probe).color;
    }
    probe.remove();
    return out;
  };
  const [colors, setColors] = useState(read);

  useEffect(() => {
    const update = () => setColors(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', update);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', update);
    };
    // names is a constant tuple at every call site, so this subscribes once.
  }, []);

  return colors;
}
