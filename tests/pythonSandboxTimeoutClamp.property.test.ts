import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clampTimeoutSec,
  DEFAULT_TIMEOUT_SEC,
  MIN_TIMEOUT_SEC,
  MAX_TIMEOUT_SEC
} from '../mcp/lib/pythonSandbox.mjs';

/**
 * Property-based test — MCP Tools Wiring
 *
 * Feature: mcp-tools-wiring, Property 20: Timeout clamp to 1–120 seconds
 *
 * For any supplied timeout value, the sandbox applies an integer timeout in the
 * inclusive range 1..120: a value within range is preserved, a value outside
 * the range is clamped to the nearest bound, and an absent value yields the
 * documented default (DEFAULT_TIMEOUT_SEC).
 *
 * The clamping contract is exercised through the pure, exported
 * `clampTimeoutSec` helper that `runSandboxedPython` uses to compute the
 * effective timeout, so the behavior is verifiable without a Docker layer.
 *
 * Validates: Requirements 3.4, 3.5
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** In-range values: integers already inside [MIN, MAX]. */
const inRangeArb = fc.integer({ min: MIN_TIMEOUT_SEC, max: MAX_TIMEOUT_SEC });

/** Below-range values: finite numbers strictly less than MIN. */
const belowRangeArb = fc.double({
  min: -1_000_000,
  max: MIN_TIMEOUT_SEC - 1,
  noNaN: true,
  noDefaultInfinity: true
});

/** Above-range values: finite numbers strictly greater than MAX. */
const aboveRangeArb = fc.double({
  min: MAX_TIMEOUT_SEC + 1,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true
});

/** Any finite number across the whole real line (in, below, or above range). */
const anyFiniteArb = fc.double({
  min: -1_000_000,
  max: 1_000_000,
  noNaN: true,
  noDefaultInfinity: true
});

// ─── Feature: mcp-tools-wiring, Property 20 ──────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 20: Timeout clamp to 1–120 seconds', () => {
  /**
   * Validates: Requirements 3.4, 3.5
   *
   * Any finite supplied value yields an integer inside the inclusive
   * [MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC] range.
   */
  it('always yields an integer within the inclusive 1..120 range (PBT)', () => {
    fc.assert(
      fc.property(anyFiniteArb, (value) => {
        const result = clampTimeoutSec(value);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(MIN_TIMEOUT_SEC);
        expect(result).toBeLessThanOrEqual(MAX_TIMEOUT_SEC);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 3.5
   *
   * A value already within range is preserved (as its integer truncation, since
   * the sandbox applies an integer timeout). For integer inputs it is returned
   * unchanged.
   */
  it('preserves in-range values (PBT)', () => {
    fc.assert(
      fc.property(inRangeArb, (value) => {
        expect(clampTimeoutSec(value)).toBe(value);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 3.4
   *
   * A value below the range is clamped up to the nearest bound MIN_TIMEOUT_SEC.
   */
  it('clamps below-range values up to MIN_TIMEOUT_SEC (PBT)', () => {
    fc.assert(
      fc.property(belowRangeArb, (value) => {
        expect(clampTimeoutSec(value)).toBe(MIN_TIMEOUT_SEC);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 3.4
   *
   * A value above the range is clamped down to the nearest bound MAX_TIMEOUT_SEC.
   */
  it('clamps above-range values down to MAX_TIMEOUT_SEC (PBT)', () => {
    fc.assert(
      fc.property(aboveRangeArb, (value) => {
        expect(clampTimeoutSec(value)).toBe(MAX_TIMEOUT_SEC);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 3.4, 3.5
   *
   * An absent timeout (null or undefined) yields the documented default.
   */
  it('yields the documented default when the timeout is absent (PBT)', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (absent) => {
        expect(clampTimeoutSec(absent as null | undefined)).toBe(DEFAULT_TIMEOUT_SEC);
      }),
      { numRuns: 100 }
    );
  });
});
