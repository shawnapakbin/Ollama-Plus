// Feature: mcp-tools-wiring, Property 19: Blocked-pattern rejection
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

// Spy on the Docker execution layer (child_process.spawn). Blocked-pattern
// rejection must happen BEFORE any container is executed, so this spy must
// never be invoked for blocked code that is not explicitly approved.
const spawnSpy = vi.fn(() => {
  throw new Error('spawn must not be called for blocked-pattern rejection');
});

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args)
}));
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnSpy(...args)
}));

import { runSandboxedPython } from '../mcp/lib/pythonSandbox.mjs';
import { hasBlockedPythonPattern } from '../mcp/lib/security.mjs';

/**
 * Property 19: Blocked-pattern rejection
 *
 * For any Python code that matches a blocked pattern (per
 * `hasBlockedPythonPattern`) submitted without `approveUnsafe === true`,
 * `runSandboxedPython` SHALL:
 *   - resolve to a failure result of the form `{ ok: false, error }`,
 *   - execute NO Docker container (the Docker layer / `spawn` is never invoked), and
 *   - create NO run record or artifact under the sandbox root.
 *
 * Validates: Requirements 3.6
 */

// ─── Sandbox root isolation ──────────────────────────────────────────────────
// Point the sandbox root at a fresh temp directory per test so we can assert
// that a blocked-pattern rejection leaves NO run record/artifact behind.

let sandboxRoot: string;
let savedSandboxRoot: string | undefined;

beforeEach(() => {
  savedSandboxRoot = process.env.MCP_PY_SANDBOX_ROOT;
  sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-blocked-'));
  process.env.MCP_PY_SANDBOX_ROOT = sandboxRoot;
  spawnSpy.mockClear();
});

afterEach(() => {
  if (savedSandboxRoot === undefined) {
    delete process.env.MCP_PY_SANDBOX_ROOT;
  } else {
    process.env.MCP_PY_SANDBOX_ROOT = savedSandboxRoot;
  }
  try {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function sandboxRootEntries(): string[] {
  try {
    return fs.readdirSync(sandboxRoot);
  } catch {
    // Missing root means nothing was ever written — no run record/artifact.
    return [];
  }
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Snippets that each match one of the blocked patterns in security.mjs.
const blockedSnippet = fc.constantFrom(
  'import subprocess',
  'subprocess.run(["ls"])',
  'import socket',
  's = socket.socket()',
  'import ctypes',
  'os.system("ls")',
  'eval("1+1")',
  'exec("x = 1")',
  '__import__("os")',
  'import requests',
  'requests.get("http://example.com")',
  'import urllib',
  'urllib.request.urlopen("http://example.com")'
);

// Benign surrounding lines that never match a blocked pattern.
const benignLine = fc.constantFrom(
  'x = 1',
  'print("hello")',
  'y = [i for i in range(10)]',
  '# a comment',
  'def f():\n    return 42',
  ''
);

// Compose code that embeds at least one blocked snippet amongst benign lines.
const blockedCode = fc
  .tuple(
    fc.array(benignLine, { maxLength: 4 }),
    blockedSnippet,
    fc.array(benignLine, { maxLength: 4 })
  )
  .map(([before, blocked, after]) => [...before, blocked, ...after].join('\n'))
  .filter((code) => hasBlockedPythonPattern(code));

// ─── Test ────────────────────────────────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 19: Blocked-pattern rejection', () => {
  it('rejects blocked-pattern code with a failure result, no container run, and no run record', async () => {
    await fc.assert(
      fc.asyncProperty(blockedCode, async (code) => {
        spawnSpy.mockClear();
        const before = sandboxRootEntries();

        const result = await runSandboxedPython({ code });

        // Failure result of the form { ok: false, error }.
        expect(result.ok).toBe(false);
        expect(typeof result.error).toBe('string');
        expect(result.error && result.error.length).toBeGreaterThan(0);

        // No container was executed — the Docker layer was never invoked.
        expect(spawnSpy).not.toHaveBeenCalled();

        // No run record / artifact was created under the sandbox root.
        const after = sandboxRootEntries();
        expect(after).toEqual(before);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects representative blocked snippets even when timeoutSec is supplied', async () => {
    for (const code of ['import subprocess', 'os.system("rm -rf /")', 'eval("2+2")']) {
      spawnSpy.mockClear();
      const result = await runSandboxedPython({ code, timeoutSec: 60 });
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(spawnSpy).not.toHaveBeenCalled();
      expect(sandboxRootEntries()).toEqual([]);
    }
  });
});
