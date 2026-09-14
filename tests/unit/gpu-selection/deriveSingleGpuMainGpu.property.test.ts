/**
 * Property-Based Tests: Single-GPU main_gpu derivation (Property 12)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 12: Single allowed GPU derives main_gpu to that index
 *
 * Validates: Requirements 4.3
 *
 * For any effective selection with `mode = 'subset'` and exactly one available
 * index within `0..detectedCount-1`, `deriveInferenceOptions` returns
 * `options.main_gpu` equal to that index and within range.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveInferenceOptions } from '../../../electron/runtime/ollamaClient.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// The input space is a `subset` effective selection carrying exactly one
// available index, paired with a detected count that keeps that index in range.
// We generate the pair together so `index ∈ 0..detectedCount-1` always holds:
//   - draw `detectedCount` from 1..64 (there must be at least one device)
//   - draw `index` from 0..detectedCount-1 (in-range by construction)

const singleSubsetArb = fc
  .integer({ min: 1, max: 64 })
  .chain((detectedCount) =>
    fc.record({
      detectedCount: fc.constant(detectedCount),
      index: fc.integer({ min: 0, max: detectedCount - 1 }),
    })
  );

// ─── Property 12: Single allowed GPU derives main_gpu to that index ──────────

describe('Feature: gpu-selection, Property 12: Single allowed GPU derives main_gpu to that index', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * A subset selection with exactly one in-range available index yields
   * `options.main_gpu` equal to that index, the derivation is marked applied,
   * and `num_gpu` is not emitted (only the primary device is selected).
   */
  it('derives options.main_gpu to the single in-range available index', () => {
    fc.assert(
      fc.property(singleSubsetArb, ({ detectedCount, index }) => {
        const effectiveSelection = {
          mode: 'subset',
          availableIndices: [index],
          unavailableIndices: [],
        };

        const result = deriveInferenceOptions(effectiveSelection, detectedCount);

        // main_gpu equals the single allowed index...
        expect(result.options.main_gpu).toBe(index);
        // ...and that index is within 0..detectedCount-1.
        expect(result.options.main_gpu).toBeGreaterThanOrEqual(0);
        expect(result.options.main_gpu).toBeLessThan(detectedCount);

        // The derivation succeeded.
        expect(result.applied).toBe(true);

        // A single primary-device selection does not force num_gpu.
        expect(result.options).not.toHaveProperty('num_gpu');
      }),
      { numRuns: 100 }
    );
  });
});
