import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * gpu-selection — Task 4.5: Unit test for persist-failure fault injection.
 *
 * Validates: Requirements 2.8, 3.2, 3.3
 *
 * - R2.8: If storing the GPU_Selection to GPU_Config fails, Ollama_Plus SHALL
 *   retain the previously stored GPU_Config unchanged and surface a save error.
 * - R3.2: If persisting the GPU_Config fails, Ollama_Plus SHALL attempt to
 *   retain the previously persisted GPU_Config unchanged.
 * - R3.3: If persisting the GPU_Config fails, Ollama_Plus SHALL present an error
 *   indication that the GPU_Selection was not saved, independent of whether
 *   retaining the previously persisted GPU_Config succeeds.
 *
 * Design ("Error Handling → Persist failure"): if `updateGpuConfig` throws,
 * `saveGpuSelection` catches it, does not partially write, and returns
 * `{ ok: false, reason: 'persist-failed' }`; the prior config survives because
 * the failing write never completed.
 *
 * Fault-injection strategy: mock the `runtimeStore` module so that
 * `updateGpuConfig` is a spy which, by default, delegates to the real store
 * implementation (so a prior selection can be seeded and read back through the
 * genuine on-disk store), and is then reconfigured to throw for the single call
 * under test. Every other store export keeps its real behaviour via
 * `importActual`, so `getGpuConfig` reads the true persisted bytes.
 */

// The mock factory is hoisted above the imports by Vitest. It exposes every
// real runtimeStore export unchanged except `updateGpuConfig`, which becomes a
// spy that delegates to the real implementation until a test overrides it.
const { updateGpuConfigMock } = vi.hoisted(() => ({
  updateGpuConfigMock: vi.fn()
}));

vi.mock('../electron/runtime/runtimeStore.js', async () => {
  const actual = await vi.importActual<typeof import('../electron/runtime/runtimeStore.js')>(
    '../electron/runtime/runtimeStore.js'
  );
  // Default behaviour: real persistence, so prior config can be seeded honestly.
  updateGpuConfigMock.mockImplementation(actual.updateGpuConfig);
  return {
    ...actual,
    updateGpuConfig: updateGpuConfigMock
  };
});

// Import AFTER the mock is registered so the service binds to the mocked export.
const { createRuntimeService } = await import('../electron/runtime/runtimeService.js');
const runtimeStore = await import('../electron/runtime/runtimeStore.js');
const { getGpuConfig } = runtimeStore;

// The real (unmocked) persistence implementation, captured via importActual so
// the delegating default and per-test resets can restore honest behaviour.
const realUpdateGpuConfig = (
  await vi.importActual<typeof import('../electron/runtime/runtimeStore.js')>(
    '../electron/runtime/runtimeStore.js'
  )
).updateGpuConfig;

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

beforeEach(() => {
  // Reset to the real (delegating) implementation between tests so each test
  // starts from a clean, honestly-persisting store.
  updateGpuConfigMock.mockReset();
  updateGpuConfigMock.mockImplementation(realUpdateGpuConfig);
});

function createTempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gpu-persist-fail-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/**
 * Build a runtimeService whose GPU enumeration reports a fixed detected set, so
 * a proposal referencing those indices passes validation and reaches the
 * persist step (the point at which we inject the fault).
 */
function createServiceWithDetectedGpus(statePath: string, detectedIndices: number[]) {
  return createRuntimeService({
    statePath,
    appVersion: '0.0.1-test',
    mode: 'development',
    workspaceRoot: 'C:/workspace',
    versions: { electron: '41.0.0', chrome: '141.0.0', node: '24.0.0' },
    langsmithConfigured: false,
    enumerateGpusImpl: async () => ({
      ok: true,
      gpus: detectedIndices.map((index) => ({ index, name: `GPU ${index}` }))
    })
  });
}

describe('gpu-selection — saveGpuSelection persist-failure fault injection (R2.8, R3.2, R3.3)', () => {
  it('returns { ok: false, reason: "persist-failed" } when the store write throws', async () => {
    const statePath = createTempStatePath();
    const service = createServiceWithDetectedGpus(statePath, [0, 1]);

    // Inject the fault: the very next persist attempt throws.
    updateGpuConfigMock.mockImplementationOnce(() => {
      throw new Error('EROFS: read-only file system, open state.json');
    });

    const result = await service.saveGpuSelection({ allowedIndices: [0], cpuOnly: false });

    expect(result).toEqual({ ok: false, reason: 'persist-failed' });
  });

  it('leaves the previously persisted GPU_Config intact when the write throws', async () => {
    const statePath = createTempStatePath();
    const service = createServiceWithDetectedGpus(statePath, [0, 1, 2]);

    // Seed a prior selection through the genuine store (the spy delegates to the
    // real implementation by default), then confirm it is on disk.
    const seeded = await service.saveGpuSelection({ allowedIndices: [1], cpuOnly: false });
    expect(seeded).toEqual({ ok: true, config: { allowedIndices: [1], cpuOnly: false }, cpuOnly: false });
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [1], cpuOnly: false });

    // Now inject a persist failure for the next save attempt.
    updateGpuConfigMock.mockImplementationOnce(() => {
      throw new Error('disk write failed');
    });

    const failed = await service.saveGpuSelection({ allowedIndices: [0, 2], cpuOnly: false });

    // The save is reported as failed …
    expect(failed).toEqual({ ok: false, reason: 'persist-failed' });
    // … and the previously persisted config survives byte-for-byte.
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [1], cpuOnly: false });
  });

  it('preserves an unset (allow-all) config when the first-ever save fails to persist', async () => {
    const statePath = createTempStatePath();
    const service = createServiceWithDetectedGpus(statePath, [0]);

    // No prior save has happened, so the store is at its unset sentinel.
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [], cpuOnly: false });

    updateGpuConfigMock.mockImplementationOnce(() => {
      throw new Error('persist boom');
    });

    const failed = await service.saveGpuSelection({ allowedIndices: [0], cpuOnly: false });

    expect(failed).toEqual({ ok: false, reason: 'persist-failed' });
    // The unset sentinel is retained, so reconciliation still defaults to allow-all.
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [], cpuOnly: false });
  });
});
