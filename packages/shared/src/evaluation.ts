import { z } from 'zod';
import { CACHE_SETTINGS_LIMITS } from './api';

/** A reviewer's verdict on whether a request and its closest stored prompt mean the same. */
export const twinLabelSchema = z.object({ same: z.boolean() });
export type TwinLabelInput = z.infer<typeof twinLabelSchema>;

/** A real request paired with the closest stored prompt the twin search found for it. */
export interface EvaluationPair {
  requestId: string;
  createdAt: string;
  score: number;
  prompt: string | null;
  matchedPrompt: string | null;
  /** True when labelled "same meaning", false when "different", null when not yet labelled. */
  label: boolean | null;
}

export interface EvaluationData {
  pairs: EvaluationPair[];
}

/** Pairs scoring below this are clearly different and not worth reviewing. */
export const EVALUATION_MIN_SCORE = 0.7;
/** Fewer labels than this and no recommendation is made. */
export const MIN_LABELS_FOR_RECOMMENDATION = 10;
const STEP = 0.005;

export interface LabelledScore {
  score: number;
  same: boolean;
}

export interface Recommendation {
  /** Null until there are enough labels. */
  threshold: number | null;
  /**
   * needs-labels: not enough labels yet.
   * no-false-hits: no pair was labelled different; the threshold keeps every labelled twin.
   * excludes-false-hits: the lowest threshold that serves none of the pairs labelled different.
   */
  basis: 'needs-labels' | 'no-false-hits' | 'excludes-false-hits';
  labelled: number;
  same: number;
  different: number;
  /** Pairs labelled "same" that would still be served at the recommended threshold. */
  sameKept: number;
  confidence: 'low' | 'medium' | 'high';
}

const clamp = (t: number) =>
  Math.min(
    CACHE_SETTINGS_LIMITS.twinThreshold.max,
    Math.max(CACHE_SETTINGS_LIMITS.twinThreshold.min, t),
  );
const round = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Recommends a twin threshold from labelled pairs: the lowest threshold (on a 0.005 grid)
 * at which no pair labelled "different" would be served, which keeps as many genuine
 * twins as possible without a known false hit.
 */
export function recommendThreshold(labels: readonly LabelledScore[]): Recommendation {
  const same = labels.filter((l) => l.same);
  const different = labels.filter((l) => !l.same);
  const base = { labelled: labels.length, same: same.length, different: different.length };
  const confidence: Recommendation['confidence'] =
    labels.length >= 30 && different.length >= 5
      ? 'high'
      : labels.length >= 15 && different.length >= 2
        ? 'medium'
        : 'low';

  if (labels.length < MIN_LABELS_FOR_RECOMMENDATION) {
    return { ...base, threshold: null, basis: 'needs-labels', sameKept: 0, confidence: 'low' };
  }

  let threshold: number;
  let basis: Recommendation['basis'];
  if (different.length === 0) {
    // Floor so the lowest labelled twin is still served.
    threshold = Math.floor(Math.min(...same.map((l) => l.score)) / STEP) * STEP;
    basis = 'no-false-hits';
  } else {
    const worst = Math.max(...different.map((l) => l.score));
    // Strictly above the highest-scoring false hit, since the threshold is inclusive.
    threshold = (Math.floor(worst / STEP + 1e-9) + 1) * STEP;
    basis = 'excludes-false-hits';
  }
  threshold = round(clamp(threshold));
  return {
    ...base,
    threshold,
    basis,
    sameKept: same.filter((l) => l.score >= threshold).length,
    confidence,
  };
}

/** Served twins and false hits among labelled pairs at a given threshold (inclusive). */
export function outcomesAt(labels: readonly LabelledScore[], threshold: number) {
  let twins = 0;
  let falseHits = 0;
  for (const l of labels) {
    if (l.score < threshold) continue;
    if (l.same) twins++;
    else falseHits++;
  }
  return { twins, falseHits };
}
