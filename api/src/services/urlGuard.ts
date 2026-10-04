/**
 * SSRF guard for teacher-supplied provider endpoint URLs.
 *
 * The AI proxy fetches `endpoint_url` server-side with the provider API key in
 * the Authorization header, so an attacker who can set an endpoint could probe
 * internal services or cloud metadata. This blocks non-http(s) schemes,
 * localhost, private/link-local/CGNAT ranges, and the 169.254.169.254 metadata
 * IP. It also resolves DNS to catch rebinding attacks.
 */
import { ApiError } from '../middleware/errorHandler';
import dns from 'dns/promises';

const BLOCKED_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === '::1' || h === '::' ) return true;
  if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;

  // IPv4-mapped (::ffff:169.254.169.254) and NAT64 (64:ff9b::a9fe:a9fe) forms
  // reach the same internal targets. Node normalises the dotted-quad away, so
  // decode the trailing 32 bits back to IPv4 and re-check.
  const mapped = h.match(/^(?:::ffff:|64:ff9b::)(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (isPrivateIPv4(tail)) return true;
    const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      const dotted = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      if (isPrivateIPv4(dotted) || BLOCKED_HOSTS.has(dotted)) return true;
    }
  }
  return false;
}

function checkHost(host: string): void {
  if (!host || BLOCKED_HOSTS.has(host) || isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new ApiError(400, 'Endpoint URL points to a disallowed or internal address');
  }
}

/** Throw ApiError(400) unless `rawUrl` is a public http(s) URL. Resolves DNS to prevent rebinding. */
export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ApiError(400, 'Invalid endpoint URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError(400, 'Endpoint URL must use http or https');
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  checkHost(host);

  // A literal IP has already been checked; anything else must resolve to a
  // public address. Failing open here let an unresolvable-then-internal host
  // through, which is exactly the rebinding case this is meant to stop.
  const isLiteralIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isLiteralIp) return;

  const [addresses, addresses6] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve6(host).catch(() => [] as string[]),
  ]);
  const all = [...addresses, ...addresses6];
  if (all.length === 0) {
    throw new ApiError(400, 'Endpoint URL host could not be resolved');
  }
  for (const addr of all) {
    if (isPrivateIPv4(addr) || isPrivateIPv6(addr) || BLOCKED_HOSTS.has(addr)) {
      throw new ApiError(400, 'Endpoint URL resolves to a disallowed or internal address');
    }
  }
}
