/**
 * Property-Based Tests: Reconciliation intersection rule (Property 5)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 5: Effective available set equals stored-detected intersection
 *
 * Validates: Requirements 3.6, 3.7, 5.1, 5.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';
import { MAX_GPU_INDICES } from '../../../electron/runtime/stateSchema.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Property 5 concerns a persisted GpuConfig that NAMES SPECIFIC DEVICES: a
// non-sentinel selection (non-empty allowedIndices) that is NOT intentional
// CPU-only (cpuOnly === false). The generators constrain to that input space so
// every case reconciles to a genuine intersection (rule 4 / rule 5), never the
// unset-allow-all branch (rule 2) or the sticky cpu-only branch (rule 3).

const INDEX_MAX = 40;

/** A non-negative integer device index within a bounded range. */
const indexArb = fc.integer({ min: 0, max: INDEX_MAX });

/**
 * A persisted GpuConfig that names at least one specific device and is not
 * intentional CPU-only. Indices are constrained to non-negative integers and
 * the list is capped at MAX_GPU_INDICES so it survives normalization unchanged.
 */
const namedConfigArb = fc
  .uniqueArray(indexArb, { minLength: 1, maxLength: MAX_GPU_INDICES })
  .map((allowedIndices) => ({ allowedIndices, cpuOnly: false as const }));

/** An arbitrary set of currently-detected device indices (possibly empty). */
const detectedArb = fc.uniqueArray(indexArb, { minLength: 0, maxLength: INDEX_MAX + 1 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sortedUnique = (values: number[]): number[] => Array.from(new Set(values)).sort((a, b) => a - b);

// ─── Property 5: Effective available set equals stored-detected intersection ──

describe('Feature: gpu-selection, Property 5: Effective available set equals stored-detected intersection', () => {
  /**
   * **Validates: Requirements 3.6, 3.7, 5.1, 5.3**
   *
   * For any persisted GpuConfig naming specific devices and any set of detected
   * indices, the reconciled `availableIndices` equals stored ∩ detected and
   * `unavailableIndices` equals stored \ detected.
   */
  it('availableIndices == stored ∩ detected and unavailableIndices == stored \\ detected', () => {
    fc.assert(
      fc.property(namedConfigArb, detectedArb, (config, detectedIndices) => {
        const detectedSet = new Set(detectedIndices);
        const stored = config.allowedIndices;

        const expectedAvailable = sortedUnique(stored.filter((i) => detectedSet.has(i)));
        const expectedUnavailable = sortedUnique(stored.filter((i) => !detectedSet.has(i)));

        const result = reconcileSelection(config, detectedIndices);

        expect(sortedUnique(result.availableIndices)).toEqual(expectedAvailable);
        expect(sortedUnique(result.unavailableIndices)).toEqual(expectedUnavailable);

        // The two sets partition the stored selection with no overlap or loss.
        expect(sortedUnique([...result.availableIndices, ...result.unavailableIndices])).toEqual(
          sortedUnique(stored)
        );
        for (const i of result.availableIndices) {
          expect(result.unavailableIndices).not.toContain(i);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('mode reflects partial availability: subset when any stored device is detected, cpu-only when none', () => {
    fc.assert(
      fc.property(namedConfigArb, detectedArb, (config, detectedIndices) => {
        const detectedSet = new Set(detectedIndices);
        const anyAvailable = config.allowedIndices.some((i) => detectedSet.has(i));

        const result = reconcileSelection(config, detectedIndices);

        expect(result.mode).toBe(anyAvailable ? 'subset' : 'cpu-only');
      }),
      { numRuns: 100 }
    );
  });
});
