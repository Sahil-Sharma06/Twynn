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
