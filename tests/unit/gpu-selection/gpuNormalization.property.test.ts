/**
 * Property-Based Tests: Detected GPU list normalization (Property 1)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 1: Detected GPU list is well-formed
 *
 * Validates: Requirements 1.2, 3.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  normalizeDetectedGpus,
  MAX_GPU_INDICES,
  MAX_GPU_NAME_LENGTH,
} from '../../../electron/runtime/gpuService.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// The generators deliberately produce hostile / malformed raw rows so the
// property exercises the full normalization contract: empty and overlong
// names, negative and non-integer indices, duplicates, and non-string /
// non-object junk. `normalizeDetectedGpus` must coerce or drop these and
// always yield a well-formed device list.

/**
 * An index value spanning the interesting cases:
 *  - valid non-negative integers (numbers and numeric strings)
 *  - negatives, non-integers, NaN/Infinity, empty/garbage strings
 *  - duplicates arise naturally from the constrained numeric range
 */
const indexArb = fc.oneof(
  fc.integer({ min: -5, max: 10 }), // includes negatives and dupes
  fc.integer({ min: 0, max: 5 }).map((n) => String(n)), // numeric strings, dupes
  fc.constantFrom(-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY),
  fc.constantFrom('', '  ', '-3', '2.0', 'abc', '0x1', '1e2'),
  fc.oneof(fc.boolean(), fc.constant(null), fc.constant(undefined))
);

/**
 * A name value spanning empty, whitespace-only, overlong (> 128 chars),
 * normal, and non-string junk.
 */
const nameArb = fc.oneof(
  fc.string({ maxLength: 40 }), // ordinary names (some empty)
  fc.constantFrom('', '   ', '\t\n'), // empty / whitespace-only
  fc.string({ minLength: 129, maxLength: 400 }), // overlong
  fc.string({ minLength: 129, maxLength: 400 }).map((s) => `  ${s}  `), // overlong + padding
  fc.oneof(fc.integer(), fc.constant(null), fc.constant(undefined), fc.boolean())
);

/** A single raw row (loosely typed, untrusted). */
const rawRowArb = fc.record({ index: indexArb, name: nameArb });

/**
 * A raw-rows input. Sometimes injects non-object junk entries to confirm they
 * are dropped without throwing. Allowed length exceeds MAX_GPU_INDICES so the
 * list-cap invariant is exercised.
 */
const rawRowsArb = fc.array(
  fc.oneof(
    { weight: 5, arbitrary: rawRowArb },
    { weight: 1, arbitrary: fc.oneof(fc.constant(null), fc.constant('junk'), fc.integer()) }
  ),
  { maxLength: 80 }
) as fc.Arbitrary<Array<{ index: unknown; name: unknown }>>;

// ─── Property 1: Detected GPU list is well-formed ────────────────────────────

describe('Feature: gpu-selection, Property 1: Detected GPU list is well-formed', () => {
  /**
   * **Validates: Requirements 1.2, 3.1**
   *
   * For any raw enumeration output, the normalized DetectedGpu list has every
   * `index` a non-negative integer, all indices unique within the list, and
   * every `name` non-empty and at most 128 characters.
   */
  it('normalized list has non-negative integer indices, unique indices, and non-empty names <= 128 chars', () => {
    fc.assert(
      fc.property(rawRowsArb, (rawRows) => {
        const detected = normalizeDetectedGpus(rawRows);

        // Result is always an array within the hard list cap (Req 3.1).
        expect(Array.isArray(detected)).toBe(true);
        expect(detected.length).toBeLessThanOrEqual(MAX_GPU_INDICES);

        const seen = new Set<number>();
        for (const gpu of detected) {
          // index: non-negative integer
          expect(typeof gpu.index).toBe('number');
          expect(Number.isInteger(gpu.index)).toBe(true);
          expect(gpu.index).toBeGreaterThanOrEqual(0);

          // index: unique within the list
          expect(seen.has(gpu.index)).toBe(false);
          seen.add(gpu.index);

          // name: non-empty string, <= 128 chars
          expect(typeof gpu.name).toBe('string');
          expect(gpu.name.length).toBeGreaterThan(0);
          expect(gpu.name.length).toBeLessThanOrEqual(MAX_GPU_NAME_LENGTH);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function: same input yields an equivalent well-formed list', () => {
    fc.assert(
      fc.property(rawRowsArb, (rawRows) => {
        const a = normalizeDetectedGpus(rawRows);
        const b = normalizeDetectedGpus(rawRows);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });

  it('never throws on non-array or junk input and returns an empty list', () => {
    for (const junk of [null, undefined, 42, 'nope', { index: 0, name: 'x' }, true]) {
      // @ts-expect-error intentionally passing malformed input
      expect(normalizeDetectedGpus(junk)).toEqual([]);
    }
  });
});
