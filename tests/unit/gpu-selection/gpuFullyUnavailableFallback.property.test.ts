/**
 * Property-Based Tests: Fully-unavailable explicit selection falls back to CPU-only (Property 7)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 7: A fully-unavailable explicit selection falls back to CPU-only
 *
 * Validates: Requirements 5.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Property 7 concerns an *explicit* selection (not the unset sentinel, not an
// intentional CPU-only choice) whose named devices have all vanished from the
// detected set. The generator must therefore produce:
//   - cpuOnly === false             → not intentional CPU-only
//   - a non-empty allowedIndices    → not the unset sentinel
//   - a detected set that is fully DISJOINT from allowedIndices → empty
//     intersection (every selected device is unavailable)
//
// To guarantee disjointness we draw the allowed and detected indices from two
// non-overlapping numeric bands. Allowed indices come from a low band and
// detected indices from a high band, so no value can appear in both.

const LOW_MIN = 0;
const LOW_MAX = 31; // allowed indices live here
const HIGH_MIN = 100;
const HIGH_MAX = 199; // detected indices live here (disjoint from the low band)

/** A non-empty set of "allowed" indices, all drawn from the low band. */
const allowedIndicesArb = fc.uniqueArray(fc.integer({ min: LOW_MIN, max: LOW_MAX }), {
  minLength: 1,
  maxLength: 32,
});

/**
 * A "detected" set drawn from the high band (may be empty). Because it is
 * disjoint from the low band, its intersection with allowedIndices is always
 * empty — the fully-unavailable condition Property 7 requires.
 */
const detectedIndicesArb = fc.uniqueArray(fc.integer({ min: HIGH_MIN, max: HIGH_MAX }), {
  maxLength: 32,
});

/** An explicit, non-cpuOnly GpuConfig naming specific devices. */
const explicitConfigArb = allowedIndicesArb.map((allowedIndices) => ({
  allowedIndices,
  cpuOnly: false as const,
}));

// ─── Property 7: A fully-unavailable explicit selection falls back to CPU-only ─

describe('Feature: gpu-selection, Property 7: A fully-unavailable explicit selection falls back to CPU-only', () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any persisted GpuConfig that named specific devices (not the unset
   * sentinel, not intentional CPU-only) whose intersection with the detected
   * set is empty, the reconciled inference mode is `cpu-only`.
   */
  it('an explicit selection with empty intersection reconciles to mode = "cpu-only"', () => {
    fc.assert(
      fc.property(explicitConfigArb, detectedIndicesArb, (config, detectedIndices) => {
        // Precondition sanity: the config is genuinely explicit and the sets
        // are disjoint (empty intersection).
        expect(config.cpuOnly).toBe(false);
        expect(config.allowedIndices.length).toBeGreaterThan(0);
        const detectedSet = new Set(detectedIndices);
        const intersection = config.allowedIndices.filter((i) => detectedSet.has(i));
        expect(intersection).toEqual([]);

        const effective = reconcileSelection(config, detectedIndices);

        // The core property: fully-unavailable explicit selection → cpu-only.
        expect(effective.mode).toBe('cpu-only');

        // No selected device is available; all are unavailable (Req 5.2 context).
        expect(effective.availableIndices).toEqual([]);
        expect([...effective.unavailableIndices].sort((a, b) => a - b)).toEqual(
          [...config.allowedIndices].sort((a, b) => a - b)
        );
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function: same input yields an equivalent effective selection', () => {
    fc.assert(
      fc.property(explicitConfigArb, detectedIndicesArb, (config, detectedIndices) => {
        const a = reconcileSelection(config, detectedIndices);
        const b = reconcileSelection(config, detectedIndices);
        expect(a).toEqual(b);
      }),
      { numRuns: 100 }
    );
  });
});
