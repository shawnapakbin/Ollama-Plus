/**
 * Unit Tests: enumerateGpus timeout wrapper and success classification
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Covers Task 1.5: the timeout race and empty-success classification of the
 * `enumerateGpus` wrapper, exercised with a fake clock and controllable
 * `spawnImpl` promises so no real hardware or wall-clock time is needed.
 *
 * Validates: Requirements 1.1, 1.3, 1.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enumerateGpus } from '../../../electron/runtime/gpuService.js';

/**
 * A controllable spawn result: resolves with the given probe result only when
 * `resolve()` is invoked. Lets a test decide whether a probe finishes before or
 * after the timeout fires.
 */
function deferredSpawn(result: unknown) {
  let resolveFn: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((resolve) => {
    resolveFn = resolve;
  });
  const spawnImpl = vi.fn(() => promise);
  return { spawnImpl, resolve: () => resolveFn(result) };
}

describe('enumerateGpus timeout wrapper (Task 1.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── Probe resolving before 5s → success (Req 1.1) ─────────────────────────

  it('returns a success result when the probe resolves before the 5s timeout', async () => {
    // NVIDIA CSV output: two well-formed `index, name` rows.
    const spawnImpl = vi.fn(async () => ({
      status: 0,
      stdout: '0, NVIDIA GeForce RTX 3080\n1, NVIDIA GeForce RTX 3090\n',
      stderr: '',
    }));

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'win32', timeoutMs: 5000 });

    // Let the microtask queue drain so the probe resolves well before 5s.
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result).toEqual({
      ok: true,
      gpus: [
        { index: 0, name: 'NVIDIA GeForce RTX 3080' },
        { index: 1, name: 'NVIDIA GeForce RTX 3090' },
      ],
    });
  });

  it('resolves with success even when the probe finishes just before the deadline', async () => {
    const { spawnImpl, resolve } = deferredSpawn({
      status: 0,
      stdout: '0, Test GPU\n',
      stderr: '',
    });

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'win32', timeoutMs: 5000 });

    // Advance to just before the deadline, then let the probe complete.
    await vi.advanceTimersByTimeAsync(4999);
    resolve();
    await vi.advanceTimersByTimeAsync(0);

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, gpus: [{ index: 0, name: 'Test GPU' }] });
  });

  // ─── Probe that never resolves → timeout (Req 1.1, 1.4) ────────────────────

  it('returns { ok: false, kind: "timeout" } when the probe never resolves', async () => {
    // A probe whose promise never settles: the timeout must win the race.
    const spawnImpl = vi.fn(() => new Promise<never>(() => {}));

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'win32', timeoutMs: 5000, now: () => 1000 });

    // Fire the 5s timer.
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.kind).toBe('timeout');
      expect(typeof result.error).toBe('string');
      // A timeout error result never carries a device list (Req 1.4).
      expect('gpus' in result).toBe(false);
    }
  });

  it('honors a custom timeoutMs bound for the timeout classification', async () => {
    const spawnImpl = vi.fn(() => new Promise<never>(() => {}));

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'linux', timeoutMs: 1000 });

    // Not yet expired at 999ms; expired at 1000ms.
    await vi.advanceTimersByTimeAsync(999);
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.kind).toBe('timeout');
    }
  });

  // ─── Empty-success classification (Req 1.3) ────────────────────────────────

  it('classifies a clean probe that finds zero devices as an empty success', async () => {
    // Every strategy exits cleanly (status 0) but produces no parseable device.
    const spawnImpl = vi.fn(async () => ({ status: 0, stdout: '', stderr: '' }));

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'win32', timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result).toEqual({ ok: true, gpus: [] });
  });

  it('does not treat an empty success as a timeout even when devices are absent', async () => {
    const spawnImpl = vi.fn(async () => ({ status: 0, stdout: 'Name\n', stderr: '' }));

    const resultPromise = enumerateGpus({ spawnImpl, platform: 'win32', timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.gpus).toEqual([]);
    }
  });
});
