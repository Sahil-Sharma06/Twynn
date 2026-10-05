import type { Context } from 'hono';
import type { z } from 'zod';
import { GatewayError } from './errors';

function invalid(issues: z.ZodIssue[]): GatewayError {
  const issue = issues[0];
  const param = issue?.path.join('.') || null;
  return new GatewayError(
    400,
    'invalid_request_error',
    param ? `Invalid "${param}": ${issue?.message}` : 'Invalid request.',
    'invalid_request',
    param,
  );
}

/** Validates the query string, throwing a 400 that names the first invalid parameter. */
export function parseQuery<T extends z.ZodTypeAny>(c: Context, schema: T): z.output<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw invalid(parsed.error.issues);
  return parsed.data;
}

/** Parses and validates a JSON body, throwing a 400 that names the first invalid field. */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new GatewayError(400, 'invalid_request_error', 'Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues);
  return parsed.data;
}
