import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getGpuConfig, updateGpuConfig } from '../electron/runtime/runtimeStore.js';

/**
 * gpu-selection — Task 2.4: Unit tests for GPU_Config store round-trip and defaults.
 *
 * Validates: Requirements 3.4, 3.5
 *
 * - R3.4: When Ollama_Plus starts, it loads the persisted GPU_Config from the
 *   runtime state store (round-trip: persist via updateGpuConfig, read back via
 *   getGpuConfig).
 * - R3.5: If no GPU_Config has been persisted, OR the persisted GPU_Config
 *   cannot be read or parsed, the store yields the unset-sentinel default
 *   ({ allowedIndices: [], cpuOnly: false }).
 */

const UNSET_SENTINEL = { allowedIndices: [], cpuOnly: false };

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gpu-config-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

describe('gpu-selection — GPU_Config store round-trip (R3.4)', () => {
  it('persists then reads back a configuration with allowed indices', () => {
    const statePath = createTempStatePath();

    const saved = updateGpuConfig(statePath, { allowedIndices: [0, 2, 5], cpuOnly: false });

    expect(saved).toEqual({ allowedIndices: [0, 2, 5], cpuOnly: false });
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [0, 2, 5], cpuOnly: false });
  });

  it('persists then reads back a CPU-only configuration', () => {
    const statePath = createTempStatePath();

    updateGpuConfig(statePath, { allowedIndices: [], cpuOnly: true });

    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [], cpuOnly: true });
  });

  it('round-trips through the updater-function form', () => {
    const statePath = createTempStatePath();

    updateGpuConfig(statePath, { allowedIndices: [1], cpuOnly: false });
    const updated = updateGpuConfig(statePath, (current) => ({
      ...current,
      allowedIndices: [...current.allowedIndices, 3]
    }));

    expect(updated).toEqual({ allowedIndices: [1, 3], cpuOnly: false });
    expect(getGpuConfig(statePath)).toEqual({ allowedIndices: [1, 3], cpuOnly: false });
  });

  it('survives a full read-write-read cycle across a fresh store handle', () => {
    const statePath = createTempStatePath();

    updateGpuConfig(statePath, { allowedIndices: [4, 7], cpuOnly: false });

    // Simulate "app restart": read again from the same on-disk state file.
    const reloaded = getGpuConfig(statePath);
    expect(reloaded).toEqual({ allowedIndices: [4, 7], cpuOnly: false });
  });
});

describe('gpu-selection — GPU_Config unset-sentinel default (R3.5)', () => {
  it('yields the unset sentinel when no state file exists (emptyState)', () => {
    const statePath = createTempStatePath();

    // No file has been written; the store is in its empty state.
    expect(fs.existsSync(statePath)).toBe(false);
    expect(getGpuConfig(statePath)).toEqual(UNSET_SENTINEL);
  });

  it('yields the unset sentinel when the state file exists but omits gpuConfig', () => {
    const statePath = createTempStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ sessions: [], runs: [] }), 'utf8');

    expect(getGpuConfig(statePath)).toEqual(UNSET_SENTINEL);
  });

  it('yields the unset sentinel when the state file is unreadable/unparseable', () => {
    const statePath = createTempStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    // Corrupt (non-JSON) content: readRuntimeState catches the parse error and
    // falls back to emptyState().
    fs.writeFileSync(statePath, '{ this is not valid json', 'utf8');

    expect(getGpuConfig(statePath)).toEqual(UNSET_SENTINEL);
  });
});
