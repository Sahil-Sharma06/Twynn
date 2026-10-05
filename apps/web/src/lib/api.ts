/** An error response from the Twynn API, in its OpenAI-style error shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
    readonly param: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { message?: string; code?: string | null; param?: string | null };
}

/**
 * Calls the dashboard API on the same origin, so the session cookie is sent and
 * the browser's Origin header satisfies the API's CSRF check.
 */
export async function api<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined && {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new ApiError(0, 'Could not reach Twynn. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & ErrorBody) | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.message ?? `Something went wrong (HTTP ${res.status}).`,
      data?.error?.code ?? null,
      data?.error?.param ?? null,
    );
  }
  return data as T;
}
