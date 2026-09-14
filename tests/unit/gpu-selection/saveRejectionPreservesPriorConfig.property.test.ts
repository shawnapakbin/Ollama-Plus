/**
 * Property-Based Tests: Save with any undetected index is rejected and
 * preserves prior config (Property 10)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 10: Save with any undetected index is rejected and preserves prior config
 *
 * Validates: Requirements 2.7
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRuntimeService } from '../../../electron/runtime/runtimeService.js';
import { getGpuConfig } from '../../../electron/runtime/runtimeStore.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gpu-reject-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

type SaveResult =
  | { ok: true; config: { allowedIndices: number[]; cpuOnly: boolean }; cpuOnly: boolean }
  | { ok: false; reason: string; unavailableIndices?: number[] };

/**
 * Build a runtimeService backed by a real on-disk store (a temp `statePath`)
 * and an injected GPU enumeration impl so the detected device set is fully
 * controlled. `enumerateGpusImpl` returns the success shape the service expects
 * (`{ ok: true, gpus: [...] }`).
 */
function createServiceWithDetectedGpus(detectedIndices: number[]): {
  saveGpuSelection: (input: { allowedIndices?: number[]; cpuOnly?: boolean }) => Promise<SaveResult>;
  statePath: string;
} {
  const statePath = createTempStatePath();
  const gpus = detectedIndices.map((index) => ({ index, name: `GPU ${index}` }));
  const service = createRuntimeService({
    statePath,
    appVersion: '0.0.1-test',
    mode: 'development',
    workspaceRoot: 'C:/workspace',
    versions: { electron: '41.0.0', chrome: '141.0.0', node: '24.0.0' },
    langsmithConfigured: false,
    enumerateGpusImpl: async () => ({ ok: true, gpus })
  });
  return { saveGpuSelection: service.saveGpuSelection, statePath };
}

/** Deduplicate an integer array preserving first-seen order. */
function dedupe(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// ─── Generators ──────────────────────────────────────────────────────────────
//
// The detected set is a non-empty list of unique non-negative indices. The
// prior (seeded) selection draws exclusively from the detected set, so seeding
// it via a valid save succeeds. The rejected proposal draws its base indices
// from the detected set but always includes at least one index drawn from
// OUTSIDE the detected set, guaranteeing at least one undetected index.

const scenarioArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 63 }), { minLength: 1, maxLength: 20 })
  .chain((detected) => {
    const detectedSet = new Set(detected);
    // Candidate undetected indices in a wider range, filtered to be outside the
    // detected set, so the proposal is guaranteed to reference a missing device.
    const undetectedArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 200 }), { minLength: 1, maxLength: 10 })
      .map((values) => values.filter((value) => !detectedSet.has(value)))
      .filter((values) => values.length > 0);

    return fc.record({
      detected: fc.constant(detected),
      // A prior selection drawn from the detected set (valid to seed).
      prior: fc.array(fc.constantFrom(...detected), { minLength: 1, maxLength: 20 }),
      // Some detected indices mixed into the rejected proposal (may be empty).
      detectedPortion: fc.array(fc.constantFrom(...detected), { maxLength: 20 }),
      undetectedPortion: undetectedArb
    });
  });

// ─── Property 10: Save rejection preserves prior config ──────────────────────

describe('Feature: gpu-selection, Property 10: Save with any undetected index is rejected and preserves prior config', () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * Seed a valid prior selection, then propose a selection containing at least
   * one index that is NOT currently detected. The save is rejected with
   * `reason = 'unavailable-device'`, the reported `unavailableIndices` are
   * exactly the undetected proposed indices, and the persisted `GpuConfig`
   * remains byte-for-byte the seeded prior config.
   */
  it('rejects a proposal with any undetected index and leaves the prior config unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ detected, prior, detectedPortion, undetectedPortion }) => {
        const { saveGpuSelection, statePath } = createServiceWithDetectedGpus(detected);

        // Seed a valid prior config via a successful save.
        const seed = await saveGpuSelection({ allowedIndices: prior });
        expect(seed.ok).toBe(true);

        const priorConfig = getGpuConfig(statePath);
        expect(priorConfig.allowedIndices).toEqual(dedupe(prior));
        expect(priorConfig.cpuOnly).toBe(false);

        // Build a proposal that mixes (optional) detected indices with at least
        // one undetected index, in a shuffled-but-deterministic order.
        const proposal = dedupe([...detectedPortion, ...undetectedPortion]);

        const result = await saveGpuSelection({ allowedIndices: proposal });

        // The proposal references a device that is not currently detected, so
        // it must be rejected before touching the store.
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('unavailable-device');

        // The reported unavailable indices are exactly the undetected members
        // of the (deduplicated) proposal.
        const detectedSet = new Set(detected);
        const expectedUnavailable = proposal.filter((index) => !detectedSet.has(index));
        expect(result.unavailableIndices).toEqual(expectedUnavailable);
        expect(expectedUnavailable.length).toBeGreaterThan(0);

        // The persisted GpuConfig is unchanged from the seeded prior config
        // (Requirement 2.7: retain the previously stored GPU_Config unchanged).
        const afterConfig = getGpuConfig(statePath);
        expect(afterConfig).toEqual(priorConfig);
      }),
      { numRuns: 100 }
    );
  });
});
