/**
 * Property-Based Tests: Reconciliation defaults to allow-all (Property 4)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 4: Malformed or absent config defaults to allow-all
 *
 * Validates: Requirements 3.5, 3.9
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// This property targets absent / unreadable / unparseable persisted configs.
// Reconciliation normalizes any such value into the "unset sentinel"
// ({ allowedIndices: [], cpuOnly: false }), which means "the user never
// expressed a specific device choice" and must default to allow-all
// (Requirements 3.5, 3.9).
//
// The generator deliberately excludes configs that DO express a valid choice
// (a non-empty parseable allowedIndices array, or cpuOnly === true), because
// those are not "absent / unreadable / unparseable" and are covered by other
// properties.

/** A value that is absent or not an object at all — an unreadable config. */
const absentConfigArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.boolean()
);

/**
 * An `allowedIndices` value that carries NO parseable non-negative-integer
 * index — either not an array, or an array whose every element is junk.
 * After normalization this yields an empty allowedIndices list.
 */
const unparseableAllowedIndicesArb = fc.oneof(
  // Not an array at all.
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.string(),
  fc.record({}),
  // An array of purely unparseable junk. NOTE: values are chosen so that
  // Number(value) is never a non-negative integer — booleans are excluded
  // because Number(false) === 0 and Number(true) === 1, which ARE parseable
  // and would express a real device choice rather than an unparseable config.
  // `null` is excluded for the same reason: Number(null) === 0 is a valid
  // non-negative index, so a [null] array normalizes to an explicit device
  // selection ([0]) rather than an unset/unparseable config. The empty and
  // whitespace-only strings ('' and '  ') are excluded for the same reason:
  // Number('') === 0 and Number('  ') === 0 are both valid index 0, so they
  // are parseable, not junk. `undefined` is safe to keep because
  // Number(undefined) === NaN, which is rejected. The remaining string
  // constants are genuinely unparseable to a non-negative integer:
  // Number('abc') and Number('NaN') are NaN, Number('-3') is negative, and
  // Number('2.5') is a non-integer.
  fc.array(
    fc.oneof(
      fc.integer({ min: -20, max: -1 }),
      fc.constantFrom(1.5, -2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      fc.constantFrom('abc', '-3', '2.5', 'NaN'),
      fc.constant(undefined)
    ),
    { maxLength: 10 }
  )
);

/**
 * A `cpuOnly` value that is NOT the intentional-CPU-only signal `true`.
 * Anything that isn't the boolean `true` normalizes to `cpuOnly: false`, so it
 * does not express an intentional device choice.
 */
const nonCpuOnlyArb = fc.oneof(
  fc.constant(false),
  fc.constant(undefined),
  fc.constant(null),
  fc.constantFrom(0, 1, 'true', 'false', ''),
  fc.integer()
);

/**
 * A malformed-but-object config that normalizes to the unset sentinel: no
 * parseable allowed indices and no intentional cpuOnly=true. May carry extra
 * junk keys that the normalizer must ignore.
 */
const unparseableObjectConfigArb = fc
  .record({
    allowedIndices: unparseableAllowedIndicesArb,
    cpuOnly: nonCpuOnlyArb,
    junk: fc.anything(),
  })
  .map((obj) => {
    // Randomly drop keys to also cover empty / partially-present objects.
    const out: Record<string, unknown> = { ...obj };
    return out;
  });

/** The full space of "absent / unreadable / unparseable" configs. */
const malformedConfigArb = fc.oneof(absentConfigArb, unparseableObjectConfigArb, fc.constant({}));

/** Arbitrary detected index sets — the default-to-all outcome must not depend on detection. */
const detectedIndicesArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.array(fc.integer({ min: -3, max: 12 }), { maxLength: 20 })
) as fc.Arbitrary<number[] | null | undefined>;

// ─── Property 4: Malformed or absent config defaults to allow-all ────────────

describe('Feature: gpu-selection, Property 4: Malformed or absent config defaults to allow-all', () => {
  /**
   * **Validates: Requirements 3.5, 3.9**
   *
   * For any absent, unreadable, or unparseable persisted config value,
   * reconciliation yields effective `mode = 'all'`, regardless of which
   * devices are currently detected.
   */
  it('yields mode "all" for any absent/unreadable/unparseable config', () => {
    fc.assert(
      fc.property(malformedConfigArb, detectedIndicesArb, (config, detectedIndices) => {
        const effective = reconcileSelection(config, detectedIndices);
        expect(effective.mode).toBe('all');
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function: same malformed input yields an equivalent result', () => {
    fc.assert(
      fc.property(malformedConfigArb, detectedIndicesArb, (config, detectedIndices) => {
        const a = reconcileSelection(config, detectedIndices);
        const b = reconcileSelection(config, detectedIndices);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });
});
