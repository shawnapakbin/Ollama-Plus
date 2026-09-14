// Ollama + — Python sandbox library
//
// Provides Docker-isolated execution of Python code for 3D scripting workflows.
// Reuses the shared confinement / sanitization helpers from ./security.mjs so
// there is a single source of truth for sandbox roots, environment scrubbing,
// timeout clamping, and blocked-pattern detection.
//
// This module backs the four `python` gateway actions (health, run, list_runs,
// read_artifact) and the standalone mcp/python-sandbox-server.mjs stdio server.

import { spawn } from 'child_process';
import fs from 'fs';
import {
  clampNumber,
  ensureDir,
  getSandboxRoot,
  hasBlockedPythonPattern,
  randomId,
  resolveInsideRoot,
  sanitizeEnv
} from './security.mjs';

// Maximum number of bytes retained from a sandbox run's stdout/stderr. Output
// beyond this is truncated and the run result flags `truncated: true`.
export const SANDBOX_OUTPUT_LIMIT = 65_536;

// Default execution timeout (seconds) applied when a run omits `timeoutSec`.
export const DEFAULT_TIMEOUT_SEC = 30;

// Inclusive bounds that `timeoutSec` is clamped to.
export const MIN_TIMEOUT_SEC = 1;
export const MAX_TIMEOUT_SEC = 120;

// Wall-clock guard (milliseconds) for a container run. On expiry the container
// is force-removed and an execution-timeout error is returned.
export const EXEC_TIMEOUT_MS = 30_000;

// Bounded timeout for the lightweight `docker --version` availability probe.
const DOCKER_VERSION_TIMEOUT_MS = 1_500;

// Default Docker image for sandbox runs. Built from mcp/docker/python-3d.Dockerfile
// (`docker build -f mcp/docker/python-3d.Dockerfile -t ollama-plus/python-3d:latest mcp/docker`).
// Overridable per-run via `payload.image` or globally via the MCP_PY_IMAGE env var.
export const DEFAULT_SANDBOX_IMAGE = 'ollama-plus/python-3d:latest';

// File name the submitted Python script is written to inside each run directory.
// The bind mount maps the run directory to /work inside the container, so the
// container invocation runs `python /work/script.py`.
const SCRIPT_FILE_NAME = 'script.py';

// Working directory mounted inside the container. Matches WORKDIR in the Dockerfile.
const CONTAINER_WORKDIR = '/work';

/**
 * Clamp a supplied timeout (seconds) to the inclusive [MIN_TIMEOUT_SEC,
 * MAX_TIMEOUT_SEC] range, applying the documented default when no timeout is
 * supplied or the value is not a finite number.
 *
 * Semantics (Property 20 / Requirements 3.4, 3.5):
 * - Absent (`null`/`undefined`) → `DEFAULT_TIMEOUT_SEC`.
 * - Non-finite / non-numeric → `DEFAULT_TIMEOUT_SEC` (via `clampNumber`'s fallback).
 * - In-range value → preserved (truncated to an integer, since the sandbox
 *   applies an integer timeout).
 * - Below `MIN_TIMEOUT_SEC` → clamped up to `MIN_TIMEOUT_SEC`.
 * - Above `MAX_TIMEOUT_SEC` → clamped down to `MAX_TIMEOUT_SEC`.
 *
 * Pure and side-effect free so the clamping contract is unit/property testable
 * without a Docker layer.
 *
 * @param {number|null|undefined} timeoutSec
 * @returns {number} An integer in the inclusive range 1..120.
 */
export function clampTimeoutSec(timeoutSec) {
  if (timeoutSec == null) return DEFAULT_TIMEOUT_SEC;
  const clamped = clampNumber(timeoutSec, MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC, DEFAULT_TIMEOUT_SEC);
  // The sandbox applies an integer timeout; truncate toward zero. The value is
  // already within [1, 120], so flooring keeps it in range.
  return Math.trunc(clamped);
}

/**
 * Resolve the Docker image to use for a run: explicit override, then MCP_PY_IMAGE,
 * then the built-in default.
 * @param {string} [override]
 * @returns {string}
 */
function resolveSandboxImage(override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  const fromEnv = process.env.MCP_PY_IMAGE;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_SANDBOX_IMAGE;
}

/**
 * Create a per-run directory under the sandbox root and write the submitted
 * script into it. The directory is resolved with `resolveInsideRoot` so it can
 * never escape the sandbox root.
 * @param {string} runId
 * @param {string} code
 * @returns {{ runDir: string, scriptPath: string }}
 */
function prepareRunDir(runId, code) {
  const sandboxRoot = getSandboxRoot();
  ensureDir(sandboxRoot);
  const runDir = resolveInsideRoot(sandboxRoot, runId);
  ensureDir(runDir);
  const scriptPath = resolveInsideRoot(runDir, SCRIPT_FILE_NAME);
  fs.writeFileSync(scriptPath, typeof code === 'string' ? code : String(code ?? ''), 'utf8');
  return { runDir, scriptPath };
}

/**
 * Build the argument vector for the isolated `docker run` invocation.
 *
 * The container drops network access, drops all Linux capabilities, forbids
 * privilege escalation, runs on a read-only root filesystem with a writable
 * tmpfs for /tmp, and bind-mounts only the per-run directory (mapped to the
 * container workdir). The submitted script is executed from inside that mount,
 * so filesystem access is confined to the run directory.
 *
 * @param {{ containerName: string, runDir: string, image: string }} opts
 * @returns {string[]}
 */
function buildDockerRunArgs({ containerName, runDir, image }) {
  return [
    'run',
    '--rm',
    '--name', containerName,
    // Drop network access entirely.
    '--network', 'none',
    // Least-privilege container hardening.
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    // Writable scratch space that does not persist.
    '--tmpfs', '/tmp:rw,size=64m',
    // Bind mount confined to the per-run directory only.
    '-v', `${runDir}:${CONTAINER_WORKDIR}`,
    '-w', CONTAINER_WORKDIR,
    image,
    'python', `${CONTAINER_WORKDIR}/${SCRIPT_FILE_NAME}`
  ];
}

/**
 * Check whether Docker is available by spawning `docker --version`.
 *
 * @returns {Promise<string>} Resolves to the detected Docker version string
 *   (the trimmed stdout of `docker --version`) when Docker is available.
 * @throws Rejects when Docker is not installed, not on PATH, or the probe
 *   fails/exits non-zero, so callers can surface a "Docker unavailable" state.
 */
export function checkDockerAvailable() {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('docker', ['--version'], {
        env: sanitizeEnv(process.env),
        windowsHide: true
      });
    } catch (err) {
      reject(new Error(`Docker unavailable: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore teardown failure
      }
      finish(reject, new Error('Docker unavailable: version probe timed out'));
    }, DOCKER_VERSION_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      finish(reject, new Error(`Docker unavailable: ${err instanceof Error ? err.message : String(err)}`));
    });

    child.on('close', (code) => {
      const version = stdout.trim();
      if (code === 0 && version) {
        finish(resolve, version);
        return;
      }
      const detail = stderr.trim() || `exit code ${code}`;
      finish(reject, new Error(`Docker unavailable: ${detail}`));
    });
  });
}

// --- Placeholders implemented in later subtasks (1.2, 1.3, 1.4) ---
// These are declared now so the module is importable by the standalone stdio
// server (mcp/python-sandbox-server.mjs) and the future gateway routes.

/**
 * Run Python code in an isolated Docker sandbox.
 *
 * Responsibilities implemented here (subtask 1.2):
 * - Reject blocked-pattern code up front (unless `approveUnsafe === true`) with a
 *   failure result and without creating a run directory or executing a container.
 * - Clamp `timeoutSec` to the inclusive 1-120 range, defaulting to
 *   `DEFAULT_TIMEOUT_SEC` when absent while preserving in-range values.
 * - Write the script into a fresh per-run directory under the sandbox root and
 *   launch a hardened Docker container: sanitized environment (allow-listed vars
 *   plus the sandbox marker), a bind mount confined to the run directory, and no
 *   network access.
 *
 * Subtask 1.3 adds the wall-clock `EXEC_TIMEOUT_MS` guard with `docker rm -f`
 * teardown (partial state discarded on timeout), output truncation to
 * `SANDBOX_OUTPUT_LIMIT` bytes, the Docker-unavailable resolution path (resolve,
 * never reject), and the finalized `{ ok, runId, stdout, stderr, exitCode,
 * truncated, error? }` shape.
 *
 * @param {{ code: string, timeoutSec?: number, image?: string, approveUnsafe?: boolean }} args
 * @returns {Promise<{ ok: boolean, runId: string, stdout: string, stderr: string, exitCode: number|null, truncated: boolean, error?: string }>}
 */
export async function runSandboxedPython(args = {}) {
  const { code = '', timeoutSec, image, approveUnsafe } = args;

  // 1) Blocked-pattern rejection — before any run directory or container work.
  if (approveUnsafe !== true && hasBlockedPythonPattern(code)) {
    return {
      ok: false,
      runId: '',
      stdout: '',
      stderr: '',
      exitCode: null,
      truncated: false,
      error: 'Python code matched a blocked pattern; set approveUnsafe to run it anyway.'
    };
  }

  // 2) Timeout clamp: preserve in-range values, clamp out-of-range, default when absent.
  const effectiveTimeoutSec = clampTimeoutSec(timeoutSec);

  // 3) Per-run directory + script.
  const runId = randomId('run');
  const { runDir } = prepareRunDir(runId, code);

  // 4) Launch the hardened container with a sanitized environment.
  const containerName = `ollama-plus-sandbox-${runId}`;
  const dockerArgs = buildDockerRunArgs({
    containerName,
    runDir,
    image: resolveSandboxImage(image)
  });

  const exec = await runDockerContainer({
    containerName,
    dockerArgs,
    timeoutSec: effectiveTimeoutSec
  });

  // Docker missing (spawn ENOENT / spawn error): resolve — never reject — with a
  // Docker-unavailable result carrying the canonical empty-output shape.
  if (exec.dockerUnavailable) {
    return {
      ok: false,
      runId,
      stdout: '',
      stderr: '',
      exitCode: null,
      truncated: false,
      error: exec.error || 'Docker unavailable'
    };
  }

  // Wall-clock execution timeout: the container was force-removed and partial
  // state discarded. Surface an execution-timeout error result.
  if (exec.timedOut) {
    return {
      ok: false,
      runId,
      stdout: exec.stdout,
      stderr: exec.stderr,
      exitCode: null,
      truncated: exec.truncated,
      error: `Execution timed out after ${EXEC_TIMEOUT_MS} ms; container was terminated.`
    };
  }

  return {
    ok: exec.exitCode === 0,
    runId,
    stdout: exec.stdout,
    stderr: exec.stderr,
    exitCode: exec.exitCode,
    truncated: exec.truncated
  };
}

/**
 * Truncate a captured output buffer to at most `SANDBOX_OUTPUT_LIMIT` bytes,
 * measured by UTF-8 byte length (not character count).
 *
 * @param {string} text
 * @returns {{ text: string, truncated: boolean }} The (possibly truncated) text
 *   and a flag that is true iff the original byte length exceeded the limit.
 */
export function truncateToByteLimit(text) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= SANDBOX_OUTPUT_LIMIT) {
    return { text, truncated: false };
  }
  // Slice on the byte boundary, then trim back to a valid UTF-8 character
  // boundary. Decoding a split multi-byte sequence would emit U+FFFD (3 bytes),
  // which can be wider than the 1–2 partial bytes it replaces and push the
  // re-encoded result back over the limit. Walk backwards over any trailing
  // continuation bytes (0b10xxxxxx) and drop an incomplete leading byte of a
  // multibyte sequence so no partial sequence remains.
  let end = SANDBOX_OUTPUT_LIMIT;
  // `buf[end]` is the first byte that would be dropped. If it is a UTF-8
  // continuation byte (10xxxxxx), the boundary fell inside a multibyte
  // sequence: walk back past the continuation bytes and drop the sequence's
  // lead byte too, so no partial (and therefore U+FFFD-producing) sequence
  // survives. If `buf[end]` is not a continuation byte, the boundary is
  // already clean and everything up to `end` is complete.
  if ((buf[end] & 0xc0) === 0x80) {
    do {
      end--;
    } while (end > 0 && (buf[end] & 0xc0) === 0x80);
    // `buf[end]` is now the lead byte of the split sequence; drop it as well.
    // (Its continuation bytes were the ones we just skipped past.)
  }
  return { text: buf.subarray(0, end).toString('utf8'), truncated: true };
}

/**
 * Force-remove a container by name via `docker rm -f`. Fire-and-forget: the
 * spawn is best-effort teardown, so any failure (including Docker itself being
 * gone) is swallowed rather than surfaced.
 *
 * @param {string} containerName
 */
function forceRemoveContainer(containerName) {
  try {
    const rm = spawn('docker', ['rm', '-f', containerName], {
      env: sanitizeEnv(process.env),
      windowsHide: true
    });
    // Swallow teardown errors — the container may already be gone.
    rm.on('error', () => {});
  } catch {
    // ignore — best-effort teardown
  }
}

/**
 * Spawn `docker run ...`, capture its output, and enforce the wall-clock
 * `EXEC_TIMEOUT_MS` guard.
 *
 * Behavior:
 * - Runs with a sanitized environment (`sanitizeEnv` — allow-listed vars plus
 *   the sandbox marker).
 * - On expiry of `EXEC_TIMEOUT_MS`, kills the child, force-removes the container
 *   (`docker rm -f`) to discard partial state, and resolves with `timedOut: true`.
 * - Truncates stdout/stderr to `SANDBOX_OUTPUT_LIMIT` bytes (UTF-8 byte length),
 *   setting `truncated` true iff either stream's original byte length exceeded
 *   the limit.
 * - When Docker is missing (spawn error / ENOENT), resolves — never rejects —
 *   with `dockerUnavailable: true` so the caller returns a Docker-unavailable
 *   result instead of throwing.
 *
 * @param {{ containerName: string, dockerArgs: string[], timeoutSec: number }} opts
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number|null, truncated: boolean, timedOut?: boolean, dockerUnavailable?: boolean, error?: string }>}
 */
function runDockerContainer({ containerName, dockerArgs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('docker', dockerArgs, {
        env: sanitizeEnv(process.env),
        windowsHide: true
      });
    } catch (err) {
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        truncated: false,
        dockerUnavailable: true,
        error: `Docker unavailable: ${err instanceof Error ? err.message : String(err)}`
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finalize = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = truncateToByteLimit(stdout);
      const errOut = truncateToByteLimit(stderr);
      resolve({
        stdout: out.text,
        stderr: errOut.text,
        truncated: out.truncated || errOut.truncated,
        ...extra
      });
    };

    // Wall-clock guard: on expiry, terminate the child and force-remove the
    // container so partial state is discarded, then resolve as timed out.
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore — process may already be gone
      }
      forceRemoveContainer(containerName);
      finalize({ exitCode: null, timedOut: true });
    }, EXEC_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      // Docker binary missing / not on PATH (ENOENT) or failed to spawn:
      // resolve as unavailable rather than rejecting.
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: '',
        exitCode: null,
        truncated: false,
        dockerUnavailable: true,
        error: `Docker unavailable: ${err instanceof Error ? err.message : String(err)}`
      });
    });

    child.on('close', (code) => {
      if (timedOut) return; // already finalized by the timeout path
      finalize({ exitCode: code });
    });
  });
}

/**
 * List recent sandbox run records from the sandbox root.
 *
 * Enumerates the per-run subdirectories created by `runSandboxedPython` under
 * `getSandboxRoot()`, returning them most-recent-first (ordered by directory
 * mtime) with the mtime exposed as an ISO `startedAt` timestamp. A missing
 * sandbox root is treated as "no runs yet" and yields an empty list rather than
 * an error. An optional `limit` caps the number of records returned; non-finite
 * or non-positive limits are ignored (all runs returned).
 *
 * @param {number} [limit]
 * @returns {{ runs: Array<{ runId: string, startedAt: string }> }}
 */
export function listSandboxRuns(limit) {
  const sandboxRoot = getSandboxRoot();

  let entries;
  try {
    entries = fs.readdirSync(sandboxRoot, { withFileTypes: true });
  } catch (err) {
    // Missing sandbox root (nothing has run yet) is not an error.
    if (err && err.code === 'ENOENT') return { runs: [] };
    throw err;
  }

  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    let stats;
    try {
      stats = fs.statSync(resolveInsideRoot(sandboxRoot, runId));
    } catch {
      // Directory vanished between readdir and stat, or is otherwise
      // unreadable — skip it rather than failing the whole listing.
      continue;
    }
    runs.push({ runId, startedAt: stats.mtime.toISOString(), _mtimeMs: stats.mtimeMs });
  }

  // Most recent first.
  runs.sort((a, b) => b._mtimeMs - a._mtimeMs);

  const numericLimit = Number(limit);
  const bounded =
    Number.isFinite(numericLimit) && numericLimit > 0
      ? runs.slice(0, Math.floor(numericLimit))
      : runs;

  return { runs: bounded.map(({ runId, startedAt }) => ({ runId, startedAt })) };
}

/**
 * Read an artifact produced by a previous sandbox run.
 *
 * Both `runId` and `fileName` are resolved with `resolveInsideRoot` so neither
 * can escape confinement: the run directory is confined to the sandbox root and
 * the artifact is confined to that run directory. Path-traversal attempts throw
 * (via `resolveInsideRoot`) rather than reading outside the sandbox.
 *
 * @param {string} runId
 * @param {string} fileName
 * @returns {{ runId: string, fileName: string, content: string }}
 */
export function readRunArtifact(runId, fileName) {
  const sandboxRoot = getSandboxRoot();
  const runDir = resolveInsideRoot(sandboxRoot, runId);
  const artifactPath = resolveInsideRoot(runDir, fileName);
  const content = fs.readFileSync(artifactPath, 'utf8');
  return { runId, fileName, content };
}

// Referenced by later subtasks; kept imported to preserve the security helper
// surface this module depends on without triggering unused-import churn.
export const __securityHelpers = { clampNumber, ensureDir, getSandboxRoot, hasBlockedPythonPattern, resolveInsideRoot };
