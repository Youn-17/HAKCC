import { describe, it, expect } from 'vitest';
import { numberInRange, clampNumber } from './requestParams';
import { ApiError } from '../middleware/errorHandler';

describe('numberInRange', () => {
  it('rejects zero, which would make a windowed loop never advance', () => {
    // POST /research/equity-advanced { windowDays: 0 } used to hang the whole API.
    expect(() => numberInRange(0, 'windowDays', 1, 90, 7)).toThrow(ApiError);
  });

  it('rejects negatives, which index off the start of a sequence', () => {
    expect(() => numberInRange(-1, 'lag', 1, 5, 1)).toThrow(ApiError);
  });

  it('rejects non-numeric and non-finite input', () => {
    expect(() => numberInRange('abc', 'windowDays', 1, 90, 7)).toThrow(ApiError);
    expect(() => numberInRange(Infinity, 'windowDays', 1, 90, 7)).toThrow(ApiError);
    expect(() => numberInRange(NaN, 'windowDays', 1, 90, 7)).toThrow(ApiError);
  });

  it('rejects values past the upper bound', () => {
    expect(() => numberInRange(100000, 'maxNodes', 1, 500, 30)).toThrow(ApiError);
  });

  it('answers 400, not 500, so a bad request is not logged as a server fault', () => {
    try {
      numberInRange(0, 'windowDays', 1, 90, 7);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ApiError).statusCode).toBe(400);
    }
  });

  it('falls back when the parameter is omitted', () => {
    expect(numberInRange(undefined, 'windowDays', 1, 90, 7)).toBe(7);
    expect(numberInRange(null, 'lag', 1, 5, 1)).toBe(1);
  });

  it('passes valid values through, including numeric strings from JSON bodies', () => {
    expect(numberInRange(30, 'windowDays', 1, 90, 7)).toBe(30);
    expect(numberInRange('14', 'windowDays', 1, 90, 7)).toBe(14);
    expect(numberInRange(1, 'lag', 1, 5, 1)).toBe(1);
    expect(numberInRange(90, 'windowDays', 1, 90, 7)).toBe(90);
  });
});

describe('clampNumber', () => {
  it('caps an unbounded limit instead of materialising the whole table', () => {
    // GET /spaces/:id/notes?limit=1000000 against a select that inlines
    // author_profile and note_feedbacks.
    expect(clampNumber('1000000', 1, 500, 200)).toBe(500);
  });

  it('falls back on unparseable input rather than producing NaN', () => {
    // ?hours=abc previously reached new Date(NaN).toISOString() → RangeError → 500.
    expect(clampNumber('abc', 1, 8760, 48)).toBe(48);
    expect(clampNumber(undefined, 1, 8760, 48)).toBe(48);
    expect(clampNumber(null, 1, 8760, 48)).toBe(48);
    expect(clampNumber(NaN, 1, 8760, 48)).toBe(48);
    expect(clampNumber(Infinity, 1, 8760, 48)).toBe(48);
    // Number('') is 0 — finite, so an omitted ?hours= would otherwise clamp
    // to the minimum rather than fall back to the default.
    expect(clampNumber('', 1, 8760, 48)).toBe(48);
  });

  it('raises a negative offset to the floor', () => {
    expect(clampNumber('-5', 0, 1_000_000, 0)).toBe(0);
  });

  it('truncates fractions so the value is a usable index', () => {
    expect(clampNumber('12.7', 1, 500, 200)).toBe(12);
  });

  it('never throws — pagination should degrade, not fail the request', () => {
    expect(() => clampNumber('💥', 1, 500, 200)).not.toThrow();
    expect(clampNumber('💥', 1, 500, 200)).toBe(200);
  });

  it('passes valid values through untouched', () => {
    expect(clampNumber('50', 1, 500, 200)).toBe(50);
    expect(clampNumber(0, 0, 1_000_000, 0)).toBe(0);
  });
});
