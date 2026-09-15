/**
 * MCP Tools Wiring — Tool Dispatcher property tests
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based tests for buildMcpRequest server-resolution behavior
 * defined by the mcp-tools-wiring spec.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock MCP gateway. buildMcpRequest never invokes it, but
 * createToolDispatcher requires a function.
 */
function createMockGateway() {
  return () => Promise.resolve('ok');
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category present in TOOL_SERVER_MAP, plus categories absent from it,
 * plus undefined — the override must win in all of these cases.
 */
const anyCategoryArb = fc.oneof(
  fc.constantFrom(...Object.keys(TOOL_SERVER_MAP)),
  fc.constantFrom('unknown', 'not-a-real-category', 'openscadX'),
  fc.constant(undefined)
);

/**
 * A non-empty explicit server override (has trimmed length >= 1).
 * Includes values with surrounding whitespace to exercise trimming.
 */
const nonEmptyOverrideArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * An override that is padded with leading/trailing whitespace so the
 * (trimmed) resolution can be asserted.
 */
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 })
  .map((chars) => chars.join(''));

const paddedOverrideArb = nonEmptyOverrideArb.chain((core) =>
  fc.tuple(whitespaceArb, whitespaceArb).map(([lead, trail]) => lead + core + trail)
);

const actionArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

// ─── Property 7: Override precedence ──────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 7: Override precedence', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any tool call that includes a non-empty explicit server override,
   * buildMcpRequest SHALL set the request `server` to the (trimmed) override
   * value in preference to any category-mapped value.
   */
  it('non-empty override wins over any category-mapped value, trimmed (PBT)', () => {
    fc.assert(
      fc.property(anyCategoryArb, paddedOverrideArb, actionArb, paramsArb, (tool, server, action, params) => {
        const dispatcher = createToolDispatcher({ mcpGateway: createMockGateway() });

        const mcpRequest = dispatcher.buildMcpRequest({ tool, server, action, params });

        // The request server is exactly the trimmed override, independent of the mapped value.
        expect(mcpRequest.server).toBe(server.trim());
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * When the category maps to a value, the override still wins: the resolved
   * server differs from the mapped value whenever the trimmed override differs.
   */
  it('override takes precedence even when the category has a mapped server (PBT)', () => {
    const mappedCategoryArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

    fc.assert(
      fc.property(mappedCategoryArb, nonEmptyOverrideArb, actionArb, (tool, server, action) => {
        const dispatcher = createToolDispatcher({ mcpGateway: createMockGateway() });

        const mcpRequest = dispatcher.buildMcpRequest({ tool, server, action });

        const mapped = TOOL_SERVER_MAP[tool];
        expect(mcpRequest.server).toBe(server.trim());
        // Sanity: when the override text differs from the mapped id, they must not be equal.
        if (server.trim() !== mapped) {
          expect(mcpRequest.server).not.toBe(mapped);
        }
      }),
      { numRuns: 100 }
    );
  });
});
