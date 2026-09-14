/**
 * Property-Based Tests: Single-device retention (Property 6)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 6: Single available device is retained, not expanded
 *
 * Validates: Requirements 3.8
 *
 * When the intersection of an explicit stored selection with the currently
 * detected device indices contains exactly one index, `reconcileSelection`
 * keeps that single-device selection — `mode = 'subset'` with exactly that
 * index in `availableIndices` — and never defaults to allow-all (`mode = 'all'`).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcileSelection } from '../../../electron/runtime/runtimeService.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────
//
// Each scenario constructs a stored config whose allowed indices intersect the
// detected indices in EXACTLY ONE index. The generator picks:
//   - `retained`: the single index present in both stored and detected sets
//   - `storedExtras`: additional allowed indices that are NOT detected (so they
//     drop out on intersection, leaving `retained` as the sole survivor)
//   - `detectedExtras`: additional detected indices NOT in the stored set (so a
//     "single available" selection is not accidentally an allow-all situation)
//
// Indices are drawn from disjoint numeric bands so the three roles never
// collide, guaranteeing the intersection is precisely `{ retained }`.

const RETAINED_BAND = fc.integer({ min: 0, max: 20 }); // 0..20
const STORED_EXTRA_BAND = fc.integer({ min: 100, max: 140 }); // stored-only (undetected)
const DETECTED_EXTRA_BAND = fc.integer({ min: 200, max: 240 }); // detected-only (unselected)

/** Distinct-index arrays from a band via a Set, keeping length bounded. */
function distinctArray(band: fc.Arbitrary<number>, maxLength: number) {
  return fc
    .array(band, { maxLength })
    .map((xs) => Array.from(new Set(xs)));
}

const singleAvailableScenarioArb = fc
  .record({
    retained: RETAINED_BAND,
    storedExtras: distinctArray(STORED_EXTRA_BAND, 8),
    detectedExtras: distinctArray(DETECTED_EXTRA_BAND, 8),
    // Shuffle seeds so ordering of the built arrays is not always sorted.
    shuffleAllowed: fc.boolean(),
    shuffleDetected: fc.boolean(),
  })
  .map(({ retained, storedExtras, detectedExtras, shuffleAllowed, shuffleDetected }) => {
    // Bands are disjoint, so `retained` cannot appear in the extras.
    const allowedIndices = [retained, ...storedExtras];
    const detectedIndices = [retained, ...detectedExtras];
    if (shuffleAllowed) allowedIndices.reverse();
    if (shuffleDetected) detectedIndices.reverse();
    return { retained, allowedIndices, detectedIndices };
  });

// ─── Property 6: Single available device is retained, not expanded ───────────

describe('Feature: gpu-selection, Property 6: Single available device is retained, not expanded', () => {
  /**
   * **Validates: Requirements 3.8**
   *
   * For any explicit (non-cpuOnly, non-empty) stored selection whose
   * intersection with the detected set is exactly one index, reconciliation
   * yields `mode = 'subset'` carrying only that index — never `mode = 'all'`.
   */
  it('an exactly-one-index intersection yields subset with that single index, not allow-all', () => {
    fc.assert(
      fc.property(singleAvailableScenarioArb, ({ retained, allowedIndices, detectedIndices }) => {
        const config = { allowedIndices, cpuOnly: false };

        const effective = reconcileSelection(config, detectedIndices);

        // Retained, not expanded: subset mode with exactly the one shared index.
        expect(effective.mode).toBe('subset');
        expect(effective.mode).not.toBe('all');
        expect(effective.availableIndices).toEqual([retained]);

        // Every stored index that was not detected is reported unavailable.
        const detectedSet = new Set(detectedIndices);
        const expectedUnavailable = allowedIndices.filter((i) => !detectedSet.has(i));
        expect([...effective.unavailableIndices].sort((a, b) => a - b)).toEqual(
          [...expectedUnavailable].sort((a, b) => a - b)
        );
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.8**
   *
   * The retention holds even when the single retained device is the ONLY
   * stored index and additional GPUs exist on the system: the selection stays
   * pinned to that one device rather than expanding to all detected devices.
   */
  it('a lone stored index amid multiple detected devices stays a single-device subset', () => {
    fc.assert(
      fc.property(RETAINED_BAND, distinctArray(DETECTED_EXTRA_BAND, 8), (retained, detectedExtras) => {
        const config = { allowedIndices: [retained], cpuOnly: false };
        const detectedIndices = [retained, ...detectedExtras];

        const effective = reconcileSelection(config, detectedIndices);

        expect(effective.mode).toBe('subset');
        expect(effective.availableIndices).toEqual([retained]);
        expect(effective.unavailableIndices).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
