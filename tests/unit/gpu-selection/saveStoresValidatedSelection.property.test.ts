/**
 * Property-Based Tests: Save stores exactly the validated selection (Property 9)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 9: Save stores exactly the validated selection
 *
 * Validates: Requirements 2.6
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gpu-save-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/**
 * Build a runtimeService backed by a real on-disk store (a temp `statePath`)
 * and an injected GPU enumeration impl so the detected device set is fully
 * controlled. `enumerateGpusImpl` returns the success shape the service expects
 * (`{ ok: true, gpus: [...] }`).
 */
function createServiceWithDetectedGpus(detectedIndices: number[]): {
  saveGpuSelection: (input: { allowedIndices?: number[]; cpuOnly?: boolean }) => Promise<
    | { ok: true; config: { allowedIndices: number[]; cpuOnly: boolean }; cpuOnly: boolean }
    | { ok: false; reason: string; unavailableIndices?: number[] }
  >;
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
// proposal draws its indices exclusively from that detected set (so every
// proposed index is currently detected, satisfying the validation) and may
// repeat entries to exercise deduplication on persist.

const detectedAndProposalArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 63 }), { minLength: 1, maxLength: 20 })
  .chain((detected) =>
    fc.record({
      detected: fc.constant(detected),
      // A non-empty proposal drawn from the detected set, allowing duplicates.
      proposal: fc.array(fc.constantFrom(...detected), { minLength: 1, maxLength: 30 })
    })
  );

// ─── Property 9: Save stores exactly the validated selection ─────────────────

describe('Feature: gpu-selection, Property 9: Save stores exactly the validated selection', () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any proposed selection all of whose indices are currently detected,
   * `saveGpuSelection` succeeds and the persisted `allowedIndices` equal the
   * deduplicated proposed indices.
   */
  it('persists the deduplicated proposed indices when every index is detected', async () => {
    await fc.assert(
      fc.asyncProperty(detectedAndProposalArb, async ({ detected, proposal }) => {
        const { saveGpuSelection, statePath } = createServiceWithDetectedGpus(detected);

        const result = await saveGpuSelection({ allowedIndices: proposal });

        // A fully-detected, non-empty proposal is a successful GPU selection.
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const expected = dedupe(proposal);
        // The save result reports the persisted config...
        expect(result.config.allowedIndices).toEqual(expected);
        expect(result.config.cpuOnly).toBe(false);
        expect(result.cpuOnly).toBe(false);

        // ...and reading back from the real store yields the same deduplicated
        // set (Requirement 2.6: store the validated device indices).
        const persisted = getGpuConfig(statePath);
        expect(persisted.allowedIndices).toEqual(expected);
        expect(persisted.cpuOnly).toBe(false);

        // No duplicates survived persistence.
        expect(persisted.allowedIndices.length).toBe(new Set(persisted.allowedIndices).size);
      }),
      { numRuns: 100 }
    );
  });
});
