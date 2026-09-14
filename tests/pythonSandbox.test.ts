/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Mock-based unit tests for the Docker-unavailable and execution-timeout paths
 * of runSandboxedPython (mcp/lib/pythonSandbox.mjs).
 *
 * Feature: mcp-tools-wiring, Task 1.8
 * Validates: Requirements 10.4 (Docker unavailable resolves with an error result
 * rather than rejecting) and 10.5 (a 30s execution timeout terminates the
 * container via `docker rm -f` and returns an execution-timeout error).
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock the Docker layer (child_process.spawn) ─────────────────────────────

// Records every spawn invocation so the tests can assert on the argument vectors
// (e.g. that `docker rm -f <name>` was issued during timeout teardown).
type SpawnCall = { command: string; args: string[] };
const spawnCalls: SpawnCall[] = [];

// The next child process spawn should produce. Tests push factories here to
// control per-invocation behavior (emit `error` for unavailable, stay silent
// for the run child so the wall-clock timer fires, etc.).
type ChildFactory = () => FakeChild;
const childQueue: ChildFactory[] = [];

/**
 * Minimal stand-in for a ChildProcess: an EventEmitter with stdout/stderr
 * emitters and a spy `kill`. Sufficient for the event-driven code paths in
 * runDockerContainer / forceRemoveContainer.
 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

vi.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    const factory = childQueue.shift();
    const child = factory ? factory() : new FakeChild();
    return child;
  }
}));

// Import AFTER the mock is registered so the module binds to the mocked spawn.
const { runSandboxedPython, EXEC_TIMEOUT_MS } = await import(
  '../mcp/lib/pythonSandbox.mjs'
);

// ─── Sandbox root isolation ──────────────────────────────────────────────────

let sandboxRoot: string;
const originalRoot = process.env.MCP_PY_SANDBOX_ROOT;

beforeEach(() => {
  spawnCalls.length = 0;
  childQueue.length = 0;
  sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-py-sandbox-'));
  process.env.MCP_PY_SANDBOX_ROOT = sandboxRoot;
});

afterEach(() => {
  vi.useRealTimers();
  if (originalRoot === undefined) {
    delete process.env.MCP_PY_SANDBOX_ROOT;
  } else {
    process.env.MCP_PY_SANDBOX_ROOT = originalRoot;
  }
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

// ─── Requirement 10.4: Docker unavailable resolves, never rejects ────────────

describe('runSandboxedPython — Docker unavailable', () => {
  it('resolves with a Docker-unavailable error result instead of rejecting', async () => {
    // The run child emits an `error` event (ENOENT: docker not on PATH).
    childQueue.push(() => {
      const child = new FakeChild();
      queueMicrotask(() => {
        const err = Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
        child.emit('error', err);
      });
      return child;
    });

    const result = await runSandboxedPython({ code: 'print("hi")' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/docker unavailable/i);
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.truncated).toBe(false);
    // A runId is still assigned for the (rejected) attempt.
    expect(typeof result.runId).toBe('string');
  });
});

// ─── Requirement 10.5: execution timeout forces container removal ────────────

describe('runSandboxedPython — execution timeout', () => {
  it('force-removes the container (docker rm -f) and returns an exec-timeout error', async () => {
    vi.useFakeTimers();

    // The run child never emits `close`, so the wall-clock EXEC_TIMEOUT_MS guard
    // fires. The subsequent `docker rm -f` teardown spawn gets its own child.
    const runChild = new FakeChild();
    childQueue.push(() => runChild); // docker run (hangs — never emits close)
    childQueue.push(() => new FakeChild()); // docker rm -f (teardown)

    const promise = runSandboxedPython({ code: 'while True: pass' });

    // Let the synchronous setup (dir prep, spawn) and any microtasks settle,
    // then advance the wall clock past the execution timeout.
    await vi.advanceTimersByTimeAsync(EXEC_TIMEOUT_MS + 1);

    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.error).toContain(String(EXEC_TIMEOUT_MS));
    expect(result.exitCode).toBeNull();

    // The container run was launched...
    const runCall = spawnCalls.find(
      (c) => c.command === 'docker' && c.args[0] === 'run'
    );
    expect(runCall).toBeDefined();

    // ...and then force-removed by name via `docker rm -f <containerName>`.
    const rmCall = spawnCalls.find(
      (c) => c.command === 'docker' && c.args[0] === 'rm' && c.args[1] === '-f'
    );
    expect(rmCall).toBeDefined();
    expect(rmCall?.args[2]).toMatch(/^ollama-plus-sandbox-/);

    // The hanging run child was killed as part of teardown.
    expect(runChild.kill).toHaveBeenCalled();
  });
});
