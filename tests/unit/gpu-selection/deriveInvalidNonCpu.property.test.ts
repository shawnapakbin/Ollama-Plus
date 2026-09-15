/**
 * Property-Based Tests: Invalid non-CPU selection derivation (Property 14)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 14: Invalid non-CPU selection omits options and flags unapplied
 *
 * Validates: Requirements 4.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveInferenceOptions } from '../../../electron/runtime/ollamaClient.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Property 14 concerns a non-CPU-only EffectiveSelection that references a
// device index OUTSIDE the valid range `0..detectedCount-1`. Per Requirement
// 4.5, deriveInferenceOptions must omit both `num_gpu` and `main_gpu` and
// return `applied === false`. The generators below constrain to `subset`
// selections (the only non-CPU mode that names specific indices) whose single
// available index is guaranteed to be out of range for the paired
// detectedCount, so every generated case is genuinely invalid.

const COUNT_MAX = 32;

/** A detected GPU count in `0..COUNT_MAX` (0 means no valid index exists). */
const detectedCountArb = fc.integer({ min: 0, max: COUNT_MAX });

/**
 * A `subset` EffectiveSelection paired with a detectedCount such that the
 * single available index is out of range (either negative or >= detectedCount).
 */
const invalidSubsetArb = detectedCountArb.chain((detectedCount) => {
  // An out-of-range index is one that is < 0 or >= detectedCount.
  const outOfRangeIndexArb = fc.oneof(
    fc.integer({ min: -COUNT_MAX - 1, max: -1 }), // negative
    fc.integer({ min: detectedCount, max: detectedCount + COUNT_MAX + 1 }) // at or above the count
  );
  return outOfRangeIndexArb.map((index) => ({
    detectedCount,
    selection: {
      mode: 'subset' as const,
      availableIndices: [index],
      unavailableIndices: [] as number[],
    },
  }));
});

/**
 * A `subset` EffectiveSelection with MULTIPLE available indices, which is also
 * an invalid non-CPU selection for derivation purposes (only a single in-range
 * index yields a valid `main_gpu`).
 */
const multiSubsetArb = detectedCountArb.chain((detectedCount) =>
  fc
    .uniqueArray(fc.integer({ min: -COUNT_MAX, max: COUNT_MAX * 2 }), {
      minLength: 2,
      maxLength: 6,
    })
    .map((availableIndices) => ({
      detectedCount,
      selection: {
        mode: 'subset' as const,
        availableIndices,
        unavailableIndices: [] as number[],
      },
    }))
);

// ─── Property 14: Invalid non-CPU selection omits options and flags unapplied ─

describe('Feature: gpu-selection, Property 14: Invalid non-CPU selection omits options and flags unapplied', () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * A `subset` selection whose single index is outside `0..detectedCount-1`
   * (and is not an intentional CPU-only selection) yields empty options and
   * `applied === false`.
   */
  it('single out-of-range subset index omits num_gpu and main_gpu and flags applied === false', () => {
    fc.assert(
      fc.property(invalidSubsetArb, ({ selection, detectedCount }) => {
        const result = deriveInferenceOptions(selection, detectedCount);

        expect(result.applied).toBe(false);
        expect(result.options).not.toHaveProperty('num_gpu');
        expect(result.options).not.toHaveProperty('main_gpu');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * A `subset` selection naming multiple indices cannot be applied as a single
   * `main_gpu`, so it likewise omits both fields and flags `applied === false`.
   */
  it('multi-index subset selection omits num_gpu and main_gpu and flags applied === false', () => {
    fc.assert(
      fc.property(multiSubsetArb, ({ selection, detectedCount }) => {
        const result = deriveInferenceOptions(selection, detectedCount);

        expect(result.applied).toBe(false);
        expect(result.options).not.toHaveProperty('num_gpu');
        expect(result.options).not.toHaveProperty('main_gpu');
      }),
      { numRuns: 100 }
    );
  });
});
