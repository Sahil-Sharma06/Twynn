import type { z } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Record<string, string>;

const friendly: Record<string, (issue: z.ZodIssue) => string> = {
  too_small: (i) =>
    'minimum' in i && i.type === 'string'
      ? Number(i.minimum) <= 1
        ? 'This field is required.'
        : `Use at least ${String(i.minimum)} characters.`
      : i.message,
  too_big: (i) => ('maximum' in i ? `Use at most ${String(i.maximum)} characters.` : i.message),
  invalid_string: (i) =>
    'validation' in i && i.validation === 'email'
      ? 'Enter a valid email address.'
      : 'validation' in i && i.validation === 'url'
        ? 'Enter a full URL, starting with https://'
        : i.message,
};

/** Validates form values with a shared schema, returning parsed data or per-field messages. */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  values: unknown,
): { data: z.output<T>; errors: null } | { data: null; errors: FieldErrors } {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { data: parsed.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    errors[field] ??= friendly[issue.code]?.(issue) ?? issue.message;
  }
  return { data: null, errors };
}

/** Maps an API error onto the field it names, or onto the form as a whole. */
export function apiErrors(error: unknown): FieldErrors {
  if (error instanceof ApiError) return { [error.param ?? 'form']: error.message };
  return { form: 'Your changes were not saved. Check your connection and try again.' };
}
