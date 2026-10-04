import type { Request } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Rate-limit bucket key.
 *
 * Keying purely by IP puts a whole classroom behind one campus NAT into a
 * single bucket, so one busy student can 429 everyone else mid-lesson. We
 * therefore narrow the bucket by JWT subject as well.
 *
 * The subject is read with jwt.decode, which does NOT verify the signature —
 * Supabase signs with ES256, so this process has no key to check it against.
 * An unverified subject must therefore never *widen* a bucket, only split one:
 *
 *  - The IP always stays in the key. Forging someone else's `sub` lands the
 *    attacker in `ip:<their-ip>|user:<victim>`, which is a different bucket
 *    from the victim's own — so a token cannot be used to exhaust another
 *    user's allowance.
 *  - Minting fresh random subjects still yields fresh buckets, but only on
 *    routes where verifyJWT rejects the forged token first, so the requests
 *    fail before reaching anything expensive.
 *
 * Unauthenticated routes are the exception: there a forged token would be pure
 * bypass, so `ipOnlyKey` is used for /api/auth (see app.ts) to keep login
 * brute-force protection intact.
 */
export function rateLimitKey(req: Request): string {
  const ip = req.ip ?? 'unknown';
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(auth.slice(7)) as { sub?: string } | null;
      if (decoded?.sub) return `ip:${ip}|user:${decoded.sub}`;
    } catch {
      /* fall through to IP */
    }
  }
  return `ip:${ip}`;
}

/**
 * Bucket strictly by IP. Used for endpoints that run before authentication —
 * a caller-supplied token there is untrusted input, not an identity.
 */
export function ipOnlyKey(req: Request): string {
  return `ip:${req.ip ?? 'unknown'}`;
}
