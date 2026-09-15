/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Lifecycle_Service (Main process). The only component that touches process
 * control for a local Ollama server: it probes reachability (bounded),
 * classifies local vs. remote, resolves the `ollama` executable, launches
 * `ollama serve` detached, and polls for readiness. It performs no persistence
 * and holds no UI state.
 *
 * The service is a dependency-injected factory mirroring `createRuntimeService`
 * so tests can inject `fetchImpl`, `spawnImpl`, `platform`, and a `now`/timer
 * seam. Each capability is a method on the object returned by
 * `createOllamaLifecycle`; the remaining downstream task (2.4
 * `startLocalServer`) adds a further method to the same factory.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { classifyEndpoint, classifyFetchFailure } from './ollamaClient.js';

/**
 * Default reachability probe timeout. A probe that does not obtain an HTTP
 * response within this bound is aborted and classified Server_Unreachable
 * (Requirement 1.1, 1.3).
 */
const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/**
 * Per-OS default install locations for the `ollama` executable, checked after
 * the search path (Requirement 3.1). These are resolved through the
 * filesystem-existence seam so resolution is testable without a real install.
 *
 * The Windows list is expanded lazily at resolution time because it depends on
 * the `%LOCALAPPDATA%` environment variable; the macOS and Linux lists are
 * fixed absolute paths. On this machine the binary lives at
 * `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, covered by the win32 list.
 */
const DEFAULT_BINARY_LOCATIONS = {
  darwin: [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/Applications/Ollama.app/Contents/Resources/ollama'
  ],
  linux: [
    '/usr/local/bin/ollama',
    '/usr/bin/ollama'
  ]
};

/**
 * Bound for the search-path (`where`/`which`) probe. The lookup is cheap and
 * should never hang; a stuck probe is aborted and treated as "not on path".
 */
const DEFAULT_WHICH_TIMEOUT_MS = 1500;

/**
 * Default readiness bound for a start attempt: the endpoint must become
 * Server_Reachable within this window after `ollama serve` is launched, else the
 * start is classified as a timeout (Requirement 4.4, 4.5).
 */
const DEFAULT_READINESS_TIMEOUT_MS = 30000;

/**
 * Default interval between readiness probes while polling after a launch. The
 * poll cadence is driven by this value and bounded by the readiness deadline
 * (Requirement 4.4).
 */
const DEFAULT_POLL_INTERVAL_MS = 500;

/**
 * Default search-path lookup. Mirrors the bounded `spawnSync(..., { timeout,
 * windowsHide })` precedent used for the Docker/MCP tool probes in
 * `electron/main.js` and the GPU probes in `runtimeService.js`. Uses `where` on
 * Windows and `which` elsewhere to resolve a bare `ollama` on the OS search
 * path. Returns the first resolved absolute path, or `null` when the tool is
 * not on the path (or the probe fails/hangs).
 *
 * `spawnSync` never throws for a missing/failed lookup binary; it reports the
 * failure on `result.error`, which we treat as "not resolved".
 *
 * @param {NodeJS.Platform} platform
 * @returns {string | null}
 */
function defaultWhichImpl(platform) {
  const command = platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, ['ollama'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: DEFAULT_WHICH_TIMEOUT_MS
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  // `where` can list multiple matches (one per line); take the first non-empty
  // line as the resolved executable path.
  const firstMatch = String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstMatch ?? null;
}

/**
 * Create a Lifecycle_Service instance. All process/network/platform seams are
 * injectable so the pure decision logic is testable without a real server,
 * binary, or clock; production defaults wire the real `fetch`,
 * `child_process.spawn`, and `process.platform`.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   spawnImpl?: typeof import('node:child_process').spawn,
 *   platform?: NodeJS.Platform,
 *   now?: () => number,
 *   fileExistsImpl?: (path: string) => boolean,
 *   whichImpl?: (platform: NodeJS.Platform) => string | null,
 *   env?: Record<string, string | undefined>
 * }} [deps]
 * @returns {{
 *   probeReachability: (options?: { endpoint?: unknown, timeoutMs?: number }) => Promise<{
 *     reachable: boolean,
 *     kind: 'local' | 'remote',
 *     normalizedEndpoint: string,
 *     status?: number,
 *     reason?: 'refused' | 'dns' | 'timeout' | 'other'
 *   }>,
 *   resolveOllamaBinary: () => { ok: true, path: string } | { ok: false },
 *   startLocalServer: (options?: {
 *     endpoint?: unknown,
 *     readinessTimeoutMs?: number,
 *     pollIntervalMs?: number
 *   }) => Promise<{ ok: true } | {
 *     ok: false,
 *     reason: 'remote' | 'binary-not-found' | 'spawn-failed' | 'timeout',
 *     error?: string
 *   }>
 * }}
 */
export function createOllamaLifecycle(deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    // Process-launch seam for the start flow (`startLocalServer`). Injectable so
    // the spawn/poll behavior is testable without launching a real process;
    // production wires `child_process.spawn`.
    spawnImpl = spawn,
    platform = process.platform,
    // Monotonic-ish clock seam used to enforce the readiness deadline while
    // polling. Injectable so the timeout is testable without a real clock.
    now = () => Date.now(),
    // Filesystem-existence seam for probing per-OS default install locations,
    // and the search-path (`where`/`which`) lookup seam. Both are injectable so
    // binary resolution is testable without a real install; production defaults
    // wire the real `fs.existsSync` and a bounded `spawnSync` lookup.
    fileExistsImpl = existsSync,
    whichImpl = defaultWhichImpl,
    // Environment seam so the Windows `%LOCALAPPDATA%` default location can be
    // resolved deterministically in tests.
    env = process.env
  } = deps;

  /**
   * Sleep for `ms` milliseconds, resolving on a real timer. Isolated as an
   * inner helper so the poll loop's wait is a single, mockable seam: tests that
   * drive the loop advance fake timers (and the injected `now`) rather than
   * waiting on a wall clock. A non-positive/invalid bound resolves immediately.
   *
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }

  /**
   * Probe the Configured_Endpoint for reachability (Requirement 1). Issues a
   * lightweight `GET {normalized}/api/tags` with an `AbortController` timeout
   * bound. Reachability is decided solely by whether an HTTP response was
   * obtained, never by its status code:
   *
   * - The `fetch` resolves to any HTTP response (including an error status such
   *   as 500) -> `{ reachable: true, kind, normalizedEndpoint, status }`
   *   (Requirement 1.2).
   * - The `fetch` rejects or the probe is aborted on timeout ->
   *   `{ reachable: false, kind, normalizedEndpoint, reason }` where `reason`
   *   is derived from `classifyFetchFailure` (Requirement 1.3).
   *
   * This method never throws for any input: an unusable endpoint is normalized
   * by `classifyEndpoint` (falling back to the default local base URL), and any
   * fetch rejection is classified rather than propagated.
   *
   * @param {{ endpoint?: unknown, timeoutMs?: number }} [options]
   * @returns {Promise<{
   *   reachable: boolean,
   *   kind: 'local' | 'remote',
   *   normalizedEndpoint: string,
   *   status?: number,
   *   reason?: 'refused' | 'dns' | 'timeout' | 'other'
   * }>}
   */
  async function probeReachability(options = {}) {
    const { endpoint, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = options;

    // Total, never-throwing classification + normalization of the endpoint.
    const { kind, normalizedEndpoint } = classifyEndpoint(endpoint);

    // Bound the probe: abort if no HTTP response is obtained within timeoutMs.
    // A non-positive/invalid bound falls back to the default so a caller cannot
    // accidentally disable the timeout.
    const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_PROBE_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetchImpl(`${normalizedEndpoint}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      });

      // Any resolved HTTP response means the server is reachable, regardless of
      // status code (Requirement 1.2).
      return {
        reachable: true,
        kind,
        normalizedEndpoint,
        status: typeof response?.status === 'number' ? response.status : undefined
      };
    } catch (error) {
      // A rejected/aborted fetch means no HTTP response was obtained: classify
      // the transport failure into a coarse reason (Requirement 1.3). Anything
      // classifyFetchFailure does not recognize as unreachable is still an
      // unreachable outcome from the probe's perspective (no response), so it
      // is reported with reason 'other'.
      const { unreachable, reason } = classifyFetchFailure(error);
      return {
        reachable: false,
        kind,
        normalizedEndpoint,
        reason: unreachable ? reason : 'other'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve the per-OS default install locations for the `ollama` executable
   * (Requirement 3.1, step (b)). The Windows list is expanded from
   * `%LOCALAPPDATA%`; macOS and Linux use fixed absolute paths. Platforms
   * without a known default location yield an empty list.
   *
   * @returns {string[]}
   */
  function defaultLocationsForPlatform() {
    if (platform === 'win32') {
      const localAppData = env?.LOCALAPPDATA;
      if (typeof localAppData !== 'string' || !localAppData.trim()) {
        return [];
      }
      return [join(localAppData, 'Programs', 'Ollama', 'ollama.exe')];
    }
    return DEFAULT_BINARY_LOCATIONS[platform] ?? [];
  }

  /**
   * Resolve the `ollama` executable for the current OS (Requirement 3).
   *
   * Resolution order:
   *   (a) the system executable search path via the `where`/`which` lookup seam
   *       (Requirement 3.1) — a resolved path is returned as-is;
   *   (b) otherwise, the per-OS default install locations (Windows
   *       `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`; macOS `/usr/local/bin`,
   *       `/opt/homebrew/bin`, `/Applications/Ollama.app/...`; Linux
   *       `/usr/local/bin`, `/usr/bin`), probed through the filesystem-existence
   *       seam and returned on the first hit (Requirement 3.2).
   *
   * When neither the search path nor any default location resolves, returns
   * `{ ok: false }` so the caller reports a "binary not found" start failure
   * and never spawns a process (Requirement 3.3). This method never throws: a
   * lookup that errors is treated as "not on path" and an existence check that
   * throws is treated as "does not exist".
   *
   * @returns {{ ok: true, path: string } | { ok: false }}
   */
  function resolveOllamaBinary() {
    // (a) Search path first (Requirement 3.1). The lookup seam returns an
    // absolute path when `ollama` is resolvable on the OS search path, or null.
    let onPath = null;
    try {
      onPath = whichImpl(platform);
    } catch {
      onPath = null;
    }
    if (typeof onPath === 'string' && onPath.trim()) {
      return { ok: true, path: onPath.trim() };
    }

    // (b) Per-OS default install locations, first existing hit wins
    // (Requirement 3.2).
    for (const candidate of defaultLocationsForPlatform()) {
      let exists = false;
      try {
        exists = fileExistsImpl(candidate) === true;
      } catch {
        exists = false;
      }
      if (exists) {
        return { ok: true, path: candidate };
      }
    }

    // Neither the search path nor any default location resolved
    // (Requirement 3.3).
    return { ok: false };
  }

  /**
   * Start a local Ollama server and confirm readiness (Requirement 4). The
   * decision flow, in order:
   *
   *   1. Classify the endpoint. A Remote_Endpoint is refused with
   *      `{ ok: false, reason: 'remote' }` BEFORE any resolution or spawn — the
   *      app can only control a server on this machine (Requirement 4.2).
   *   2. Resolve the `ollama` executable. When unresolved, return
   *      `{ ok: false, reason: 'binary-not-found' }` and never spawn a process
   *      (Requirement 3.3, 4.6).
   *   3. Spawn `<resolved> serve` detached (`detached: true, windowsHide: true,
   *      stdio: 'ignore'`) and `unref()` the child so `ollama serve` (a
   *      foreground HTTP server in its own process) outlives this call without
   *      blocking the app (Requirement 4.1, "Start mechanics" note). A
   *      synchronous throw from `spawn`, an asynchronous `'error'` event, or an
   *      immediate `'exit'`/`'close'` before readiness are all classified
   *      `{ ok: false, reason: 'spawn-failed', error }` (Requirement 4.6).
   *   4. Poll `probeReachability` every `pollIntervalMs` until the endpoint is
   *      reachable -> `{ ok: true }` (Requirement 4.4), or the readiness
   *      deadline elapses -> `{ ok: false, reason: 'timeout' }` (Requirement
   *      4.5). The deadline is measured with the injected `now` seam so it is
   *      testable without a real clock.
   *
   * Readiness is confirmed by the HTTP probe, not by process state, so a server
   * that takes a moment to bind its port is handled correctly. This method
   * never throws: every failure path is a `{ ok: false, reason }` result.
   *
   * @param {{ endpoint?: unknown, readinessTimeoutMs?: number, pollIntervalMs?: number }} [options]
   * @returns {Promise<{ ok: true } | {
   *   ok: false,
   *   reason: 'remote' | 'binary-not-found' | 'spawn-failed' | 'timeout',
   *   error?: string
   * }>}
   */
  async function startLocalServer(options = {}) {
    const {
      endpoint,
      readinessTimeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
      pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
    } = options;

    // (1) Refuse a Remote_Endpoint before resolving or spawning anything: this
    // app can only start a server on the local machine (Requirement 4.2).
    const { kind, normalizedEndpoint } = classifyEndpoint(endpoint);
    if (kind !== 'local') {
      return { ok: false, reason: 'remote' };
    }

    // (2) Resolve the executable; never spawn when it cannot be found
    // (Requirement 3.3, 4.6).
    const resolved = resolveOllamaBinary();
    if (!resolved.ok) {
      return { ok: false, reason: 'binary-not-found' };
    }

    // (3) Spawn `ollama serve` detached with hidden window and ignored stdio so
    // the foreground server process does not block the app (Requirement 4.1).
    // A synchronous throw, an async 'error' event, or an immediate exit before
    // readiness are all 'spawn-failed' (Requirement 4.6).
    let spawnFailure = null;
    try {
      const child = spawnImpl(resolved.path, ['serve'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      });

      // Capture an asynchronous launch failure. Node emits 'error' when the
      // process cannot be spawned (e.g. ENOENT) after the synchronous call has
      // already returned; record it so the poll loop can surface 'spawn-failed'
      // rather than waiting out the full readiness deadline.
      if (child && typeof child.on === 'function') {
        child.on('error', (error) => {
          if (!spawnFailure) {
            spawnFailure = error;
          }
        });
      }

      // Detach the child so it is not tied to this process's lifetime and does
      // not keep the event loop alive.
      if (child && typeof child.unref === 'function') {
        child.unref();
      }
    } catch (error) {
      // Synchronous spawn throw (Requirement 4.6).
      return {
        ok: false,
        reason: 'spawn-failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }

    // (4) Poll for readiness until reachable or the deadline elapses. The
    // deadline is anchored to the injected `now` seam so it is controllable in
    // tests (Requirement 4.4, 4.5).
    const deadline = now() + (Number.isFinite(readinessTimeoutMs) && readinessTimeoutMs > 0
      ? readinessTimeoutMs
      : DEFAULT_READINESS_TIMEOUT_MS);

    while (true) {
      // An asynchronous launch failure observed via the child's 'error' event
      // is terminal: report it as 'spawn-failed' rather than polling on
      // (Requirement 4.6).
      if (spawnFailure) {
        return {
          ok: false,
          reason: 'spawn-failed',
          error: spawnFailure instanceof Error ? spawnFailure.message : String(spawnFailure)
        };
      }

      const probe = await probeReachability({ endpoint: normalizedEndpoint });
      if (probe.reachable) {
        return { ok: true };
      }

      // Re-check the async failure seam after the probe (it may have fired
      // while the probe was in flight) before deciding to wait again.
      if (spawnFailure) {
        return {
          ok: false,
          reason: 'spawn-failed',
          error: spawnFailure instanceof Error ? spawnFailure.message : String(spawnFailure)
        };
      }

      // Stop once the readiness window has elapsed (Requirement 4.5). Checked
      // before sleeping so a probe completing exactly at/after the deadline
      // yields a timeout rather than one more wait.
      if (now() >= deadline) {
        return { ok: false, reason: 'timeout' };
      }

      await sleep(pollIntervalMs);
    }
  }

  return {
    probeReachability,
    resolveOllamaBinary,
    startLocalServer
  };
}

export {
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_BINARY_LOCATIONS,
  DEFAULT_READINESS_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS
};
