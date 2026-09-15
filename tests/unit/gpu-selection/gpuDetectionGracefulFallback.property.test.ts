/**
 * Bug Condition Exploration Test (Property 1): Multi-vendor and generic
 * OS-level GPU detection with graceful fallback.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: gpu-detection-graceful-fallback
 * Property 1: Bug Condition — Multi-vendor and generic OS-level detection
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A BUGFIX-WORKFLOW EXPLORATION TEST. It is EXPECTED TO FAIL on the
 * current (unfixed) code — its failure is what confirms the bug exists. It
 * encodes the *desired* behavior (the fix target), so once the fix lands it
 * will validate the fix.
 *
 * The bug: `enumerateGpus`/`runProbes` only meaningfully attempt an NVIDIA
 * probe (`nvidia-smi`) plus a single weak OS-native fallback per platform (a
 * limited `wmic ... get Name` on Windows). There is no AMD (`rocm-smi`), Intel,
 * or Apple vendor probe, and no robust generic OS-level query (Windows WMI/CIM
 * `Win32_VideoController` via PowerShell). So real, OS-nameable GPUs from other
 * vendors go unlisted, and the terminal outcome collapses a malfunctioning tool
 * (`failed`) into the graceful no-strategy outcome (`unavailable`).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { enumerateGpus } from '../../../electron/runtime/gpuService.js';

// ─── Scenario / outcome model ────────────────────────────────────────────────
//
// An `EnumerationScenario` models one enumeration attempt as a platform plus a
// per-strategy outcome map keyed by probe *command*. `enumerateGpus` invokes
// the injected `spawnImpl(command, args)` once per strategy in the pipeline; we
// map each command to either 'throws' (the tool is absent / cannot be spawned)
// or a spawn-like result `{ status, stdout }`.

type SpawnOutcome = 'throws' | { status: number; stdout: string };

type EnumerationScenario = {
  platform: string;
  /** Outcome keyed by the command the strategy would spawn. */
  outcomes: Record<string, SpawnOutcome>;
  /** Default outcome for any command not present in `outcomes`. */
  fallback: SpawnOutcome;
};

/** The command names the fixed pipeline is expected to try, by role. */
const CMD = {
  nvidia: 'nvidia-smi',
  amd: 'rocm-smi',
  // Windows generic OS-level fallback: WMI/CIM Win32_VideoController via PowerShell.
  powershell: 'powershell',
  // macOS vendor + generic fallback.
  systemProfiler: 'system_profiler',
  // Linux generic OS-level fallback.
  lspci: 'lspci',
} as const;

/**
 * Builds an injected `spawnImpl` from a scenario. A 'throws' outcome rejects
 * (simulating an absent tool that cannot be spawned); a result outcome resolves
 * with `{ status, stdout }`. Matching is by whether the command *contains* a
 * known key so that e.g. a full path to `nvidia-smi` still matches.
 */
function makeSpawnImpl(scenario: EnumerationScenario) {
  return (command: string) => {
    const key = Object.keys(scenario.outcomes).find((k) => command.includes(k));
    const outcome = key ? scenario.outcomes[key] : scenario.fallback;
    if (outcome === 'throws') {
      return Promise.reject(new Error(`${command}: command not found`));
    }
    return Promise.resolve({ status: outcome.status, stdout: outcome.stdout });
  };
}

/** Extracts the `name` list from a successful result (or [] otherwise). */
function gpuNames(result: unknown): string[] {
  const r = result as { ok?: boolean; gpus?: Array<{ name: string }> };
  if (r && r.ok === true && Array.isArray(r.gpus)) {
    return r.gpus.map((g) => g.name);
  }
  return [];
}

const FAST_TIMEOUT = 1000;

// Ensure no fake-timer state from the preservation timeout property leaks into
// the exploration tests (or vice versa).
afterEach(() => {
  vi.useRealTimers();
});

// ─── Concrete-repro test cases (deterministic primary repro) ─────────────────

describe('Feature: gpu-detection-graceful-fallback, Property 1: Bug Condition — multi-vendor + generic OS-level detection', () => {
  /**
   * **Validates: Requirements 1.2, 2.2, 2.3, 2.4**
   *
   * HEADLINE REPRO — Windows 11, all-AMD, no vendor CLI. `nvidia-smi` and
   * `rocm-smi` are absent (throw), while the generic WMI/CIM
   * `Win32_VideoController` query (run via PowerShell) names all five adapters:
   * 4x "AMD Radeon VII" + 1x "AMD Radeon Pro W7600".
   *
   * DESIRED: `{ ok: true, gpus }` of length 5 listing every card by name with a
   * positional index.
   *
   * FAILS ON UNFIXED CODE: Windows only runs the limited `wmic ... get Name`
   * fallback (not the PowerShell WMI/CIM query), and there is no AMD probe, so
   * no strategy produces a device list and enumeration returns `unavailable`.
   */
  it('lists all five AMD cards on Windows via the generic WMI/CIM Win32_VideoController fallback', async () => {
    const wmiOutput = [
      'AMD Radeon VII',
      'AMD Radeon VII',
      'AMD Radeon VII',
      'AMD Radeon VII',
      'AMD Radeon Pro W7600',
    ].join('\n');

    const result = await enumerateGpus({
      spawnImpl: makeSpawnImpl({
        platform: 'win32',
        outcomes: {
          [CMD.nvidia]: 'throws',
          [CMD.amd]: 'throws',
          // Generic OS-level fallback (PowerShell WMI/CIM) names all five cards.
          [CMD.powershell]: { status: 0, stdout: wmiOutput },
        },
        // Any other command (e.g. the legacy `wmic`) is absent.
        fallback: 'throws',
      }),
      platform: 'win32',
      timeoutMs: FAST_TIMEOUT,
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    const names = gpuNames(result);
    expect(names).toHaveLength(5);
    // Every card is listed by name (4x Radeon VII + 1x Radeon Pro W7600).
    expect(names.filter((n) => n === 'AMD Radeon VII')).toHaveLength(4);
    expect(names.filter((n) => n === 'AMD Radeon Pro W7600')).toHaveLength(1);

    // Each device is listed with a positional (non-negative integer) index.
    const gpus = (result as { ok: true; gpus: Array<{ index: number; name: string }> }).gpus;
    gpus.forEach((g, i) => {
      expect(Number.isInteger(g.index)).toBe(true);
      expect(g.index).toBe(i);
    });
  });

  /**
   * **Validates: Requirements 2.1, 2.4**
   *
   * VENDOR COVERAGE — an AMD box with `rocm-smi` present (no `nvidia-smi`). The
   * AMD probe should run and its GPUs should be aggregated into the list.
   *
   * FAILS ON UNFIXED CODE: there is no AMD (`rocm-smi`) probe at all, so the
   * pipeline never sees these devices.
   */
  it('runs the AMD (rocm-smi) probe and aggregates its GPUs when present', async () => {
    // A minimal rocm-smi-style listing naming two AMD devices. The fixed AMD
    // parser must extract these names.
    const rocmOutput = [
      'GPU[0]\t\t: Card series: AMD Instinct MI210',
      'GPU[1]\t\t: Card series: AMD Radeon RX 7900 XTX',
    ].join('\n');

    const result = await enumerateGpus({
      spawnImpl: makeSpawnImpl({
        platform: 'linux',
        outcomes: {
          [CMD.nvidia]: 'throws',
          [CMD.amd]: { status: 0, stdout: rocmOutput },
        },
        fallback: 'throws',
      }),
      platform: 'linux',
      timeoutMs: FAST_TIMEOUT,
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    const names = gpuNames(result);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names.some((n) => /MI210/i.test(n))).toBe(true);
    expect(names.some((n) => /7900 XTX/i.test(n))).toBe(true);
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.4**
   *
   * INTEL / APPLE COVERAGE — an Apple Silicon Mac. `system_profiler
   * SPDisplaysDataType` names the integrated GPU. On macOS the applicable
   * strategy should name the device.
   *
   * FAILS ON UNFIXED CODE only if the single fallback does not run; this case
   * mainly asserts cross-vendor coverage — an Intel/Apple device is named even
   * when no NVIDIA/AMD CLI exists.
   */
  it('names an Apple Silicon GPU via system_profiler when no vendor CLI is present', async () => {
    const spOutput = [
      'Graphics/Displays:',
      '',
      '    Apple M2 Max:',
      '',
      '      Chipset Model: Apple M2 Max',
      '      Type: GPU',
      '      Bus: Built-In',
    ].join('\n');

    const result = await enumerateGpus({
      spawnImpl: makeSpawnImpl({
        platform: 'darwin',
        outcomes: {
          [CMD.nvidia]: 'throws',
          [CMD.amd]: 'throws',
          [CMD.systemProfiler]: { status: 0, stdout: spOutput },
        },
        fallback: 'throws',
      }),
      platform: 'darwin',
      timeoutMs: FAST_TIMEOUT,
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    const names = gpuNames(result);
    expect(names).toContain('Apple M2 Max');
  });

  /**
   * **Validates: Requirements 2.5, 3.4**
   *
   * MALFUNCTIONING TOOL vs. NO STRATEGY — a strategy that *spawns* but exits
   * non-zero with garbage stdout must be classified as a hard failure
   * (`{ ok: false, kind: 'failed' }`), distinct from the all-unrunnable case
   * (`{ ok: false, kind: 'unavailable' }`).
   *
   * FAILS ON UNFIXED CODE: there is no `failed` kind; a non-zero exit that
   * produces no parseable device currently collapses into `unavailable` (or
   * empty success), so the two cases are indistinguishable.
   */
  it('classifies a malfunctioning tool as kind "failed", distinct from "unavailable"', async () => {
    // Malfunctioning: the generic query spawns but exits non-zero with garbage.
    const malfunctioning = await enumerateGpus({
      spawnImpl: makeSpawnImpl({
        platform: 'win32',
        outcomes: {
          [CMD.nvidia]: 'throws',
          [CMD.amd]: 'throws',
          [CMD.powershell]: { status: 1, stdout: '???\u0000garbage\u0007not-a-device-list' },
        },
        fallback: 'throws',
      }),
      platform: 'win32',
      timeoutMs: FAST_TIMEOUT,
      now: () => 1_000,
    });

    expect(malfunctioning.ok).toBe(false);
    expect((malfunctioning as { kind: string }).kind).toBe('failed');

    // No strategy at all can be spawned → graceful, non-failure `unavailable`.
    const allUnrunnable = await enumerateGpus({
      spawnImpl: makeSpawnImpl({
        platform: 'win32',
        outcomes: {},
        fallback: 'throws',
      }),
      platform: 'win32',
      timeoutMs: FAST_TIMEOUT,
      now: () => 1_000,
    });

    expect(allUnrunnable.ok).toBe(false);
    expect((allUnrunnable as { kind: string }).kind).toBe('unavailable');
  });

  // ─── Generalized property over bug-condition scenarios ─────────────────────
  //
  // Bug condition (from design): thereIsAtLeastOneStrategy(platform)
  //   AND detectableGpusExist(platform)
  //   AND noStrategyProducedDevices  AND noStrategyCompletedCleanly.
  //
  // We model the "detectable GPUs exist" part by having the platform's generic
  // OS-level fallback able to name devices, while every vendor CLI throws. The
  // fixed code must surface those devices via the generic fallback; the unfixed
  // code cannot, so this property fails on unfixed code.

  const genericFallbackNamesArb = fc.uniqueArray(
    fc.string({ minLength: 1, maxLength: 24 }).map((s) => `Vendor GPU ${s.replace(/[\r\n]/g, ' ').trim() || 'X'}`),
    { minLength: 1, maxLength: 5 }
  );

  it('surfaces OS-nameable GPUs via the generic fallback whenever a vendor CLI is absent (bug condition)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('win32', 'linux', 'darwin'),
        genericFallbackNamesArb,
        async (platform, names) => {
          // Build the generic OS-level fallback stdout in the shape each
          // platform's generic query emits.
          let genericCmd: string;
          let stdout: string;
          if (platform === 'win32') {
            genericCmd = CMD.powershell;
            stdout = names.join('\n'); // Win32_VideoController name list
          } else if (platform === 'darwin') {
            genericCmd = CMD.systemProfiler;
            stdout = names.map((n) => `      Chipset Model: ${n}`).join('\n');
          } else {
            genericCmd = CMD.lspci;
            stdout = names
              .map((n, i) => `0${i}:00.0 VGA compatible controller: ${n}`)
              .join('\n');
          }

          const result = await enumerateGpus({
            spawnImpl: makeSpawnImpl({
              platform,
              outcomes: {
                [CMD.nvidia]: 'throws', // no NVIDIA CLI
                [CMD.amd]: 'throws', // no AMD CLI
                [genericCmd]: { status: 0, stdout },
              },
              fallback: 'throws',
            }),
            platform,
            timeoutMs: FAST_TIMEOUT,
            now: () => 1_000,
          });

          // DESIRED (fix target): a successful result listing every OS-named
          // device. FAILS on unfixed code, which cannot run a robust generic
          // fallback for these vendors/platforms.
          expect(result.ok).toBe(true);
          const detected = gpuNames(result);
          for (const n of names) {
            expect(detected).toContain(n);
          }
        }
      ),
      { numRuns: 60 }
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Property 2: Preservation — Non-strategy-selection outcomes unchanged (Task 2)
// (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4
//
// ─────────────────────────────────────────────────────────────────────────────
// OBSERVATION-FIRST PRESERVATION TESTS. These are written against the UNFIXED
// code's observed baseline behavior and are EXPECTED TO PASS on it — they
// capture the outcomes that must NOT change when the fix broadens the strategy
// set. They are stable across the fix by construction: each scenario forces the
// SAME outcome for EVERY command the pipeline might spawn (via the per-command
// `outcomes` map plus a matching `fallback`), so it classifies identically
// whether the pipeline is the narrow NVIDIA-plus-one-fallback set (today) or the
// broadened multi-vendor + generic set (after the fix). The number of strategies
// changes; the terminal classification does not.
//
// BASELINE RECORDED ON UNFIXED CODE (observed via direct enumerateGpus runs):
//   • Devices from any productive strategy → { ok: true, gpus } (3.1)
//   • Every attempted strategy clean-exits with zero devices → { ok: true, gpus: [] } (3.2)
//   • Pipeline never settles → { ok: false, kind: 'timeout' } under the 5s bound (3.3)
//   • Malfunctioning tool (spawns, non-zero exit, no parseable device) → the
//     UNFIXED code returns { ok: false, kind: 'unavailable' } (there is NO
//     'failed' kind yet). The desired post-fix classification is 'failed'.
//     Per the Task 2 instructions, the strict `kind: 'failed'` assertion CANNOT
//     pass on unfixed code, so it is DEFERRED to task 3.1. Here we preserve the
//     observable baseline that this case is a HARD FAILURE result (`ok: false`
//     with no `gpus` field), which the renderer surfaces as the hard
//     "GPU detection failed" alert — see the renderer preservation test.
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts a `{ ok, kind }` view from any enumeration result. */
function okKind(result: unknown): { ok: boolean; kind?: string } {
  const r = result as { ok?: boolean; kind?: string };
  return { ok: r.ok === true, kind: r.kind };
}

/** A well-formed NVIDIA CSV row list that normalizes to >= 1 device. */
const deviceStdoutArb = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.string({ minLength: 1, maxLength: 24 })), {
    minLength: 1,
    maxLength: 5,
  })
  .map((pairs) => {
    const lines = pairs
      .map(([idx, name]) => `${idx}, ${name.replace(/[\r\n,]/g, ' ').trim()}`)
      .filter((line) => line.split(',')[1]?.trim().length);
    return lines.length > 0 ? lines.join('\n') : '0, Preserved GPU';
  });

const preservationPlatformArb = fc.constantFrom('win32', 'darwin', 'linux', 'freebsd');

describe('Feature: gpu-detection-graceful-fallback, Property 2: Preservation — non-bug-condition outcomes unchanged', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * Successful detection preserved: when the FIRST strategy the pipeline runs
   * (NVIDIA `nvidia-smi`, always first) reports one or more devices, enumeration
   * short-circuits to `{ ok: true, gpus }` with that device list — identical on
   * unfixed and fixed code (the first productive strategy wins in both).
   */
  it('preserves successful detection: a productive first strategy yields { ok: true, gpus }', async () => {
    await fc.assert(
      fc.asyncProperty(preservationPlatformArb, deviceStdoutArb, async (platform, stdout) => {
        const result = await enumerateGpus({
          // Every command resolves cleanly with the same device listing, so the
          // first strategy (nvidia-smi) is productive on any pipeline shape.
          spawnImpl: () => Promise.resolve({ status: 0, stdout }),
          platform,
          timeoutMs: FAST_TIMEOUT,
          now: () => 1_000,
        });

        const { ok } = okKind(result);
        expect(ok).toBe(true);
        const gpus = (result as { ok: true; gpus: Array<{ index: number; name: string }> }).gpus;
        expect(gpus.length).toBeGreaterThan(0);
        // Each device carries a non-negative integer index and a non-empty name
        // (index + name preserved, Requirement 3.1).
        for (const g of gpus) {
          expect(Number.isInteger(g.index)).toBe(true);
          expect(g.index).toBeGreaterThanOrEqual(0);
          expect(typeof g.name).toBe('string');
          expect(g.name.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 80 }
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Empty success preserved: when EVERY attempted strategy clean-exits
   * (`status === 0`) reporting zero parseable devices, enumeration is the empty
   * success `{ ok: true, gpus: [] }` (the CPU-note case), never a degraded/error
   * state. Uniform clean-zero for every command keeps this stable across the
   * broadened pipeline.
   */
  it('preserves empty success: all strategies clean-exit with zero devices → { ok: true, gpus: [] }', async () => {
    await fc.assert(
      fc.asyncProperty(
        preservationPlatformArb,
        // stdout that parses to zero devices under every parser: blank / header-only.
        fc.constantFrom('', '\n', 'Name\n', '   \n  '),
        async (platform, stdout) => {
          const result = await enumerateGpus({
            spawnImpl: () => Promise.resolve({ status: 0, stdout }),
            platform,
            timeoutMs: FAST_TIMEOUT,
            now: () => 1_000,
          });

          expect(okKind(result).ok).toBe(true);
          expect((result as { ok: true; gpus: unknown[] }).gpus).toEqual([]);
        }
      ),
      { numRuns: 60 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Timeout preserved: a pipeline whose probes never settle is abandoned at the
   * 5-second bound with `{ ok: false, kind: 'timeout' }` and NO `gpus` field.
   * The single race now bounds the whole multi-strategy pipeline; the terminal
   * classification is unchanged. Fake timers drive the clock deterministically.
   */
  it('preserves timeout: a never-settling pipeline yields { ok: false, kind: "timeout" }', async () => {
    await fc.assert(
      fc.asyncProperty(preservationPlatformArb, fc.integer({ min: 1, max: 5000 }), async (platform, timeoutMs) => {
        vi.useFakeTimers();
        try {
          const pending = enumerateGpus({
            spawnImpl: () => new Promise<never>(() => {}), // never settles
            platform,
            timeoutMs,
            now: () => 2_000,
          });

          await vi.advanceTimersByTimeAsync(timeoutMs + 1);

          const result = await pending;
          expect(okKind(result).ok).toBe(false);
          expect((result as { kind: string }).kind).toBe('timeout');
          expect(Object.prototype.hasOwnProperty.call(result, 'gpus')).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      }),
      { numRuns: 60 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Malfunctioning tool preserved (baseline captured, strict `kind` deferred):
   * a strategy that SPAWNS but exits non-zero and produces no parseable device
   * must remain a HARD FAILURE result — `{ ok: false }` with no `gpus` list —
   * NOT the graceful degraded state at the renderer.
   *
   * OBSERVED BASELINE ON UNFIXED CODE: this returns `{ ok: false, kind:
   * 'unavailable' }` because there is no `failed` kind yet. The DESIRED post-fix
   * classification is `kind: 'failed'`; per the Task 2 instructions that strict
   * assertion is DEFERRED to task 3.1. Here we assert only the observable
   * baseline that survives the fix: it is an `ok: false` hard-failure result
   * with no device list. (The renderer preservation test confirms both `timeout`
   * and this hard-failure case surface the `role="alert"` block today.)
   */
  it('preserves the malfunctioning-tool HARD FAILURE (ok:false, no gpus) — strict kind:"failed" deferred to 3.1', async () => {
    await fc.assert(
      fc.asyncProperty(
        preservationPlatformArb,
        // Non-zero exit with stdout that yields NO parseable device under any
        // parser (blank / header-only). A garbage NAME line would be parsed as a
        // device by the positional parsers, so we restrict to non-device stdout.
        fc.constantFrom('', 'Name\n', '\n\n'),
        async (platform, stdout) => {
          const result = await enumerateGpus({
            // Every command spawns but malfunctions (non-zero, no device).
            spawnImpl: () => Promise.resolve({ status: 1, stdout }),
            platform,
            timeoutMs: FAST_TIMEOUT,
            now: () => 1_000,
          });

          // Baseline preserved across the fix: a hard-failure result, never a
          // success and never a device list.
          expect(okKind(result).ok).toBe(false);
          expect(Object.prototype.hasOwnProperty.call(result, 'gpus')).toBe(false);
          // NOTE: strict `kind === 'failed'` is intentionally NOT asserted here.
          // On unfixed code this is `kind: 'unavailable'`; task 3.1 introduces
          // and asserts the `failed` classification.
        }
      ),
      { numRuns: 60 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * Mixed strategy orderings: across scenarios where the bug condition does NOT
   * hold, the terminal outcome matches the classification rule regardless of
   * ordering. We drive EVERY command to the same outcome so the classification
   * is deterministic and identical on the narrow (today) and broadened (fixed)
   * pipelines:
   *   • any productive strategy present  → { ok: true, gpus.length > 0 }  (aggregate/first-wins)
   *   • all clean-zero                    → { ok: true, gpus: [] }         (empty success)
   *   • all malfunctioning (spawn+fail)   → ok: false hard failure         (kind deferred)
   * The "throw-then-*" and "fail-then-clean" mixed orderings are covered by the
   * uniform outcomes: a throwing command is skipped, so a scenario with a mix of
   * throws and one productive/clean/failed command reduces to that command's
   * classification.
   */
  it('preserves the classification rule across mixed non-bug-condition orderings', async () => {
    type Kind = 'devices' | 'zero' | 'failed';
    const scenarioArb = fc.record({
      platform: preservationPlatformArb,
      kind: fc.constantFrom<Kind>('devices', 'zero', 'failed'),
      deviceStdout: deviceStdoutArb,
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ platform, kind, deviceStdout }) => {
        const spawnImpl = () => {
          if (kind === 'devices') return Promise.resolve({ status: 0, stdout: deviceStdout });
          if (kind === 'zero') return Promise.resolve({ status: 0, stdout: '' });
          // 'failed' — spawns but exits non-zero with no parseable device.
          return Promise.resolve({ status: 2, stdout: 'Name\n' });
        };

        const result = await enumerateGpus({
          spawnImpl,
          platform,
          timeoutMs: FAST_TIMEOUT,
          now: () => 1_000,
        });

        if (kind === 'devices') {
          expect(okKind(result).ok).toBe(true);
          expect((result as { ok: true; gpus: unknown[] }).gpus.length).toBeGreaterThan(0);
        } else if (kind === 'zero') {
          expect(okKind(result).ok).toBe(true);
          expect((result as { ok: true; gpus: unknown[] }).gpus).toEqual([]);
        } else {
          // Malfunctioning tool → hard failure (baseline; strict kind deferred).
          expect(okKind(result).ok).toBe(false);
          expect(Object.prototype.hasOwnProperty.call(result, 'gpus')).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
