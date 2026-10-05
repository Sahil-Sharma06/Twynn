import type { Context } from 'hono';
import type { z } from 'zod';
import { GatewayError } from './errors';

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
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const param = issue?.path.join('.') || null;
    throw new GatewayError(
      400,
      'invalid_request_error',
      param ? `Invalid "${param}": ${issue?.message}` : 'Invalid request body.',
      'invalid_request',
      param,
    );
  }
  return parsed.data;
}
