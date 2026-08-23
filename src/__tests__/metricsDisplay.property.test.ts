/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.2
 */
/**
 * Property-based tests for metrics display computation.
 *
 * Feature: chat-streaming-richtext-metrics
 * - Property 9: Metrics display computation correctness
 *
 * Validates: Requirements 3.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Computes tokens per second from a token count and duration in nanoseconds.
 * Returns "n/a" for invalid inputs (null, non-finite, zero or negative duration).
 *
 * Copied inline from src/App.tsx for isolated testing.
 */
function computeTokensPerSecond(tokens: number | null, durationNs: number | null): string {
  if (!Number.isFinite(Number(tokens)) || !Number.isFinite(Number(durationNs)) || Number(durationNs) <= 0) {
    return 'n/a';
  }

  const tokensPerSecond = Number(tokens) / (Number(durationNs) / 1_000_000_000);
  return `${tokensPerSecond.toFixed(2)} tok/s`;
}

describe('Feature: chat-streaming-richtext-metrics, Property 9: Metrics display computation correctness', () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * For any positive evalCount and positive evalDuration,
   * computeTokensPerSecond SHALL return a string representation of
   * evalCount / (evalDuration / 1_000_000_000) formatted to 2 decimal places
   * followed by " tok/s".
   */
  it('for positive tokens and positive duration, returns correctly formatted tok/s', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000_000_000 }),
        (tokens, durationNs) => {
          const result = computeTokensPerSecond(tokens, durationNs);
          const expectedValue = tokens / (durationNs / 1_000_000_000);
          const expected = `${expectedValue.toFixed(2)} tok/s`;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * The same property applies for promptEvalCount and promptEvalDuration —
   * any pair of positive finite numbers produces the correct formatted result.
   */
  it('for any positive finite numbers, the formula evalCount / (evalDuration / 1e9) holds', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        (tokens, durationNs) => {
          const result = computeTokensPerSecond(tokens, durationNs);
          const expectedValue = Number(tokens) / (Number(durationNs) / 1_000_000_000);
          const expected = `${expectedValue.toFixed(2)} tok/s`;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * For null duration, Number(null) === 0, so durationNs <= 0 check triggers "n/a".
   */
  it('returns "n/a" when duration is null (coerces to 0, fails duration > 0 check)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        (tokens) => {
          expect(computeTokensPerSecond(tokens, null)).toBe('n/a');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "n/a" when both tokens and duration are null', () => {
    expect(computeTokensPerSecond(null, null)).toBe('n/a');
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * When tokens is null, Number(null) === 0 which is finite.
   * If duration is positive, the function computes 0 / duration = "0.00 tok/s".
   * This tests that null tokens with valid duration produces a zero-rate result.
   */
  it('returns "0.00 tok/s" when tokens is null but duration is positive (null coerces to 0)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000_000 }),
        (durationNs) => {
          expect(computeTokensPerSecond(null, durationNs)).toBe('0.00 tok/s');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * For zero duration, should return "n/a" (division by zero guard).
   */
  it('returns "n/a" when duration is zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        (tokens) => {
          expect(computeTokensPerSecond(tokens, 0)).toBe('n/a');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * For negative duration, should return "n/a".
   */
  it('returns "n/a" when duration is negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: -100_000_000_000, max: -1 }),
        (tokens, negativeDuration) => {
          expect(computeTokensPerSecond(tokens, negativeDuration)).toBe('n/a');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * Result always ends with " tok/s" for valid inputs.
   */
  it('result always ends with " tok/s" for valid positive inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000_000_000 }),
        (tokens, durationNs) => {
          const result = computeTokensPerSecond(tokens, durationNs);
          expect(result).toMatch(/ tok\/s$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.6**
   *
   * The numeric portion before " tok/s" is always formatted to exactly 2 decimal places.
   */
  it('numeric portion has exactly 2 decimal places for valid inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000_000_000 }),
        (tokens, durationNs) => {
          const result = computeTokensPerSecond(tokens, durationNs);
          const numericPart = result.replace(' tok/s', '');
          // Must match a number with exactly 2 decimal places
          expect(numericPart).toMatch(/^\d+\.\d{2}$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});
