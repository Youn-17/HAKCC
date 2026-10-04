import { ApiError } from '../middleware/errorHandler';

/**
 * Guard a numeric request parameter before it reaches loop arithmetic.
 *
 * The research endpoints feed these values straight into `for` steps and array
 * indices, where bad input does not throw — it hangs. `windowDays: 0` makes the
 * step zero so the loop never advances, stalling the single-threaded API for
 * every user until the process is OOM-killed; neither express-async-errors nor
 * the uncaughtException handler sees anything, because nothing is thrown.
 */
export function numberInRange(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ApiError(400, `${name} must be a number between ${min} and ${max}`);
  }
  return n;
}

/**
 * Clamp a numeric query parameter, falling back on anything unparseable.
 *
 * For pagination and time windows, rejecting an out-of-range value is worse UX
 * than capping it — but the value must never reach the query raw: an unbounded
 * `?limit=` materialises hundreds of MB from a wide select, and a NaN hour
 * count reaches `new Date(NaN).toISOString()`, which throws RangeError and
 * surfaces as a 500 on a request that was merely malformed.
 */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  // Absent means absent. Number(null) and Number('') are both 0, which is
  // finite, so without this an omitted `?hours=` would clamp to the minimum
  // instead of using the default.
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
