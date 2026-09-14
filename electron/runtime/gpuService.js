/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * GPU_Service (Main process) — enumerates system GPUs and reports them to the
 * renderer through the preload bridge. This module owns Requirement 1
 * (enumeration) only: it performs no persistence and no reconciliation.
 *
 * Enumeration returns a discriminated `EnumerationResult`. Exactly one shape is
 * ever returned; never a hybrid:
 *
 *   { ok: true,  gpus: DetectedGpu[] }                             // success (may be empty)
 *   { ok: false, error: string, kind: 'timeout' | 'unavailable' } // error, NO `gpus` field
 *
 * A completed probe that finds zero devices is an empty *success*
 * (`{ ok: true, gpus: [] }`, Requirement 1.3), never an error. Only
 * infrastructure/driver failures or a timeout produce `{ ok: false, ... }`
 * (Requirement 1.4), and such a result never carries a `gpus` list.
 *
 * A DetectedGpu is the normalized device shape (Requirement 1.2):
 *   { index: number,  // non-negative integer, unique within the list
 *     name: string }  // non-empty, <= MAX_GPU_NAME_LENGTH (128) chars
 *
 * A RawGpuRow is the loose, pre-normalization shape produced by a parser:
 *   { index: string, name: string }  // both raw, untrusted text
 *
 * SECURITY: all probe `stdout` is treated as untrusted text. Parsers never
 * `eval`, extract fields strictly, and hard-cap output size (name length 128,
 * list length 64) so malformed or hostile output cannot produce unbounded or
 * unexpected structures.
 */

/**
 * Maximum number of device indices retained in an enumerated/persisted list.
 * Mirrors the persistence bound (`MAX_GPU_INDICES` in stateSchema.js) so a
 * hostile or malformed probe cannot produce an unbounded device list.
 */
export const MAX_GPU_INDICES = 64;

/**
 * Maximum length of a normalized DetectedGpu name (Requirement 1.2).
 */
export const MAX_GPU_NAME_LENGTH = 128;

/**
 * Parses the stdout of
 *   `nvidia-smi --query-gpu=index,name --format=csv,noheader,nounits`
 * into an array of loose `RawGpuRow` objects.
 *
 * Each non-empty line is expected to be an `index, name` CSV row. All input is
 * treated as untrusted text: parsing is strict field extraction with no `eval`,
 * no dynamic execution, and no interpretation beyond splitting on the first
 * comma. Blank lines are skipped. Lines without a comma (no name field) are
 * skipped. Extra commas inside the name are preserved as part of the name.
 *
 * This is a pure function: it does not normalize, deduplicate, or validate the
 * extracted values — that is the job of `normalizeDetectedGpus`. It only turns
 * raw text into `{ index, name }` string pairs.
 *
 * @param {string} stdout Raw stdout from the nvidia-smi probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseNvidiaSmiCsv(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return [];
  }

  const rows = [];
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    // Strict extraction: split on the first comma only. The index is the text
    // before it; everything after is the name (names may legitimately contain
    // commas, e.g. "NVIDIA GeForce RTX 3080, Ti").
    const commaIndex = trimmedLine.indexOf(',');
    if (commaIndex === -1) {
      // No name field present — not a well-formed `index, name` row.
      continue;
    }

    const index = trimmedLine.slice(0, commaIndex).trim();
    const name = trimmedLine.slice(commaIndex + 1).trim();
    rows.push({ index, name });
  }

  return rows;
}

/**
 * Normalizes loose `RawGpuRow[]` output into a strict `DetectedGpu[]` list,
 * enforcing the Requirement 1.2 / Requirement 3.1 invariants:
 *
 *   - each `index` is coerced to a non-negative integer; rows whose index is
 *     not a non-negative integer are rejected (dropped)
 *   - indices are deduplicated (first occurrence wins)
 *   - each `name` must be non-empty after trimming; rows with an empty name
 *     are rejected (dropped)
 *   - each `name` is capped at MAX_GPU_NAME_LENGTH (128) characters
 *   - the resulting list is capped at MAX_GPU_INDICES (64) entries
 *
 * This is a pure function over untrusted input. It never throws on malformed
 * rows; it silently drops anything that cannot satisfy the invariants so the
 * output is always a well-formed device list.
 *
 * @param {Array<{ index: unknown, name: unknown }>} rawRows Loose parsed rows.
 * @returns {{ index: number, name: string }[]} Normalized detected GPUs.
 */
export function normalizeDetectedGpus(rawRows) {
  if (!Array.isArray(rawRows)) {
    return [];
  }

  const seenIndices = new Set();
  const detected = [];

  for (const row of rawRows) {
    if (detected.length >= MAX_GPU_INDICES) {
      break;
    }
    if (!row || typeof row !== 'object') {
      continue;
    }

    const index = coerceGpuIndex(row.index);
    if (index === null) {
      continue;
    }
    if (seenIndices.has(index)) {
      continue;
    }

    const name = coerceGpuName(row.name);
    if (name === null) {
      continue;
    }

    seenIndices.add(index);
    detected.push({ index, name });
  }

  return detected;
}

/**
 * Coerces a raw index value to a non-negative integer, or returns null when it
 * cannot be represented as one. Accepts numbers and numeric strings; rejects
 * NaN, Infinity, negatives, and non-integers (e.g. "1.5", "abc", "").
 *
 * @param {unknown} value Raw index value (untrusted).
 * @returns {number | null} A non-negative integer, or null when invalid.
 */
function coerceGpuIndex(value) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    // Only accept a plain non-negative integer literal (no signs, decimals,
    // whitespace-embedded, or exponent forms) to avoid surprising coercions.
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
  }
  return null;
}

/**
 * Coerces a raw name value to a non-empty, length-capped string, or returns
 * null when it is not a usable name (non-string or empty after trimming).
 *
 * @param {unknown} value Raw name value (untrusted).
 * @returns {string | null} A trimmed, capped name, or null when invalid.
 */
function coerceGpuName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_GPU_NAME_LENGTH);
}
/**
 * Default probe timeout for GPU enumeration (Requirement 1.1, 1.4). A probe that
 * does not complete within this bound is abandoned and reported as a timeout.
 */
export const DEFAULT_ENUMERATION_TIMEOUT_MS = 5000;

/**
 * Parses the stdout of the Windows `wmic path win32_VideoController get Name`
 * fallback into loose `RawGpuRow` objects. The tool prints a `Name` header
 * followed by one adapter name per line; there is no device index column, so
 * indices are synthesized positionally (0, 1, 2, ...) in listing order.
 *
 * All input is treated as untrusted text: strict line extraction, no `eval`.
 * The `Name` header line and blank lines are skipped. Positional indexing is
 * intentional and safe — `normalizeDetectedGpus` re-validates every row.
 *
 * @param {string} stdout Raw stdout from the wmic probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseWmicVideoControllers(stdout) {
  return parsePositionalNameList(stdout, (line) => line.toLowerCase() === 'name');
}

/**
 * Parses the stdout of the macOS `system_profiler SPDisplaysDataType` fallback
 * into loose `RawGpuRow` objects. The relevant lines are the graphics/display
 * chipset entries, printed as `Chipset Model: <name>`. Indices are synthesized
 * positionally in listing order.
 *
 * All input is treated as untrusted text: strict line extraction, no `eval`.
 *
 * @param {string} stdout Raw stdout from the system_profiler probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseSystemProfilerDisplays(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return [];
  }

  const rows = [];
  let index = 0;
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    // Only the chipset-model lines name a device. Match case-insensitively and
    // take everything after the first colon as the (untrusted) name.
    const match = /^chipset model\s*:(.*)$/i.exec(trimmedLine);
    if (!match) {
      continue;
    }
    const name = match[1].trim();
    if (name.length === 0) {
      continue;
    }
    rows.push({ index: String(index), name });
    index += 1;
  }

  return rows;
}

/**
 * Parses the stdout of the Linux `lspci` fallback into loose `RawGpuRow`
 * objects. Callers filter to VGA/3D/Display controller lines; each such line
 * looks like `01:00.0 VGA compatible controller: <name>`. The device name is
 * everything after the first colon that follows the class description, and
 * indices are synthesized positionally in listing order.
 *
 * All input is treated as untrusted text: strict line extraction, no `eval`.
 *
 * @param {string} stdout Raw stdout from the lspci probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseLspciControllers(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return [];
  }

  const rows = [];
  let index = 0;
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    // Keep only graphics controllers (VGA / 3D / Display) to avoid enumerating
    // unrelated PCI devices.
    if (!/\b(vga compatible controller|3d controller|display controller)\b/i.test(trimmedLine)) {
      continue;
    }
    // The device name is the text after the last colon on the line.
    const lastColon = trimmedLine.lastIndexOf(':');
    if (lastColon === -1) {
      continue;
    }
    const name = trimmedLine.slice(lastColon + 1).trim();
    if (name.length === 0) {
      continue;
    }
    rows.push({ index: String(index), name });
    index += 1;
  }

  return rows;
}

/**
 * Shared helper for `get Name`-style tool output: one name per line, an optional
 * header line to skip, positional indices. Treats input as untrusted text.
 *
 * @param {string} stdout Raw tool stdout (untrusted).
 * @param {(line: string) => boolean} isHeader Predicate identifying header lines to skip.
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
function parsePositionalNameList(stdout, isHeader) {
  if (typeof stdout !== 'string' || stdout.length === 0) {
    return [];
  }

  const rows = [];
  let index = 0;
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    if (isHeader(trimmedLine)) {
      continue;
    }
    rows.push({ index: String(index), name: trimmedLine });
    index += 1;
  }

  return rows;
}

/**
 * Ordered list of probe strategies for a given platform. The NVIDIA `nvidia-smi`
 * probe is always attempted first (it is the most reliable device source and is
 * cross-platform), followed by the OS-native fallback. Each strategy names the
 * command, its argument vector, and the pure parser that turns its stdout into
 * `RawGpuRow[]`.
 *
 * @param {NodeJS.Platform | string} platform The `process.platform` value.
 * @returns {{ command: string, args: string[], parse: (stdout: string) => Array<{ index: string, name: string }> }[]}
 */
function probeStrategiesForPlatform(platform) {
  const nvidia = {
    command: 'nvidia-smi',
    args: ['--query-gpu=index,name', '--format=csv,noheader,nounits'],
    parse: parseNvidiaSmiCsv
  };

  if (platform === 'win32') {
    return [
      nvidia,
      { command: 'wmic', args: ['path', 'win32_VideoController', 'get', 'Name'], parse: parseWmicVideoControllers }
    ];
  }
  if (platform === 'darwin') {
    return [
      nvidia,
      { command: 'system_profiler', args: ['SPDisplaysDataType'], parse: parseSystemProfilerDisplays }
    ];
  }
  // Linux and any other POSIX-like platform fall back to lspci.
  return [
    nvidia,
    { command: 'lspci', args: [], parse: parseLspciControllers }
  ];
}

/**
 * Enumerates the system's GPUs under a hard time bound, returning the
 * discriminated `EnumerationResult` documented at the top of this module.
 *
 * Strategy selection (Requirement 1.1): the NVIDIA `nvidia-smi` probe is tried
 * first; if it yields no usable devices, the OS-native fallback for `platform`
 * (`wmic` on Windows, `system_profiler` on macOS, `lspci` elsewhere) is tried.
 * Each probe's stdout is parsed with a pure parser and normalized with
 * `normalizeDetectedGpus`, so all output is treated as untrusted text.
 *
 * Result classification:
 *   - The whole enumeration is raced against a `timeoutMs` (default 5000 ms)
 *     timer. If the timer wins, the result is
 *     `{ ok: false, kind: 'timeout' }` with NO `gpus` field (Requirement 1.4).
 *   - If any strategy completes and normalizes to one or more devices, the
 *     result is `{ ok: true, gpus }` (Requirement 1.1, 1.2).
 *   - If every strategy completes but none yields a device, enumeration is a
 *     successful empty result `{ ok: true, gpus: [] }` (Requirement 1.3) — an
 *     empty success, never an error.
 *   - If every strategy fails to run (the injected `spawnImpl` throws or
 *     rejects for all of them) so that enumeration cannot complete at all, the
 *     result is `{ ok: false, kind: 'unavailable' }` with NO `gpus` field
 *     (Requirement 1.4).
 *
 * All external dependencies are injected so the service is testable without
 * real hardware or a real clock:
 *   - `spawnImpl(command, args)` runs one probe and resolves to a spawn-like
 *     result `{ status?: number, stdout?: string, stderr?: string, error?: Error }`.
 *     A rejection or a truthy `error`/non-zero `status` marks that probe as
 *     failed; its (possibly empty) stdout is still parsed opportunistically.
 *   - `platform` selects the OS fallback strategy (defaults to `process.platform`).
 *   - `timeoutMs` is the hard completion bound (defaults to 5000 ms).
 *   - `now()` returns the current epoch-ms (defaults to `Date.now`); it is only
 *     used to build the timeout error message and is safe to inject in tests.
 *
 * @param {{
 *   spawnImpl: (command: string, args: string[]) => Promise<{ status?: number, stdout?: string, stderr?: string, error?: Error }>,
 *   platform?: NodeJS.Platform | string,
 *   timeoutMs?: number,
 *   now?: () => number
 * }} deps Injected dependencies.
 * @returns {Promise<{ ok: true, gpus: { index: number, name: string }[] } | { ok: false, error: string, kind: 'timeout' | 'unavailable' }>}
 */
export async function enumerateGpus({
  spawnImpl,
  platform = process.platform,
  timeoutMs = DEFAULT_ENUMERATION_TIMEOUT_MS,
  now = Date.now
} = {}) {
  if (typeof spawnImpl !== 'function') {
    return { ok: false, error: 'No GPU probe implementation was provided.', kind: 'unavailable' };
  }

  const effectiveTimeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_ENUMERATION_TIMEOUT_MS;

  const strategies = probeStrategiesForPlatform(platform);

  // The probe pipeline: try each strategy in order, return the first that
  // yields devices, and remember whether every strategy failed to run so we can
  // distinguish "completed with zero devices" (empty success) from "could not
  // enumerate at all" (unavailable error).
  const runProbes = async () => {
    let anyProbeCompleted = false;

    for (const strategy of strategies) {
      let probeResult;
      try {
        probeResult = await spawnImpl(strategy.command, strategy.args);
      } catch {
        // This strategy could not run at all; try the next one.
        continue;
      }

      const result = probeResult || {};
      const failed = Boolean(result.error) || (typeof result.status === 'number' && result.status !== 0);
      const stdout = typeof result.stdout === 'string' ? result.stdout : '';

      // Parse opportunistically even on a non-zero exit: some tools print usable
      // output alongside a non-zero status. Normalization drops anything invalid.
      const gpus = normalizeDetectedGpus(strategy.parse(stdout));

      if (gpus.length > 0) {
        return { ok: true, gpus };
      }

      // A clean exit with zero devices counts as a completed probe (empty
      // success candidate). A failed run does not.
      if (!failed) {
        anyProbeCompleted = true;
      }
    }

    if (anyProbeCompleted) {
      // Every strategy that ran completed cleanly but none found a device.
      return { ok: true, gpus: [] };
    }

    // No strategy could run to completion — enumeration infrastructure is
    // absent or malfunctioning (Requirement 1.4).
    return {
      ok: false,
      error: 'GPU enumeration could not complete: no detection tool was available.',
      kind: 'unavailable'
    };
  };

  // Race the probe pipeline against the hard timeout (Requirement 1.1, 1.4).
  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      const at = typeof now === 'function' ? now() : Date.now();
      resolve({
        ok: false,
        error: `GPU enumeration did not complete within ${effectiveTimeout} ms (at ${at}).`,
        kind: 'timeout'
      });
    }, effectiveTimeout);
  });

  try {
    return await Promise.race([runProbes(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
