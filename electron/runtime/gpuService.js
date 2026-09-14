/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * GPU_Service (Main process) — enumerates system GPUs and reports them to the
 * renderer through the preload bridge. This module owns Requirement 1
 * (enumeration) only: it performs no persistence and no reconciliation.
 *
 * Enumeration attempts an ordered, platform-selected set of probe strategies
 * covering multiple GPU vendors plus a generic OS-level fallback that lists
 * devices by name without any vendor CLI. The ordered set, filtered to what
 * applies on each platform, is:
 *
 *   NVIDIA (`nvidia-smi`, cross-platform, first)
 *     → AMD (`rocm-smi`)
 *     → Intel (platform-applicable Intel GPU query)
 *     → Apple/macOS (`system_profiler`, on darwin)
 *     → generic OS-level fallback (no vendor CLI):
 *         • Windows: WMI/CIM `Win32_VideoController` via PowerShell
 *         • Linux:   `lspci`
 *         • macOS:   `system_profiler` (also the generic fallback)
 *
 * The first strategy that yields one or more devices short-circuits and
 * provides the aggregated list; later strategies are not needed once devices
 * are found. Every probe's stdout is treated as untrusted text.
 *
 * Enumeration returns a discriminated `EnumerationResult`. Exactly one shape is
 * ever returned; never a hybrid:
 *
 *   { ok: true,  gpus: DetectedGpu[] }                                        // success (may be empty)
 *   { ok: false, error: string, kind: 'timeout' | 'unavailable' | 'failed' } // error, NO `gpus` field
 *
 * A completed probe that finds zero devices is an empty *success*
 * (`{ ok: true, gpus: [] }`, Requirement 1.3), never an error.
 *
 * There are three distinct `ok: false` kinds:
 *   - `timeout`     — the whole multi-strategy pipeline did not finish within
 *                     the 5-second bound (Requirement 3.3). Hard failure.
 *   - `unavailable` — NO strategy (vendor or generic OS-level) could be spawned
 *                     to produce a device list (Requirement 2.5). This is a
 *                     *non-failure* degraded state: the OS simply exposes no
 *                     detection tool the app knows how to run, and the GPU
 *                     Selection screen stays usable.
 *   - `failed`      — at least one strategy spawned but malfunctioned (ran yet
 *                     could not produce a valid device list, e.g. a non-zero
 *                     exit with garbage stdout, Requirement 3.4). Hard failure,
 *                     kept distinct from the graceful `unavailable`.
 *
 * An `ok: false` result never carries a `gpus` list.
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
 * Parses the stdout of the AMD `rocm-smi` probe into loose `RawGpuRow` objects.
 *
 * `rocm-smi` reports one device per line, tagged with a bracketed GPU ordinal
 * and a labelled field carrying the device/card name, e.g.:
 *
 *   GPU[0]		: Card series: AMD Instinct MI210
 *   GPU[1]		: Card series: AMD Radeon RX 7900 XTX
 *
 * The device index is the number inside `GPU[n]`; the name is the text after
 * the last `:` on the line (the label — "Card series", "Card model", etc. — is
 * discarded, leaving the human-readable name). Lines without a `GPU[n]` prefix
 * are skipped. All input is treated as untrusted text: strict extraction, no
 * `eval`. `normalizeDetectedGpus` re-validates and caps every row.
 *
 * @param {string} stdout Raw stdout from the rocm-smi probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseRocmSmi(stdout) {
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
    // Require a bracketed GPU ordinal so unrelated banner/summary lines are
    // ignored. The ordinal supplies the device index.
    const match = /^GPU\[(\d+)\]\s*:?\s*(.*)$/i.exec(trimmedLine);
    if (!match) {
      continue;
    }
    const index = match[1];
    let remainder = match[2];
    // The name is the text after the last colon (drop the "Card series:" /
    // "Card model:" style label). If there is no further colon, the remainder
    // itself is the name.
    const lastColon = remainder.lastIndexOf(':');
    if (lastColon !== -1) {
      remainder = remainder.slice(lastColon + 1);
    }
    const name = remainder.trim();
    if (name.length === 0) {
      continue;
    }
    rows.push({ index, name });
  }

  return rows;
}

/**
 * Parses the stdout of an Intel GPU query into loose `RawGpuRow` objects. The
 * query lists one adapter description per line (Intel tooling / OS Intel-GPU
 * listings print the device name per line, sometimes with a leading ordinal or
 * label). Blank lines and an optional `Name` header are skipped, and indices
 * are synthesized positionally in listing order.
 *
 * All input is treated as untrusted text: strict line extraction, no `eval`.
 *
 * @param {string} stdout Raw stdout from the Intel GPU probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseIntelGpu(stdout) {
  return parsePositionalNameList(stdout, (line) => line.toLowerCase() === 'name');
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
 * Parses the stdout of the Windows generic OS-level fallback — a WMI/CIM
 * `Win32_VideoController` query run via PowerShell
 * (`Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name`) —
 * into loose `RawGpuRow` objects. The query prints one adapter name per line
 * (no device-index column), so indices are synthesized positionally
 * (0, 1, 2, ...) in listing order. This is the strategy that must list all
 * five AMD cards on the primary Windows repro.
 *
 * `Select-Object -ExpandProperty Name` emits no header, but a `Name` header
 * line (as `Format-Table`/`Get-CimInstance ... | Select Name` would print) is
 * tolerated and skipped so the parser is robust to either invocation form. All
 * input is treated as untrusted text: strict line extraction, no `eval`.
 * `normalizeDetectedGpus` re-validates and caps every row.
 *
 * @param {string} stdout Raw stdout from the PowerShell Win32_VideoController probe (untrusted).
 * @returns {{ index: string, name: string }[]} Extracted raw rows.
 */
export function parseWin32VideoControllers(stdout) {
  // Skip a `Name` column header and the `----` separator PowerShell table
  // output may include; `Select-Object -ExpandProperty Name` produces neither.
  return parsePositionalNameList(
    stdout,
    (line) => line.toLowerCase() === 'name' || /^-+$/.test(line)
  );
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
    // Keep only graphics controllers (VGA / 3D / Display) and capture the name
    // as the text immediately following the controller-class label's colon. The
    // name itself may legitimately contain colons (e.g. a trailing revision), so
    // we anchor on the class keyword rather than the last colon on the line.
    const match =
      /\b(?:vga compatible controller|3d controller|display controller)\s*:\s*(.*)$/i.exec(trimmedLine);
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
 * Ordered, platform-selected list of probe strategies. The pipeline tries them
 * in a fixed vendor-first order, filtered to what applies on each platform:
 *
 *   NVIDIA (`nvidia-smi`, cross-platform, first)
 *     → AMD (`rocm-smi`)
 *     → Intel (platform-applicable Intel GPU query)
 *     → Apple/macOS (`system_profiler`, on darwin)
 *     → generic OS-level fallback (no vendor CLI):
 *         • Windows: WMI/CIM `Win32_VideoController` via PowerShell
 *         • Linux:   `lspci`
 *         • macOS:   `system_profiler` (also the generic fallback)
 *
 * Each strategy names the command, its argument vector, and the pure parser
 * that turns its stdout into `RawGpuRow[]`. Strategies that do not apply to a
 * platform are omitted from its list. The command strings intentionally carry
 * the vendor/tool name so the caller-injected `spawnImpl` can be matched in
 * tests and so the OS resolves the right executable at runtime.
 *
 * @param {NodeJS.Platform | string} platform The `process.platform` value.
 * @returns {{ command: string, args: string[], parse: (stdout: string) => Array<{ index: string, name: string }> }[]}
 */
function probeStrategiesForPlatform(platform) {
  // NVIDIA — cross-platform, most reliable, always first.
  const nvidia = {
    command: 'nvidia-smi',
    args: ['--query-gpu=index,name', '--format=csv,noheader,nounits'],
    parse: parseNvidiaSmiCsv
  };

  // AMD — cross-platform vendor CLI.
  const amd = {
    command: 'rocm-smi',
    args: ['--showproductname'],
    parse: parseRocmSmi
  };

  if (platform === 'win32') {
    return [
      nvidia,
      amd,
      // Intel: query the Intel adapter name via WMI/CIM filtered to Intel.
      {
        command: 'powershell',
        args: [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'Intel' } | Select-Object -ExpandProperty Name"
        ],
        parse: parseIntelGpu
      },
      // Generic OS-level fallback: WMI/CIM Win32_VideoController via PowerShell.
      {
        command: 'powershell',
        args: [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'
        ],
        parse: parseWin32VideoControllers
      }
    ];
  }

  if (platform === 'darwin') {
    return [
      nvidia,
      amd,
      // Apple Silicon / macOS + generic fallback: system_profiler names every
      // display adapter, including the integrated Apple GPU.
      { command: 'system_profiler', args: ['SPDisplaysDataType'], parse: parseSystemProfilerDisplays }
    ];
  }

  // Linux and any other POSIX-like platform.
  return [
    nvidia,
    amd,
    // Intel: the Intel GPU top query (`intel_gpu_top -L` lists adapters).
    { command: 'intel_gpu_top', args: ['-L'], parse: parseIntelGpu },
    // Generic OS-level fallback: lspci enumerates graphics controllers by name.
    { command: 'lspci', args: [], parse: parseLspciControllers }
  ];
}

/**
 * Enumerates the system's GPUs under a hard time bound, returning the
 * discriminated `EnumerationResult` documented at the top of this module.
 *
 * Strategy selection (Requirement 2.1, 2.2): the ordered, platform-selected set
 * from `probeStrategiesForPlatform` is tried in turn — NVIDIA → AMD → Intel →
 * Apple/macOS → generic OS-level fallback. The first strategy that normalizes
 * to one or more devices short-circuits and yields the list. Each probe's
 * stdout is parsed with a pure parser and normalized with
 * `normalizeDetectedGpus`, so all output is treated as untrusted text.
 *
 * Result classification:
 *   - The whole multi-strategy pipeline is raced against a `timeoutMs`
 *     (default 5000 ms) timer. If the timer wins, the result is
 *     `{ ok: false, kind: 'timeout' }` with NO `gpus` field (Requirement 3.3).
 *   - If any strategy completes and normalizes to one or more devices, the
 *     result is `{ ok: true, gpus }` (Requirement 2.4, 3.1).
 *   - If every strategy that ran clean-exited (`status === 0`, no error) but
 *     none yielded a device, enumeration is a successful empty result
 *     `{ ok: true, gpus: [] }` (Requirement 3.2) — an empty success.
 *   - If at least one strategy spawned but every run malfunctioned (non-zero
 *     exit / error, no valid device list), the result is
 *     `{ ok: false, kind: 'failed' }` — a hard failure (Requirement 3.4).
 *   - If NO strategy could be spawned at all (the injected `spawnImpl` throws
 *     or rejects for every one), the result is
 *     `{ ok: false, kind: 'unavailable' }` — the graceful, non-failure signal
 *     that no detection tool the app knows how to run is available
 *     (Requirement 2.5).
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
 * @returns {Promise<{ ok: true, gpus: { index: number, name: string }[] } | { ok: false, error: string, kind: 'timeout' | 'unavailable' | 'failed' }>}
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

  // The probe pipeline: try each strategy in order and short-circuit to the
  // first that yields devices. Two flags drive the three-way terminal split:
  //   - anyProbeCompleted: a probe spawned AND clean-exited (status 0, no error)
  //     reporting zero devices → empty-success candidate.
  //   - anyProbeSpawned:    a probe spawned at all (regardless of exit status).
  //     Distinguishes a strategy that ran-but-malfunctioned (`failed`) from the
  //     graceful "no strategy could be spawned at all" case (`unavailable`).
  const runProbes = async () => {
    let anyProbeCompleted = false;
    let anyProbeSpawned = false;

    for (const strategy of strategies) {
      let probeResult;
      try {
        probeResult = await spawnImpl(strategy.command, strategy.args);
      } catch {
        // This strategy could not be spawned at all; try the next one. It does
        // NOT count as a run, so it never promotes the terminal outcome above
        // `unavailable`.
        continue;
      }

      // A spawn that resolved (even to a non-zero status) means the tool ran.
      anyProbeSpawned = true;

      const result = probeResult || {};
      const failed = Boolean(result.error) || (typeof result.status === 'number' && result.status !== 0);
      const stdout = typeof result.stdout === 'string' ? result.stdout : '';

      // A failed run (non-zero exit / error) is a malfunctioning tool: its
      // stdout is not trusted as a device list. Only a clean run contributes
      // devices or promotes the empty-success outcome, so a probe that spawns
      // but exits non-zero with garbage is classified `failed`, distinct from
      // the graceful `unavailable` no-strategy case (Requirement 3.4).
      if (failed) {
        continue;
      }

      // Normalization treats the parsed rows as untrusted and drops anything
      // invalid, so a clean but empty/garbled listing yields zero devices.
      const gpus = normalizeDetectedGpus(strategy.parse(stdout));

      if (gpus.length > 0) {
        return { ok: true, gpus };
      }

      // A clean exit with zero devices counts as a completed probe (empty
      // success candidate).
      anyProbeCompleted = true;
    }

    if (anyProbeCompleted) {
      // At least one strategy ran cleanly and every run reported zero devices:
      // an empty success, never an error (Requirement 3.2).
      return { ok: true, gpus: [] };
    }

    if (anyProbeSpawned) {
      // At least one strategy spawned but every run malfunctioned (non-zero
      // exit / error, no valid device list): a hard failure, kept distinct from
      // the graceful no-strategy case (Requirement 3.4).
      return {
        ok: false,
        error: 'GPU enumeration failed: a detection tool ran but did not report a valid device list.',
        kind: 'failed'
      };
    }

    // No strategy — vendor or generic OS-level — could be spawned at all. This
    // is the graceful, non-failure degraded state: the OS exposes no detection
    // tool the app knows how to run (Requirement 2.5).
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
