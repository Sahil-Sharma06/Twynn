import { describe, expect, it } from 'vitest';
import { outcomesAt, recommendThreshold, type LabelledScore } from './evaluation';

const label = (score: number, same: boolean): LabelledScore => ({ score, same });
const sames = (...scores: number[]) => scores.map((s) => label(s, true));

describe('recommendThreshold', () => {
  it('waits for enough labels', () => {
    const r = recommendThreshold(sames(0.97, 0.96, 0.95));
    expect(r).toMatchObject({ threshold: null, basis: 'needs-labels', labelled: 3 });
  });

  it('picks the lowest threshold that serves no labelled false hit', () => {
    const labels = [
      ...sames(0.99, 0.98, 0.97, 0.96, 0.955, 0.93, 0.92),
      label(0.951, false),
      label(0.9, false),
      label(0.8, false),
    ];
    const r = recommendThreshold(labels);
    expect(r).toMatchObject({ basis: 'excludes-false-hits', threshold: 0.955, sameKept: 5 });
    expect(outcomesAt(labels, r.threshold!)).toEqual({ twins: 5, falseHits: 0 });
    expect(outcomesAt(labels, 0.95).falseHits).toBe(1);
  });

  it('moves strictly above a false hit that sits exactly on the grid', () => {
    const labels = [
      ...sames(0.99, 0.98, 0.97, 0.965, 0.96, 0.955, 0.952, 0.951, 0.96),
      label(0.95, false),
    ];
    expect(recommendThreshold(labels).threshold).toBe(0.955);
  });

  it('keeps every labelled twin when nothing was labelled different', () => {
    const r = recommendThreshold(
      sames(0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.917, 0.99),
    );
    expect(r).toMatchObject({
      basis: 'no-false-hits',
      threshold: 0.915,
      sameKept: 10,
      confidence: 'low',
    });
  });

  it('caps at 1 when a false hit scores near-identically', () => {
    const labels = [
      ...sames(0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.91),
      label(0.999, false),
    ];
    expect(recommendThreshold(labels)).toMatchObject({ threshold: 1, sameKept: 0 });
  });

  it('grows confidence with more labels and more false-hit examples', () => {
    const many = [...sames(...Array.from({ length: 25 }, (_, i) => 0.9 + i * 0.004))];
    const diffs = [0.8, 0.82, 0.84, 0.86, 0.88].map((s) => label(s, false));
    expect(recommendThreshold([...many, ...diffs]).confidence).toBe('high');
    expect(recommendThreshold([...many.slice(0, 13), ...diffs.slice(0, 2)]).confidence).toBe(
      'medium',
    );
  });
});
