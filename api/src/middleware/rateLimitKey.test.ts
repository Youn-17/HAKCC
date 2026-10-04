import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { rateLimitKey, ipOnlyKey } from './rateLimitKey';

/**
 * The bucket key is derived from an *unverified* JWT (Supabase signs with
 * ES256, which this process cannot check). These tests pin the two properties
 * that make that safe.
 */
function reqWith(ip: string, token?: string) {
  return {
    ip,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as any;
}

const forged = (sub: string) => jwt.sign({ sub }, 'not-the-real-key');

describe('rateLimitKey', () => {
  it('keeps two students behind one campus NAT in separate buckets', () => {
    const a = rateLimitKey(reqWith('203.0.113.7', forged('student-a')));
    const b = rateLimitKey(reqWith('203.0.113.7', forged('student-b')));
    expect(a).not.toBe(b);
  });

  it('cannot be used to exhaust another user’s bucket', () => {
    // Attacker forges the victim's subject but cannot forge the victim's IP.
    const victim = rateLimitKey(reqWith('198.51.100.4', forged('victim')));
    const attacker = rateLimitKey(reqWith('203.0.113.9', forged('victim')));
    expect(attacker).not.toBe(victim);
  });

  it('always retains the IP, so a token can never widen the bucket', () => {
    expect(rateLimitKey(reqWith('203.0.113.7', forged('x')))).toContain('ip:203.0.113.7');
    expect(rateLimitKey(reqWith('203.0.113.7'))).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP when the token is unparseable', () => {
    expect(rateLimitKey(reqWith('203.0.113.7', 'not-a-jwt'))).toBe('ip:203.0.113.7');
  });
});

describe('ipOnlyKey', () => {
  it('ignores any caller-supplied token', () => {
    // /api/auth runs before authentication: honouring `sub` there would let an
    // attacker mint a fresh bucket per login attempt and brute-force freely.
    const withToken = ipOnlyKey(reqWith('203.0.113.7', forged('anything')));
    const without = ipOnlyKey(reqWith('203.0.113.7'));
    expect(withToken).toBe(without);
    expect(withToken).toBe('ip:203.0.113.7');
  });

  it('still separates distinct source IPs', () => {
    expect(ipOnlyKey(reqWith('203.0.113.7'))).not.toBe(ipOnlyKey(reqWith('203.0.113.8')));
  });
});
