/**
 * MCP Tools Wiring — Sanitized error record property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that a rejecting or throwing dispatch yields a
 * record with `status` equal to `error` and a non-null error message that is
 * free of stack-trace frames and internal absolute file paths.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category present in TOOL_SERVER_MAP so the tool call resolves to a
 * mapped server without an explicit override, reaching the gateway call.
 */
const categoryArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

/** A non-empty action string, matching how the dispatcher builds a request. */
const actionArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

/** Arbitrary params object passed through to the gateway payload. */
const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

/** A short human-readable reason forming the "clean" part of an error message. */
const reasonArb = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0);

/**
 * A Windows absolute path (drive-letter), a UNC path, or a POSIX absolute path.
 * These represent internal file locations that MUST NOT leak into the record.
 */
const absolutePathArb = fc.oneof(
  fc
    .array(fc.constantFrom('Users', 'spakb', 'Development', 'Ollama-Plus', 'electron', 'runtime'), {
      minLength: 1,
      maxLength: 4
    })
    .map((segs) => `C:\\${segs.join('\\')}\\toolDispatcher.js`),
  fc
    .array(fc.constantFrom('server', 'share', 'internal', 'mcp'), { minLength: 2, maxLength: 4 })
    .map((segs) => `\\\\${segs.join('\\')}`),
  fc
    .array(fc.constantFrom('usr', 'local', 'lib', 'node_modules', 'app', 'src'), {
      minLength: 1,
      maxLength: 4
    })
    .map((segs) => `/${segs.join('/')}/gateway.mjs`)
);

/**
 * A synthetic stack-trace block: a message line followed by one or more
 * `    at fn (path:line:col)` frames carrying absolute paths.
 */
function buildStack(reason: string, framePath: string, frameCount: number): string {
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(`    at handler${i} (${framePath}:${10 + i}:${5 + i})`);
  }
  return [`Error: ${reason}`, ...frames].join('\n');
}

/**
 * Builds an Error whose `message` embeds a stack-trace block and absolute
 * paths — the exact kind of internal detail the sanitizer must strip. The
 * native `.stack` is also populated (and always carries frames), but the
 * dispatcher only surfaces `.message`, so we deliberately poison the message.
 */
const dirtyErrorArb = fc
  .record({
    reason: reasonArb,
    framePath: absolutePathArb,
    extraPath: absolutePathArb,
    frameCount: fc.integer({ min: 1, max: 4 })
  })
  .map(({ reason, framePath, extraPath, frameCount }) => {
    const message = `${buildStack(reason, framePath, frameCount)}\nSee ${extraPath} for details.`;
    return new Error(message);
  });

// ─── Detectors ───────────────────────────────────────────────────────────────

/** True if the text contains a stack-trace frame line ("at " token). */
function hasStackFrame(text: string): boolean {
  return text.split(/\r?\n/).some((line) => /^\s*at\s+/.test(line));
}

/** True if the text contains an internal absolute file path. */
function hasAbsolutePath(text: string): boolean {
  // Windows drive-letter path, UNC path, or POSIX absolute path.
  return (
    /[A-Za-z]:[\\/]/.test(text) ||
    /\\\\[^\s]/.test(text) ||
    /(?<![\w.])\/[^\s"')]+/.test(text)
  );
}

// Feature: mcp-tools-wiring, Property 13: Sanitized error record
describe('Feature: mcp-tools-wiring, Property 13: Sanitized error record', () => {
  /**
   * **Validates: Requirements 8.3, 8.5, 9.3**
   *
   * For any dispatch in which the gateway call rejects or the route handler
   * throws, the dispatcher SHALL return a record with `status` equal to
   * `error` and a non-null error message, and that message SHALL exclude
   * stack-trace frames and internal absolute file paths.
   */
  it('a rejecting or throwing dispatch yields a status:error record with a sanitized message (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        categoryArb,
        actionArb,
        paramsArb,
        dirtyErrorArb,
        fc.boolean(),
        async (tool, action, params, error, throwSynchronously) => {
          // A gateway that either throws synchronously or returns a rejected
          // promise — both surface through the dispatcher's try/catch.
          const mcpGateway = throwSynchronously
            ? () => {
                throw error;
              }
            : () => Promise.reject(error);

          const dispatcher = createToolDispatcher({ mcpGateway });

          const record = await dispatcher.dispatch({ tool, action, params });

          // The outcome maps to an error record (not success, not timeout).
          expect(record.status).toBe('error');

          // The error message is a non-null, non-empty string.
          expect(typeof record.error).toBe('string');
          expect((record.error as string).length).toBeGreaterThan(0);

          // The message is free of stack-trace frames and absolute paths.
          expect(hasStackFrame(record.error as string)).toBe(false);
          expect(hasAbsolutePath(record.error as string)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
