/**
 * Property-Based Tests: Enumeration result discrimination (Property 2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Feature: gpu-selection, Property 2: Enumeration result is success-xor-error
 *
 * Validates: Requirements 1.3, 1.4
 *
 * For any enumeration outcome — completion with devices, completion with zero
 * devices, probe failure, or timeout — `enumerateGpus` returns exactly one of
 * `{ ok: true, gpus }` or `{ ok: false, error }`, never both, and an
 * `ok: false` result never carries a `gpus` field.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { enumerateGpus } from '../../../electron/runtime/gpuService.js';

// ─── Outcome model ───────────────────────────────────────────────────────────
//
// Each generated scenario forces `enumerateGpus` down one of the four
// enumeration outcomes by controlling the injected `spawnImpl` (and, for the
// timeout case, fake timers). Every probe strategy sees the same behavior so
// the scenario is deterministic regardless of which platform fallback runs.

type Outcome = 'devices' | 'zero' | 'failure' | 'timeout';

/** A valid nvidia-smi CSV row so a "devices" scenario normalizes to >= 1 GPU. */
const deviceRowsArb = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 20 }), fc.string({ minLength: 1, maxLength: 30 })), {
    minLength: 1,
    maxLength: 6,
  })
  // Ensure at least one row has a non-empty (post-trim) name so normalization
  // keeps it; otherwise fall back to a guaranteed-valid row.
  .map((pairs) => {
    const lines = pairs
      .map(([idx, name]) => `${idx}, ${name.replace(/[\r\n,]/g, ' ').trim()}`)
      .filter((line) => line.split(',')[1]?.trim().length);
    return lines.length > 0 ? lines.join('\n') : '0, Test GPU';
  });

const platformArb = fc.constantFrom('win32', 'darwin', 'linux', 'freebsd');

const scenarioArb = fc.oneof(
  fc.record({ outcome: fc.constant<Outcome>('devices'), platform: platformArb, stdout: deviceRowsArb }),
  fc.record({ outcome: fc.constant<Outcome>('zero'), platform: platformArb }),
  fc.record({ outcome: fc.constant<Outcome>('failure'), platform: platformArb }),
  fc.record({ outcome: fc.constant<Outcome>('timeout'), platform: platformArb })
);

/**
 * Builds an injected `spawnImpl` for a scenario:
 *  - devices: resolve with clean exit + parseable stdout (>= 1 device)
 *  - zero:    resolve with clean exit + empty stdout (completed, no devices)
 *  - failure: every probe fails to run (rejects) so enumeration cannot complete
 *  - timeout: probe never resolves; the timer must win the race
 */
function makeSpawnImpl(scenario: { outcome: Outcome; stdout?: string }) {
  switch (scenario.outcome) {
    case 'devices':
      return () => Promise.resolve({ status: 0, stdout: scenario.stdout ?? '0, Test GPU' });
    case 'zero':
      return () => Promise.resolve({ status: 0, stdout: '' });
    case 'failure':
      return () => Promise.reject(new Error('probe unavailable'));
    case 'timeout':
      return () => new Promise<never>(() => {}); // never settles
    default:
      return () => Promise.resolve({ status: 0, stdout: '' });
  }
}

/**
 * Asserts the discriminated-union contract on any enumeration result:
 * exactly one of the two shapes, never both, and `ok: false` carries no `gpus`.
 */
function assertSuccessXorError(result: unknown, expectSuccess: boolean) {
  expect(result).toBeTypeOf('object');
  expect(result).not.toBeNull();
  const r = result as Record<string, unknown>;

  // `ok` is a boolean discriminant.
  expect(typeof r.ok).toBe('boolean');

  const hasGpus = Object.prototype.hasOwnProperty.call(r, 'gpus');
  const hasError = Object.prototype.hasOwnProperty.call(r, 'error');

  // XOR: never both a `gpus` list and an `error`.
  expect(hasGpus && hasError).toBe(false);

  if (r.ok === true) {
    // Success: carries a gpus array, no error field.
    expect(hasGpus).toBe(true);
    expect(hasError).toBe(false);
    expect(Array.isArray(r.gpus)).toBe(true);
  } else {
    // Error: carries an error string, NEVER a gpus field (Req 1.4).
    expect(hasError).toBe(true);
    expect(hasGpus).toBe(false);
    expect(typeof r.error).toBe('string');
    expect((r.error as string).length).toBeGreaterThan(0);
    expect(r.kind === 'timeout' || r.kind === 'unavailable').toBe(true);
  }

  expect(r.ok).toBe(expectSuccess);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Feature: gpu-selection, Property 2: Enumeration result is success-xor-error', () => {
  /**
   * **Validates: Requirements 1.3, 1.4**
   *
   * Completion-with-devices and completion-with-zero yield an `ok: true`
   * result with a `gpus` array; failure yields an `ok: false` error with no
   * `gpus` field. (Timeout is covered separately under fake timers.)
   */
  it('resolved outcomes are exactly one of success or error, never both', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb.filter((s) => s.outcome !== 'timeout'),
        async (scenario) => {
          const result = await enumerateGpus({
            spawnImpl: makeSpawnImpl(scenario),
            platform: scenario.platform,
            timeoutMs: 5000,
            now: () => 1_000,
          });

          const expectSuccess = scenario.outcome === 'devices' || scenario.outcome === 'zero';
          assertSuccessXorError(result, expectSuccess);

          if (scenario.outcome === 'zero') {
            // Empty success: completed with no devices (Req 1.3).
            expect((result as { ok: true; gpus: unknown[] }).gpus).toEqual([]);
          }
          if (scenario.outcome === 'devices') {
            expect((result as { ok: true; gpus: unknown[] }).gpus.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * A probe that never settles must be abandoned at the timeout bound, yielding
   * `{ ok: false, kind: 'timeout' }` with no `gpus` field. Fake timers drive the
   * injected clock deterministically so the timer wins the race every run.
   */
  it('timeout outcome yields an error result with no gpus field', async () => {
    await fc.assert(
      fc.asyncProperty(platformArb, fc.integer({ min: 1, max: 5000 }), async (platform, timeoutMs) => {
        vi.useFakeTimers();
        try {
          const pending = enumerateGpus({
            spawnImpl: makeSpawnImpl({ outcome: 'timeout' }),
            platform,
            timeoutMs,
            now: () => 2_000,
          });

          // Advance past the hard bound so the timeout branch resolves the race.
          await vi.advanceTimersByTimeAsync(timeoutMs + 1);

          const result = await pending;
          assertSuccessXorError(result, false);
          expect((result as { kind: string }).kind).toBe('timeout');
          expect(Object.prototype.hasOwnProperty.call(result, 'gpus')).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      }),
      { numRuns: 100 }
    );
  });
});
