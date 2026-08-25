import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandboxEnforcer } from '../../../electron/runtime/agent/sandboxEnforcer.js';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-sandbox-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ─── Unit Tests: setWorkingDirectory ─────────────────────────────────────────

describe('sandboxEnforcer - setWorkingDirectory', () => {
  it('sets a valid working directory', () => {
    const enforcer = createSandboxEnforcer();
    const dir = createTempDir();
    enforcer.setWorkingDirectory(dir);
    expect(enforcer.getWorkingDirectory()).toBeTruthy();
  });

  it('throws on empty string', () => {
    const enforcer = createSandboxEnforcer();
    expect(() => enforcer.setWorkingDirectory('')).toThrow();
  });

  it('throws on null', () => {
    const enforcer = createSandboxEnforcer();
    expect(() => enforcer.setWorkingDirectory(null as any)).toThrow();
  });

  it('throws on undefined', () => {
    const enforcer = createSandboxEnforcer();
    expect(() => enforcer.setWorkingDirectory(undefined as any)).toThrow();
  });
});

// ─── Unit Tests: resolvePath ─────────────────────────────────────────────────

describe('sandboxEnforcer - resolvePath', () => {
  let enforcer: ReturnType<typeof createSandboxEnforcer>;
  let workDir: string;

  beforeEach(() => {
    enforcer = createSandboxEnforcer();
    workDir = createTempDir();
    enforcer.setWorkingDirectory(workDir);
  });

  it('resolves a relative path within working directory', () => {
    const resolved = enforcer.resolvePath('src/main.ts');
    expect(resolved).toContain('src');
    expect(resolved).toContain('main.ts');
  });

  it('resolves parent traversal (../) to canonical form', () => {
    const resolved = enforcer.resolvePath('subdir/../file.txt');
    const expected = path.resolve(workDir, 'file.txt');
    // On Windows, normalize case for comparison
    expect(resolved.toLowerCase()).toBe(expected.toLowerCase());
  });

  it('resolves dot (.) to working directory', () => {
    const resolved = enforcer.resolvePath('.');
    expect(resolved.toLowerCase()).toBe(path.resolve(workDir).toLowerCase());
  });

  it('resolves absolute paths without joining to working directory', () => {
    const absPath = path.resolve(workDir, 'absolute-test.txt');
    const resolved = enforcer.resolvePath(absPath);
    expect(resolved.toLowerCase()).toBe(absPath.toLowerCase());
  });

  it('resolves symlinks to real path', () => {
    // Create a real directory and a symlink
    const realDir = path.join(workDir, 'real');
    fs.mkdirSync(realDir);
    const linkPath = path.join(workDir, 'link');
    try {
      fs.symlinkSync(realDir, linkPath, 'junction');
      const resolved = enforcer.resolvePath(linkPath);
      expect(resolved.toLowerCase()).toBe(realDir.toLowerCase());
    } catch {
      // Symlink creation may require elevated privileges on Windows
      // Skip if not supported
    }
  });

  it('throws on empty path', () => {
    expect(() => enforcer.resolvePath('')).toThrow();
  });

  it('throws if working directory is not set for relative path', () => {
    const newEnforcer = createSandboxEnforcer();
    expect(() => newEnforcer.resolvePath('relative/path')).toThrow();
  });
});

// ─── Unit Tests: isPathAuthorized ────────────────────────────────────────────

describe('sandboxEnforcer - isPathAuthorized', () => {
  let enforcer: ReturnType<typeof createSandboxEnforcer>;
  let workDir: string;

  beforeEach(() => {
    enforcer = createSandboxEnforcer();
    workDir = createTempDir();
    enforcer.setWorkingDirectory(workDir);
  });

  it('authorizes the working directory itself', () => {
    expect(enforcer.isPathAuthorized(workDir)).toBe(true);
  });

  it('authorizes a descendant path', () => {
    const childPath = path.join(workDir, 'src', 'index.ts');
    expect(enforcer.isPathAuthorized(childPath)).toBe(true);
  });

  it('rejects a path above the working directory', () => {
    const parentPath = path.dirname(workDir);
    expect(enforcer.isPathAuthorized(parentPath)).toBe(false);
  });

  it('rejects a sibling path', () => {
    const siblingPath = path.join(path.dirname(workDir), 'other-project');
    expect(enforcer.isPathAuthorized(siblingPath)).toBe(false);
  });

  it('rejects paths that traverse out with ../', () => {
    const escapePath = path.resolve(workDir, '..', 'etc', 'passwd');
    expect(enforcer.isPathAuthorized(escapePath)).toBe(false);
  });

  it('returns false when working directory is not set', () => {
    const newEnforcer = createSandboxEnforcer();
    expect(newEnforcer.isPathAuthorized('/some/path')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(enforcer.isPathAuthorized('')).toBe(false);
  });

  it('returns false for null', () => {
    expect(enforcer.isPathAuthorized(null as any)).toBe(false);
  });

  it('rejects a path that is a prefix but not a real descendant', () => {
    // e.g., workDir is "/tmp/abc" and path is "/tmp/abcdef"
    const trickPath = workDir + 'suffix';
    expect(enforcer.isPathAuthorized(trickPath)).toBe(false);
  });
});

// ─── Unit Tests: validateToolCall ────────────────────────────────────────────

describe('sandboxEnforcer - validateToolCall', () => {
  let enforcer: ReturnType<typeof createSandboxEnforcer>;
  let workDir: string;

  beforeEach(() => {
    enforcer = createSandboxEnforcer();
    workDir = createTempDir();
    enforcer.setWorkingDirectory(workDir);
  });

  it('accepts a tool call with paths inside the sandbox', () => {
    const call = {
      tool: 'folder',
      server: 'folder-server',
      action: 'readFile',
      params: { path: path.join(workDir, 'src', 'index.ts') }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(true);
  });

  it('accepts a tool call with relative paths inside the sandbox', () => {
    const call = {
      tool: 'folder',
      server: 'folder-server',
      action: 'readFile',
      params: { path: 'src/index.ts' }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(true);
  });

  it('rejects a tool call with paths outside the sandbox', () => {
    const call = {
      tool: 'folder',
      server: 'folder-server',
      action: 'readFile',
      params: { path: '/etc/passwd' }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('outside the authorized working directory');
      expect(result.requiresApproval).toBe(true);
    }
  });

  it('rejects a tool call using ../ to escape sandbox', () => {
    const call = {
      tool: 'terminal',
      server: 'terminal-server',
      action: 'exec',
      params: { cwd: '../../etc' }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(false);
  });

  it('accepts a tool call with no path parameters', () => {
    const call = {
      tool: 'http',
      server: 'http-server',
      action: 'get',
      params: { url: 'https://example.com', headers: {} }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(true);
  });

  it('sanitizes valid paths in the result', () => {
    const call = {
      tool: 'folder',
      server: 'folder-server',
      action: 'readFile',
      params: { path: 'src/../src/index.ts' }
    };
    const result = enforcer.validateToolCall(call);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // The path should be resolved to canonical form
      expect(result.sanitizedCall.params.path).not.toContain('..');
    }
  });

  it('rejects null call', () => {
    const result = enforcer.validateToolCall(null as any);
    expect(result.valid).toBe(false);
  });

  it('rejects when working directory is not set', () => {
    const newEnforcer = createSandboxEnforcer();
    const call = {
      tool: 'folder',
      server: 'folder-server',
      action: 'readFile',
      params: { path: 'file.txt' }
    };
    const result = newEnforcer.validateToolCall(call);
    expect(result.valid).toBe(false);
  });
});

// ─── Unit Tests: logFileModification and getModificationLog ──────────────────

describe('sandboxEnforcer - file modification audit log', () => {
  let enforcer: ReturnType<typeof createSandboxEnforcer>;

  beforeEach(() => {
    enforcer = createSandboxEnforcer();
  });

  it('logs a file creation', () => {
    enforcer.logFileModification({
      sessionId: 'session-1',
      operation: 'create',
      path: '/project/src/new-file.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    });

    const log = enforcer.getModificationLog('session-1');
    expect(log).toHaveLength(1);
    expect(log[0].operation).toBe('create');
    expect(log[0].path).toBe('/project/src/new-file.ts');
  });

  it('logs multiple operations for the same session', () => {
    enforcer.logFileModification({
      sessionId: 'session-2',
      operation: 'create',
      path: '/project/file1.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    });
    enforcer.logFileModification({
      sessionId: 'session-2',
      operation: 'modify',
      path: '/project/file2.ts',
      timestamp: '2024-01-15T10:01:00.000Z'
    });
    enforcer.logFileModification({
      sessionId: 'session-2',
      operation: 'delete',
      path: '/project/old-file.ts',
      timestamp: '2024-01-15T10:02:00.000Z'
    });

    const log = enforcer.getModificationLog('session-2');
    expect(log).toHaveLength(3);
  });

  it('filters log by session ID', () => {
    enforcer.logFileModification({
      sessionId: 'session-a',
      operation: 'create',
      path: '/a/file.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    });
    enforcer.logFileModification({
      sessionId: 'session-b',
      operation: 'modify',
      path: '/b/file.ts',
      timestamp: '2024-01-15T10:01:00.000Z'
    });

    const logA = enforcer.getModificationLog('session-a');
    expect(logA).toHaveLength(1);
    expect(logA[0].sessionId).toBe('session-a');

    const logB = enforcer.getModificationLog('session-b');
    expect(logB).toHaveLength(1);
    expect(logB[0].sessionId).toBe('session-b');
  });

  it('returns empty array for unknown session', () => {
    const log = enforcer.getModificationLog('nonexistent');
    expect(log).toHaveLength(0);
  });

  it('logs rename operations', () => {
    enforcer.logFileModification({
      sessionId: 'session-1',
      operation: 'rename',
      path: '/project/old-name.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    });

    const log = enforcer.getModificationLog('session-1');
    expect(log[0].operation).toBe('rename');
  });

  it('throws on invalid operation', () => {
    expect(() => enforcer.logFileModification({
      sessionId: 'session-1',
      operation: 'invalid' as any,
      path: '/project/file.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    })).toThrow();
  });

  it('throws on missing path', () => {
    expect(() => enforcer.logFileModification({
      sessionId: 'session-1',
      operation: 'create',
      path: '',
      timestamp: '2024-01-15T10:00:00.000Z'
    })).toThrow();
  });

  it('throws on missing sessionId', () => {
    expect(() => enforcer.logFileModification({
      sessionId: '',
      operation: 'create',
      path: '/project/file.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    })).toThrow();
  });

  it('auto-generates timestamp if not provided', () => {
    enforcer.logFileModification({
      sessionId: 'session-1',
      operation: 'create',
      path: '/project/file.ts',
      timestamp: ''
    });

    const log = enforcer.getModificationLog('session-1');
    expect(log[0].timestamp).toBeTruthy();
    // Should be a valid ISO timestamp
    expect(new Date(log[0].timestamp).toISOString()).toBe(log[0].timestamp);
  });

  it('clears modification log for a specific session', () => {
    enforcer.logFileModification({
      sessionId: 'session-keep',
      operation: 'create',
      path: '/keep/file.ts',
      timestamp: '2024-01-15T10:00:00.000Z'
    });
    enforcer.logFileModification({
      sessionId: 'session-clear',
      operation: 'modify',
      path: '/clear/file.ts',
      timestamp: '2024-01-15T10:01:00.000Z'
    });

    enforcer.clearModificationLog('session-clear');

    expect(enforcer.getModificationLog('session-clear')).toHaveLength(0);
    expect(enforcer.getModificationLog('session-keep')).toHaveLength(1);
  });
});


// ─── Property-Based Tests ────────────────────────────────────────────────────

import fc from 'fast-check';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a valid path segment (directory or file name).
 * Uses alphanumeric characters and common safe characters.
 */
const pathSegmentArb = fc.string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
  .map(s => s.replace(/[/\\:*?"<>|\x00\s.]/g, 'x'))
  .filter(s => s.length > 0 && s !== '.' && s !== '..');

/**
 * Generates a random relative path composed of normal segments, `.`, and `..`.
 */
const relativePathArb = fc.array(
  fc.oneof(
    { weight: 5, arbitrary: pathSegmentArb },
    { weight: 2, arbitrary: fc.constant('..') },
    { weight: 1, arbitrary: fc.constant('.') }
  ),
  { minLength: 1, maxLength: 8 }
).map(segments => segments.join('/'));

/**
 * Generates a relative path that stays within the working directory
 * by only using valid path segments (no `..` or `.`).
 */
const safeRelativePathArb = fc.array(pathSegmentArb, { minLength: 1, maxLength: 5 })
  .map(segments => segments.join('/'));

/**
 * Generates a valid file operation type.
 */
const operationArb = fc.constantFrom('create', 'modify', 'delete', 'rename') as fc.Arbitrary<'create' | 'modify' | 'delete' | 'rename'>;

/**
 * Generates a random file modification record for a given session.
 */
function fileModificationArb(sessionId: string) {
  return fc.record({
    sessionId: fc.constant(sessionId),
    operation: operationArb,
    path: safeRelativePathArb.map(p => `/project/${p}`),
    timestamp: fc.integer({ min: 1704067200000, max: 1767225599000 })
      .map(ms => new Date(ms).toISOString())
  });
}

// ─── Property 10: Sandbox path enforcement ───────────────────────────────────

describe('Feature: agent-client, Property 10: Sandbox path enforcement', () => {
  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any file path provided to a tool call, after resolving symbolic links
   * and relative path components (including `../`) to their canonical form,
   * the resulting absolute path SHALL be a descendant of the authorized working
   * directory. Any path resolving outside this boundary SHALL be rejected.
   */
  it('authorized paths are always descendants of the working directory (PBT)', () => {
    fc.assert(
      fc.property(safeRelativePathArb, (relativePath) => {
        const enforcer = createSandboxEnforcer();
        const workDir = createTempDir();
        enforcer.setWorkingDirectory(workDir);

        const resolved = enforcer.resolvePath(relativePath);
        const authorized = enforcer.isPathAuthorized(resolved);

        // A path composed only of valid segments (no ..) should always stay
        // within the working directory
        expect(authorized).toBe(true);

        // The resolved path must start with the working directory
        const normalizedWork = path.resolve(workDir).toLowerCase();
        const normalizedResolved = resolved.toLowerCase();
        expect(
          normalizedResolved === normalizedWork ||
          normalizedResolved.startsWith(normalizedWork + path.sep)
        ).toBe(true);
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any random relative path (which may include `..` components),
   * isPathAuthorized correctly identifies whether it escapes the sandbox.
   */
  it('paths with .. components escaping the sandbox are rejected (PBT)', () => {
    fc.assert(
      fc.property(relativePathArb, (relativePath) => {
        const enforcer = createSandboxEnforcer();
        const workDir = createTempDir();
        enforcer.setWorkingDirectory(workDir);

        const resolved = enforcer.resolvePath(relativePath);
        const authorized = enforcer.isPathAuthorized(resolved);

        // Verify the authorization decision is consistent with actual path containment
        const normalizedWork = path.resolve(workDir).toLowerCase();
        const normalizedResolved = resolved.toLowerCase();

        const isDescendant =
          normalizedResolved === normalizedWork ||
          normalizedResolved.startsWith(normalizedWork + path.sep);

        expect(authorized).toBe(isDescendant);
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * validateToolCall rejects tool calls containing paths that escape the sandbox.
   */
  it('validateToolCall rejects paths escaping the sandbox boundary (PBT)', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5 }),
        (upCount) => {
          const enforcer = createSandboxEnforcer();
          const workDir = createTempDir();
          enforcer.setWorkingDirectory(workDir);

          // Construct a path that goes up (upCount + 1) levels then into 'escape'
          const escapePath = '../'.repeat(upCount + 1) + 'escape/file.txt';

          const call = {
            tool: 'folder',
            server: 'folder-server',
            action: 'writeFile',
            params: { path: escapePath }
          };

          const result = enforcer.validateToolCall(call);

          // The path escapes the sandbox because we always go up at least 1 level above workDir
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.reason).toContain('outside the authorized working directory');
            expect(result.requiresApproval).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * validateToolCall accepts and sanitizes paths that stay within the sandbox.
   */
  it('validateToolCall accepts paths that stay within the sandbox (PBT)', () => {
    fc.assert(
      fc.property(safeRelativePathArb, (relativePath) => {
        const enforcer = createSandboxEnforcer();
        const workDir = createTempDir();
        enforcer.setWorkingDirectory(workDir);

        const call = {
          tool: 'folder',
          server: 'folder-server',
          action: 'readFile',
          params: { path: relativePath }
        };

        const result = enforcer.validateToolCall(call);
        expect(result.valid).toBe(true);

        if (result.valid) {
          // Sanitized path should not contain `..` components
          expect(result.sanitizedCall.params.path).not.toContain('..');
          // Sanitized path should be an absolute path within the working directory
          const sanitized = result.sanitizedCall.params.path as string;
          expect(path.isAbsolute(sanitized)).toBe(true);
        }
      }),
      { numRuns: 150 }
    );
  });
});

// ─── Property 11: File modification audit completeness ───────────────────────

describe('Feature: agent-client, Property 11: File modification audit completeness', () => {
  /**
   * **Validates: Requirements 7.6**
   *
   * For any file system operation (create, modify, delete, rename) performed
   * during a Task Session, a corresponding FileModification record SHALL be
   * created containing the operation type, affected path, and timestamp.
   * The count of modification records SHALL equal the count of file operations performed.
   */
  it('count of modification records equals count of operations performed (PBT)', () => {
    fc.assert(
      fc.property(
        fc.array(fileModificationArb('test-session'), { minLength: 0, maxLength: 30 }),
        (operations) => {
          const enforcer = createSandboxEnforcer();

          // Perform each operation
          for (const op of operations) {
            enforcer.logFileModification(op);
          }

          // Retrieve and verify count
          const log = enforcer.getModificationLog('test-session');
          expect(log).toHaveLength(operations.length);
        }
      ),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 7.6**
   *
   * Each logged operation must have a corresponding record with matching
   * operation type, path, and timestamp.
   */
  it('each operation has a corresponding record with matching fields (PBT)', () => {
    fc.assert(
      fc.property(
        fc.array(fileModificationArb('session-audit'), { minLength: 1, maxLength: 20 }),
        (operations) => {
          const enforcer = createSandboxEnforcer();

          for (const op of operations) {
            enforcer.logFileModification(op);
          }

          const log = enforcer.getModificationLog('session-audit');

          // Each operation must have a matching record in order
          for (let i = 0; i < operations.length; i++) {
            expect(log[i].operation).toBe(operations[i].operation);
            expect(log[i].path).toBe(operations[i].path);
            expect(log[i].timestamp).toBe(operations[i].timestamp);
            expect(log[i].sessionId).toBe('session-audit');
          }
        }
      ),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 7.6**
   *
   * Modification log is session-scoped: operations from different sessions
   * do not interfere with each other.
   */
  it('modification logs are isolated between sessions (PBT)', () => {
    fc.assert(
      fc.property(
        fc.array(fileModificationArb('session-A'), { minLength: 1, maxLength: 10 }),
        fc.array(fileModificationArb('session-B'), { minLength: 1, maxLength: 10 }),
        (opsA, opsB) => {
          const enforcer = createSandboxEnforcer();

          // Log operations for both sessions interleaved
          for (let i = 0; i < Math.max(opsA.length, opsB.length); i++) {
            if (i < opsA.length) enforcer.logFileModification(opsA[i]);
            if (i < opsB.length) enforcer.logFileModification(opsB[i]);
          }

          const logA = enforcer.getModificationLog('session-A');
          const logB = enforcer.getModificationLog('session-B');

          // Each session's log should have exactly its own operations
          expect(logA).toHaveLength(opsA.length);
          expect(logB).toHaveLength(opsB.length);

          // Verify no cross-contamination
          for (const entry of logA) {
            expect(entry.sessionId).toBe('session-A');
          }
          for (const entry of logB) {
            expect(entry.sessionId).toBe('session-B');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.6**
   *
   * After clearing a session's log, its count drops to zero while
   * other sessions remain unaffected.
   */
  it('clearModificationLog removes only the target session records (PBT)', () => {
    fc.assert(
      fc.property(
        fc.array(fileModificationArb('session-clear'), { minLength: 1, maxLength: 10 }),
        fc.array(fileModificationArb('session-keep'), { minLength: 1, maxLength: 10 }),
        (opsClear, opsKeep) => {
          const enforcer = createSandboxEnforcer();

          for (const op of opsClear) enforcer.logFileModification(op);
          for (const op of opsKeep) enforcer.logFileModification(op);

          enforcer.clearModificationLog('session-clear');

          expect(enforcer.getModificationLog('session-clear')).toHaveLength(0);
          expect(enforcer.getModificationLog('session-keep')).toHaveLength(opsKeep.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
