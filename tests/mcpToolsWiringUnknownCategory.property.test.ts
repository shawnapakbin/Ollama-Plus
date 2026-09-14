import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../electron/runtime/agent/toolDispatcher.js';

/**
 * Property-based test — MCP Tools Wiring
 *
 * Feature: mcp-tools-wiring, Property 8: Unknown category is rejected before dispatch
 *
 * For any tool call whose category is absent from `TOOL_SERVER_MAP` and that
 * provides no explicit server override, `buildMcpRequest` SHALL throw an error
 * naming the tool category, and no request SHALL be dispatched to the gateway.
 *
 * Validates: Requirements 6.6
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const KNOWN_CATEGORIES = new Set(Object.keys(TOOL_SERVER_MAP));

/**
 * Generates a tool category string that is NOT present in TOOL_SERVER_MAP.
 * Categories are compared as-is against the map keys (buildMcpRequest indexes
 * the map with the raw `tool` value).
 */
const unknownCategoryArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && !KNOWN_CATEGORIES.has(s));

/**
 * Generates a non-empty action string.
 */
const actionArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/**
 * Generates a params object with string keys and simple values.
 */
const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

// ─── Feature: mcp-tools-wiring, Property 8 ───────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 8: Unknown category is rejected before dispatch', () => {
  /**
   * Validates: Requirements 6.6
   *
   * buildMcpRequest throws for an unknown category (no override), the error
   * message names the offending category, and the gateway is never invoked.
   */
  it('throws naming the category and never dispatches to the gateway (PBT)', () => {
    fc.assert(
      fc.property(unknownCategoryArb, actionArb, paramsArb, (tool, action, params) => {
        const gateway = vi.fn(() => Promise.resolve('should-not-run'));
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        let thrown: unknown;
        try {
          dispatcher.buildMcpRequest({ tool, action, params });
          throw new Error('__NO_THROW__');
        } catch (err) {
          thrown = err;
        }

        // Must have thrown a real Error (not our sentinel)
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).not.toBe('__NO_THROW__');

        // The error message names the offending tool category
        expect(message).toContain(tool);

        // No dispatch occurred to the gateway
        expect(gateway).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 6.6
   *
   * Through the full dispatch pipeline: an unknown-category call yields an
   * error record and the underlying gateway is never called.
   */
  it('dispatch of an unknown category produces an error record with no gateway call (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(unknownCategoryArb, actionArb, paramsArb, async (tool, action, params) => {
        const gateway = vi.fn(() => Promise.resolve('should-not-run'));
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const record = await dispatcher.dispatch({ tool, action, params });

        // The dispatch surfaces a non-success record...
        expect(record.status).toBe('error');
        // ...whose error is a non-empty message indicating the server/category
        // could not be resolved. Note: the dispatch pipeline sanitizes error
        // messages (e.g. path redaction per Requirements 8.3/8.5/9.3), so the
        // raw category is NOT guaranteed to survive in the message. The
        // "names the category" guarantee is asserted by the first property,
        // which inspects the un-sanitized buildMcpRequest throw directly.
        expect(typeof record.error).toBe('string');
        expect((record.error as string).length).toBeGreaterThan(0);
        expect(record.error).toMatch(/cannot determine mcp server/i);
        // ...and the gateway was never dispatched to.
        expect(gateway).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
