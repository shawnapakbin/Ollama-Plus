/**
 * MCP Tools Wiring — Bounded timeout record property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that a dispatch whose gateway call never
 * settles yields a bounded `timeout` record whose non-null error message
 * includes the timeout duration in milliseconds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  DEFAULT_TOOL_TIMEOUTS
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an MCP gateway whose returned promise never settles, forcing the
 * dispatcher's timeout path to fire.
 */
function createNeverSettlingGateway() {
  return () => new Promise<never>(() => {});
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category that has a documented default timeout. The timeout record
 * property must hold for any wired tool category.
 */
const categoryArb = fc.constantFrom(...Object.keys(DEFAULT_TOOL_TIMEOUTS));

/**
 * A positive override timeout value (milliseconds). Kept modest so fake-timer
 * advancement stays fast while still exercising a range of durations.
 */
const timeoutMsArb = fc.integer({ min: 1, max: 300_000 });

/**
 * A non-empty action string, matching how the dispatcher builds a request.
 */
const actionArb = fc.string({ minLength: 1, maxLength: 20 }).map((s) => `a${s}`);

// Feature: mcp-tools-wiring, Property 11: Timeout produces a bounded timeout record
describe('Feature: mcp-tools-wiring, Property 11: Timeout produces a bounded timeout record', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Validates: Requirements 7.2, 8.4**
   *
   * For any dispatch whose gateway call never settles, advancing past the
   * configured timeout SHALL cause the dispatcher to stop waiting and return a
   * record with `status` equal to `timeout` whose non-null `error` message
   * includes the timeout duration in milliseconds.
   */
  it('a never-settling gateway call yields a timeout record naming the duration (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(categoryArb, timeoutMsArb, actionArb, async (tool, timeoutMs, action) => {
        const dispatcher = createToolDispatcher({
          mcpGateway: createNeverSettlingGateway(),
          config: { toolTimeouts: { [tool]: timeoutMs } }
        });

        const dispatchPromise = dispatcher.dispatch({ tool, action, params: {} });

        // Advance fake time past the configured timeout, flushing the
        // timer callback and its follow-on microtasks.
        await vi.advanceTimersByTimeAsync(timeoutMs);

        const record = await dispatchPromise;

        expect(record.status).toBe('timeout');
        expect(record.error).not.toBeNull();
        expect(typeof record.error).toBe('string');
        // The error message must name the timeout duration in milliseconds.
        expect(record.error).toContain(String(timeoutMs));
        expect(record.error).toContain('ms');
      }),
      { numRuns: 100 }
    );
  });
});
