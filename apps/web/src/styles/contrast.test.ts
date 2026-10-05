// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Reads every light-dark() colour token from tokens.css. */
function tokens(): Record<string, { light: string; dark: string }> {
  const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');
  const out: Record<string, { light: string; dark: string }> = {};
  for (const m of css.matchAll(/--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)) {
    out[m[1]!] = { light: m[2]!, dark: m[3]! };
  }
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const t = tokens();
const AA_TEXT = 4.5;

// Every foreground used for text, on every background it is drawn on.
const TEXT = ['text', 'text-muted', 'text-faint', 'accent', 'twin', 'danger', 'warning'];
const BACKGROUNDS = ['bg', 'surface', 'surface-sunken', 'surface-raised'];
const PAIRS: Array<[string, string]> = [
  ...TEXT.flatMap((fg) =>
    BACKGROUNDS.map((bg) => [`color-${fg}`, `color-${bg}`] as [string, string]),
  ),
  ['color-on-accent', 'color-accent'],
  ['color-accent', 'color-accent-soft'],
  ['color-twin', 'color-twin-soft'],
  ['color-danger', 'color-danger-soft'],
  ['color-text', 'color-accent-soft'],
  ['color-text', 'color-warning-soft'],
  ['color-text', 'color-danger-soft'],
  ['color-text-muted', 'color-upstream-soft'],
  ['color-surface', 'color-danger'],
];

describe('design tokens meet WCAG AA contrast', () => {
  it('computes contrast correctly (known values)', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('#aaaaaa', '#ffffff')).toBeLessThan(AA_TEXT);
  });

  it('parses the colour tokens', () => {
    expect(Object.keys(t).length).toBeGreaterThan(20);
  });

  for (const theme of ['light', 'dark'] as const) {
    it.each(PAIRS)(`${theme}: %s on %s`, (fg, bg) => {
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
      expect(contrast(t[fg]![theme], t[bg]![theme])).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});
