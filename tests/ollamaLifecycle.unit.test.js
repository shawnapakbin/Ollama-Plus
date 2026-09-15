import { describe, it, expect, vi } from 'vitest';
import { createOllamaLifecycle } from '../electron/runtime/ollamaLifecycle.js';

/**
 * Feature: ollama-lifecycle-management
 * Example-based unit tests for the resolve/start branches (Task 2.6).
 *
 * These cover the process-control decision paths that fall outside the pure
 * property scope: binary resolution across platforms and the start flow's
 * spawn + readiness-poll branches, all exercised through the injected
 * fetch/spawn/clock/fs/which/env seams so no real process, install, or clock
 * is touched.
 *
 * _Requirements: 3.1, 3.2, 3.3, 4.4, 4.5, 4.6_
 */

/**
 * Build a fake spawned child mirroring the shape `startLocalServer` relies on:
 * an `.on(event, cb)` registrar and a no-op `.unref()`. When `emitError` is
 * provided, the child asynchronously emits an 'error' event on the next
 * microtask so the poll loop can observe it (Requirement 4.6, async path).
 *
 * @param {{ emitError?: Error }} [options]
 */
function createFakeChild({ emitError } = {}) {
  const listeners = new Map();
  const child = {
    on(event, cb) {
      listeners.set(event, cb);
      return child;
    },
    unref: vi.fn()
  };
  if (emitError) {
    // Fire on a later microtask so the synchronous spawn call returns first,
    // mirroring Node emitting 'error' (e.g. ENOENT) after spawn() returns.
    queueMicrotask(() => {
      const cb = listeners.get('error');
      if (cb) {
        cb(emitError);
      }
    });
  }
  return child;
}

describe('resolveOllamaBinary', () => {
  it('returns the search-path result when the executable is on the path', () => {
    // Requirement 3.1: search path is checked first; a resolved path wins
    // outright without consulting any default location.
    const fileExistsImpl = vi.fn(() => false);
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => '/usr/bin/ollama',
      fileExistsImpl
    });

    const result = lifecycle.resolveOllamaBinary();

    expect(result).toEqual({ ok: true, path: '/usr/bin/ollama' });
    // A path hit short-circuits before any filesystem probing.
    expect(fileExistsImpl).not.toHaveBeenCalled();
  });

  it('falls back to the Windows default install location when not on the path', () => {
    // Requirement 3.2: on win32, %LOCALAPPDATA%\Programs\Ollama\ollama.exe is
    // the default location, resolved through the fs-existence seam.
    const expectedPath = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
    const lifecycle = createOllamaLifecycle({
      platform: 'win32',
      whichImpl: () => null,
      env: { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
      fileExistsImpl: (candidate) => candidate === expectedPath
    });

    const result = lifecycle.resolveOllamaBinary();

    expect(result).toEqual({ ok: true, path: expectedPath });
  });

  it('falls back to a macOS default install location when not on the path', () => {
    // Requirement 3.2: on darwin, the Homebrew path is one of the defaults; the
    // first existing hit in order wins.
    const lifecycle = createOllamaLifecycle({
      platform: 'darwin',
      whichImpl: () => null,
      fileExistsImpl: (candidate) => candidate === '/opt/homebrew/bin/ollama'
    });

    const result = lifecycle.resolveOllamaBinary();

    expect(result).toEqual({ ok: true, path: '/opt/homebrew/bin/ollama' });
  });

  it('falls back to a Linux default install location when not on the path', () => {
    // Requirement 3.2: on linux, /usr/local/bin and /usr/bin are the defaults.
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => null,
      fileExistsImpl: (candidate) => candidate === '/usr/local/bin/ollama'
    });

    const result = lifecycle.resolveOllamaBinary();

    expect(result).toEqual({ ok: true, path: '/usr/local/bin/ollama' });
  });

  it('returns { ok: false } when neither the path nor any default resolves', () => {
    // Requirement 3.3: unresolved on both the search path and every default
    // location -> { ok: false } so the caller never spawns.
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => null,
      fileExistsImpl: () => false
    });

    expect(lifecycle.resolveOllamaBinary()).toEqual({ ok: false });
  });
});

describe('startLocalServer', () => {
  const LOCAL_ENDPOINT = 'http://127.0.0.1:11434';

  it('returns binary-not-found without spawning when the executable is unresolved', async () => {
    // Requirement 4.6 / 3.3: a local endpoint whose binary cannot be resolved
    // must not spawn and must report 'binary-not-found'.
    const spawnImpl = vi.fn();
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => null,
      fileExistsImpl: () => false,
      spawnImpl,
      fetchImpl: async () => {
        throw new Error('should not probe when binary is missing');
      }
    });

    const result = await lifecycle.startLocalServer({ endpoint: LOCAL_ENDPOINT });

    expect(result).toEqual({ ok: false, reason: 'binary-not-found' });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('returns spawn-failed when spawn throws synchronously', async () => {
    // Requirement 4.6: a synchronous throw from spawn is classified
    // 'spawn-failed' and the error message is surfaced.
    const spawnImpl = vi.fn(() => {
      throw new Error('EACCES: permission denied');
    });
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => '/usr/bin/ollama',
      spawnImpl
    });

    const result = await lifecycle.startLocalServer({ endpoint: LOCAL_ENDPOINT });

    expect(result).toEqual({
      ok: false,
      reason: 'spawn-failed',
      error: 'EACCES: permission denied'
    });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("returns spawn-failed when the child emits an async 'error' event", async () => {
    // Requirement 4.6: an asynchronous 'error' event (e.g. ENOENT surfacing
    // after spawn returns) is terminal and reported as 'spawn-failed' rather
    // than waiting out the readiness deadline.
    const spawnImpl = vi.fn(() =>
      createFakeChild({ emitError: new Error('spawn ollama ENOENT') })
    );
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => '/usr/bin/ollama',
      spawnImpl,
      // The probe would report unreachable, but the async error should win.
      fetchImpl: async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      },
      now: () => 0
    });

    const result = await lifecycle.startLocalServer({
      endpoint: LOCAL_ENDPOINT,
      readinessTimeoutMs: 30000,
      pollIntervalMs: 10
    });

    expect(result).toEqual({
      ok: false,
      reason: 'spawn-failed',
      error: 'spawn ollama ENOENT'
    });
  });

  it('returns { ok: true } when the endpoint becomes reachable before the deadline', async () => {
    // Requirement 4.4: after spawning, polling that observes a reachable
    // endpoint before the deadline classifies the start as successful.
    const spawnImpl = vi.fn(() => createFakeChild());
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      // First probe: server not up yet. Second probe: reachable (HTTP 200).
      if (calls < 2) {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      }
      return { status: 200 };
    });
    // Clock stays before the deadline the whole time so the loop can retry.
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => '/usr/bin/ollama',
      spawnImpl,
      fetchImpl,
      now: () => 0
    });

    const result = await lifecycle.startLocalServer({
      endpoint: LOCAL_ENDPOINT,
      readinessTimeoutMs: 30000,
      pollIntervalMs: 1
    });

    expect(result).toEqual({ ok: true });
    // The server was actually launched before readiness was confirmed.
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns timeout when the endpoint never becomes reachable within the deadline', async () => {
    // Requirement 4.5: an endpoint that never becomes reachable before the
    // readiness deadline is classified 'timeout'. The injected clock jumps past
    // the deadline after the first probe so the loop terminates deterministically.
    const spawnImpl = vi.fn(() => createFakeChild());
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    });
    let clock = 0;
    const nowValues = [0, 100000]; // deadline anchor, then past the 30s bound.
    let idx = 0;
    const now = () => {
      const value = idx < nowValues.length ? nowValues[idx] : clock;
      idx += 1;
      clock = value;
      return value;
    };
    const lifecycle = createOllamaLifecycle({
      platform: 'linux',
      whichImpl: () => '/usr/bin/ollama',
      spawnImpl,
      fetchImpl,
      now
    });

    const result = await lifecycle.startLocalServer({
      endpoint: LOCAL_ENDPOINT,
      readinessTimeoutMs: 30000,
      pollIntervalMs: 1
    });

    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });
});
