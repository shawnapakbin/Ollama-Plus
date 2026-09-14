/**
 * Property-Based Tests: Reconciliation purity (Property 8)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 8: Reconciliation never mutates the persisted config
 *
 * Validates: Requirements 5.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// `reconcileSelection` is a pure function taking a persisted GpuConfig object
// (not a store path). Property 8 requires that running reconciliation leaves the
// persisted config byte-for-byte unchanged. Since the function receives the
// config by reference, "the persisted store is unchanged" is verified by
// asserting the input argument is not mutated: deep-clone the input, run
// reconcile, then compare the input against the clone via JSON serialization.
//
// The generators cover the full reconciliation input space: the unset sentinel,
// intentional CPU-only, explicit subsets (available / stale / mixed), plus
// malformed and hostile config shapes that must not be mutated either.

/** A single index value spanning valid, negative, non-integer, and junk cases. */
const indexArb = fc.oneof(
  fc.integer({ min: -3, max: 12 }),
  fc.integer({ min: 0, max: 6 }).map((n) => String(n)),
  fc.constantFrom(-1, 2.5, Number.NaN),
  fc.constantFrom('', 'abc', '3')
);

/** A well-formed-ish config with an explicit allowed-index list and cpuOnly flag. */
const structuredConfigArb = fc.record({
  allowedIndices: fc.array(indexArb, { maxLength: 20 }),
  cpuOnly: fc.boolean(),
});

/** Hostile / malformed configs that reconcileSelection must tolerate without mutating. */
const malformedConfigArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant({}),
  fc.record({ allowedIndices: fc.constant('not-an-array'), cpuOnly: fc.constant('yes') }),
  fc.record({ allowedIndices: fc.array(fc.integer(), { maxLength: 5 }) }),
  fc.record({ extra: fc.string(), cpuOnly: fc.boolean() })
);

/** The full config input space. */
const configArb = fc.oneof(
  { weight: 4, arbitrary: structuredConfigArb },
  { weight: 1, arbitrary: malformedConfigArb }
);

/** Arbitrary detected-index set (may include duplicates / values outside the config). */
const detectedIndicesArb = fc.array(fc.integer({ min: -2, max: 12 }), { maxLength: 15 });

// ─── Property 8: Reconciliation never mutates the persisted config ───────────

describe('Feature: gpu-selection, Property 8: Reconciliation never mutates the persisted config', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any persisted GpuConfig and any detected set, running reconciliation
   * leaves the persisted config byte-for-byte unchanged. Verified by comparing
   * the input argument against a deep clone taken before the call, using JSON
   * serialization for a byte-for-byte equality check.
   */
  it('leaves the input config byte-for-byte unchanged after reconciliation', () => {
    fc.assert(
      fc.property(configArb, detectedIndicesArb, (config, detectedIndices) => {
        // Byte-for-byte snapshot of the config before reconciliation.
        const before = JSON.stringify(config);
        // Independent deep clone so the reference held by the test cannot alias
        // anything reconcileSelection might touch.
        const clone = config === undefined ? undefined : JSON.parse(before);

        reconcileSelection(config, detectedIndices);

        // The config the caller passed in must be byte-for-byte identical.
        expect(JSON.stringify(config)).toBe(before);
        // ...and equal to the pre-call deep clone.
        expect(JSON.parse(JSON.stringify(config ?? null))).toEqual(clone ?? null);
      }),
      { numRuns: 100 }
    );
  });

  it('does not mutate the detectedIndices argument either', () => {
    fc.assert(
      fc.property(configArb, detectedIndicesArb, (config, detectedIndices) => {
        const before = JSON.stringify(detectedIndices);
        reconcileSelection(config, detectedIndices);
        expect(JSON.stringify(detectedIndices)).toBe(before);
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function: same input yields an equivalent effective selection', () => {
    fc.assert(
      fc.property(configArb, detectedIndicesArb, (config, detectedIndices) => {
        const a = reconcileSelection(config, detectedIndices);
        const b = reconcileSelection(config, detectedIndices);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });
});
