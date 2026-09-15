/**
 * Property-Based Tests: All-allowed derivation (Property 13)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 13: All-allowed derives no GPU options
 *
 * Validates: Requirements 4.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveInferenceOptions } from '../../../electron/runtime/ollamaClient.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Property 13 concerns an effective selection whose mode is 'all'. In that
// mode the reconciled available/unavailable index lists are irrelevant to the
// derivation outcome, so the generators produce arbitrary (but well-shaped)
// index lists and an arbitrary detectedCount to prove the outcome does not
// depend on them: the derivation must omit BOTH `num_gpu` and `main_gpu`.

const INDEX_MAX = 40;

/** A non-negative integer device index within a bounded range. */
const indexArb = fc.integer({ min: 0, max: INDEX_MAX });

/** An arbitrary (possibly empty) list of device indices. */
const indexListArb = fc.array(indexArb, { minLength: 0, maxLength: INDEX_MAX + 1 });

/** An arbitrary detected device count, including zero and non-integer noise. */
const detectedCountArb = fc.oneof(
  fc.integer({ min: 0, max: INDEX_MAX + 1 }),
  fc.constant(0),
  fc.constant(undefined),
  fc.double({ min: 0, max: 10, noNaN: true })
);

/** An effective selection in allow-all mode with arbitrary accompanying data. */
const allSelectionArb = fc.record({
  mode: fc.constant('all' as const),
  availableIndices: indexListArb,
  unavailableIndices: indexListArb,
});

// ─── Property 13: All-allowed derives no GPU options ─────────────────────────

describe('Feature: gpu-selection, Property 13: All-allowed derives no GPU options', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any effective selection with `mode = 'all'`, `deriveInferenceOptions`
   * omits both `num_gpu` and `main_gpu` so Ollama applies its default device
   * behavior.
   */
  it('omits both num_gpu and main_gpu when mode is all', () => {
    fc.assert(
      fc.property(allSelectionArb, detectedCountArb, (selection, detectedCount) => {
        const { options, applied } = deriveInferenceOptions(selection, detectedCount);

        expect(options).not.toHaveProperty('num_gpu');
        expect(options).not.toHaveProperty('main_gpu');
        // Allow-all is a valid, applicable outcome (server defaults apply).
        expect(applied).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});
