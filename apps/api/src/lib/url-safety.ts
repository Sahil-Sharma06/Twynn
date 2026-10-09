import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** IPv4-mapped IPv6 (::ffff:a.b.c.d), which URL parsing rewrites to hex (::ffff:7f00:1). */
function mappedIPv4(lower: string): string | null {
  if (!lower.startsWith('::ffff:')) return null;
  const rest = lower.slice(7);
  if (rest.includes('.')) return rest;
  const [hi, lo] = rest.split(':').map((h) => parseInt(h, 16));
  if (hi === undefined || lo === undefined || Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = mappedIPv4(lower);
  if (mapped) return isPrivateIPv4(mapped);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

/**
 * Checks a tenant-supplied provider URL. In production it must be https and must
 * not point at loopback, link-local or private addresses (SSRF protection).
 * Returns an error message, or null when the URL is acceptable.
 */
export function providerUrlProblem(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Must be a valid URL.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Must use http or https.';
  if (url.username || url.password) return 'Must not contain credentials.';
  if (url.search || url.hash) return 'Must not contain a query string or fragment.';
  if (!production) return null;

  if (url.protocol !== 'https:') return 'Must use https.';
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'Must be a public host.';
  }
  const family = isIP(host);
  if ((family === 4 && isPrivateIPv4(host)) || (family === 6 && isPrivateIPv6(host))) {
    return 'Must be a public host.';
  }
  return null;
}

/** Any address a provider URL must never reach: loopback, private, link-local or metadata. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 4 ? isPrivateIPv4(ip) : family === 6 ? isPrivateIPv6(ip) : true;
}

export type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const dnsLookup: Lookup = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolves the provider host and rejects it if any address it resolves to is private, so a
 * public-looking name pointing at an internal address is caught. Returns a problem or null.
 */
export async function resolvedHostProblem(
  raw: string,
  lookupFn: Lookup = dnsLookup,
): Promise<string | null> {
  let host: string;
  try {
    host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return 'Must be a valid URL.';
  }
  if (isIP(host)) return isPrivateAddress(host) ? 'Must be a public host.' : null;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookupFn(host);
  } catch {
    return 'The host could not be resolved.';
  }
  if (addresses.length === 0) return 'The host could not be resolved.';
  return addresses.some((a) => isPrivateAddress(a.address))
    ? 'Must resolve only to public addresses.'
    : null;
}

/** Checks a provider URL before it is used; returns a problem or null. */
export type HostGuard = (baseUrl: string) => Promise<string | null>;

/**
 * A resolved-host check with a short per-host cache, run before every upstream call so a
 * host whose DNS later changes to a private address is blocked too.
 */
export function createHostGuard(lookupFn: Lookup = dnsLookup, ttlMs = 60_000): HostGuard {
  const cache = new Map<string, { problem: string | null; until: number }>();
  return async (baseUrl) => {
    let key: string;
    try {
      key = new URL(baseUrl).hostname;
    } catch {
      return 'Must be a valid URL.';
    }
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.problem;
    const problem = await resolvedHostProblem(baseUrl, lookupFn);
    cache.set(key, { problem, until: Date.now() + ttlMs });
    return problem;
  };
}
