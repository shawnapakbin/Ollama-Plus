/**
 * Property-Based Tests: CPU-only inference options derivation (Property 11)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 11: CPU-only derives num_gpu 0 and omits main_gpu
 *
 * Validates: Requirements 4.2
 *
 * For any effective selection with `mode = 'cpu-only'`, `deriveInferenceOptions`
 * returns `options.num_gpu === 0` and no `main_gpu` key so that no GPU layers
 * are offloaded, regardless of the accompanying available/unavailable index
 * data or the detected device count.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveInferenceOptions } from '../../../electron/runtime/ollamaClient.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Property 11 concerns an EffectiveSelection whose `mode` is `'cpu-only'`. The
// derivation must ignore any incidental index data carried alongside the mode,
// so the generators deliberately attach arbitrary (even out-of-range or
// otherwise "GPU-looking") index arrays and an arbitrary detected count to
// prove the cpu-only outcome is unconditional.

const INDEX_MAX = 40;

/** A non-negative integer device index within a bounded range. */
const indexArb = fc.integer({ min: 0, max: INDEX_MAX });

/** Arbitrary index arrays (possibly empty) that ride along with the selection. */
const indexArrayArb = fc.array(indexArb, { maxLength: 8 });

/**
 * A CPU-only EffectiveSelection with arbitrary, irrelevant index payloads. The
 * available/unavailable arrays must not change the derived options.
 */
const cpuOnlySelectionArb = fc.record({
  mode: fc.constant('cpu-only' as const),
  availableIndices: indexArrayArb,
  unavailableIndices: indexArrayArb,
});

/** Arbitrary detected count, including edge values that should be irrelevant. */
const detectedCountArb = fc.integer({ min: 0, max: INDEX_MAX + 1 });

// ─── Property 11: CPU-only derives num_gpu 0 and omits main_gpu ───────────────

describe('Feature: gpu-selection, Property 11: CPU-only derives num_gpu 0 and omits main_gpu', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any cpu-only effective selection and any detected count, the derived
   * options set `num_gpu` to 0 and carry no `main_gpu` key, and the result is
   * flagged applied.
   */
  it('cpu-only mode yields num_gpu === 0 and no main_gpu key', () => {
    fc.assert(
      fc.property(cpuOnlySelectionArb, detectedCountArb, (selection, detectedCount) => {
        const result = deriveInferenceOptions(selection, detectedCount);

        // num_gpu is forced to 0 so no GPU layers are offloaded.
        expect(result.options.num_gpu).toBe(0);

        // main_gpu is omitted entirely — not present as a key at all.
        expect(Object.prototype.hasOwnProperty.call(result.options, 'main_gpu')).toBe(false);
        expect(result.options.main_gpu).toBeUndefined();

        // A CPU-only selection is an intentional, applied outcome.
        expect(result.applied).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
