// Feature: mcp-tools-wiring, Property 17: Path confinement
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  resolveInsideRoot,
  getTerminalRoot,
  getFileRoot,
  getSandboxRoot
} from '../mcp/lib/security.mjs';

/**
 * Property 17: Path confinement
 *
 * For any relative path that resolves outside its configured root (for example
 * paths containing parent-directory traversal or absolute paths), the confinement
 * resolver (`resolveInsideRoot`) SHALL throw a path-escape error for each of the
 * terminal, folder, and python roots, and no filesystem access to the target
 * SHALL occur.
 *
 * `resolveInsideRoot` is pure path arithmetic: it throws BEFORE any filesystem
 * operation is attempted, so a thrown path-escape error is itself the guarantee
 * that no filesystem access to the escaping target occurred.
 *
 * Validates: Requirements 2.5, 9.5, 9.6
 */

// ─── Root configuration ──────────────────────────────────────────────────────
// Point each configured root at a distinct, resolvable directory so the three
// roots are exercised independently. The directories need not exist on disk;
// `resolveInsideRoot` performs no I/O.

const savedEnv: Record<string, string | undefined> = {};

function saveAndSet(key: string, value: string): void {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeEach(() => {
  const base = path.join(os.tmpdir(), 'ollama-plus-confinement');
  saveAndSet('MCP_TERMINAL_ROOT', path.join(base, 'terminal-root'));
  saveAndSet('MCP_FILE_ROOT', path.join(base, 'file-root'));
  saveAndSet('MCP_PY_SANDBOX_ROOT', path.join(base, 'python-root'));
});

afterEach(() => {
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** A path segment that never itself escapes (no separators, not `..`). */
const safeSegment = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => s.replace(/[\\/\0]/g, '_'))
  .filter((s) => s.length > 0 && s !== '..' && s !== '.');

/** Relative candidates that escape the root via parent-directory traversal. */
const traversalCandidate = fc
  .array(fc.oneof(fc.constant('..'), safeSegment), { minLength: 1, maxLength: 6 })
  .filter((parts) => parts.includes('..'))
  // Ensure the traversal actually climbs above the root: enough `..` to escape.
  .map((parts) => {
    // Prepend an extra `..` so the number of climbs always exceeds descents.
    return ['..', ...parts].join('/');
  });

/** Absolute-path candidates (both POSIX and Windows-style). */
const absoluteCandidate = fc.oneof(
  safeSegment.map((s) => `/${s}`),
  safeSegment.map((s) => `/etc/${s}`),
  safeSegment.map((s) => `C:\\Windows\\${s}`),
  safeSegment.map((s) => `\\\\server\\share\\${s}`)
);

const escapingCandidate = fc.oneof(traversalCandidate, absoluteCandidate);

// ─── Test ────────────────────────────────────────────────────────────────────

describe('Property 17: Path confinement across terminal, folder, and python roots', () => {
  it('throws a path-escape error for escaping candidates against every configured root', () => {
    fc.assert(
      fc.property(escapingCandidate, (candidate) => {
        const roots = [getTerminalRoot(), getFileRoot(), getSandboxRoot()];

        for (const root of roots) {
          // A candidate resolving outside the root must throw. If it does not,
          // confirm it genuinely stayed inside the root (some generated inputs
          // can normalize back inside on certain platforms); otherwise it is a
          // confinement violation.
          let threw = false;
          let resolved: string | undefined;
          try {
            resolved = resolveInsideRoot(root, candidate);
          } catch (err) {
            threw = true;
            expect((err as Error).message).toMatch(/escapes allowed root/i);
          }

          if (!threw) {
            // Not thrown: the only acceptable case is that the resolved path is
            // genuinely still confined within the root.
            const absRoot = path.resolve(root);
            const rel = path.relative(absRoot, resolved as string);
            const stillInside = !rel.startsWith('..') && !path.isAbsolute(rel);
            expect(stillInside).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('throws for explicit traversal and absolute escapes on each root', () => {
    const roots: Array<[string, string]> = [
      ['terminal', getTerminalRoot()],
      ['folder', getFileRoot()],
      ['python', getSandboxRoot()]
    ];
    const escapes = ['../outside.txt', '../../etc/passwd', '/etc/passwd', 'C:\\Windows\\system32'];

    for (const [, root] of roots) {
      for (const candidate of escapes) {
        expect(() => resolveInsideRoot(root, candidate)).toThrow(/escapes allowed root/i);
      }
    }
  });
});
