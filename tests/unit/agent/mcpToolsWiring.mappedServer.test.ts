import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock MCP gateway. buildMcpRequest never invokes it, but the
 * dispatcher factory requires a function-typed gateway.
 */
function createMockGateway() {
  return () => Promise.resolve('ok');
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category present in TOOL_SERVER_MAP is a supported category. Deriving
 * the arbitrary from the map keeps the test aligned with the wired tool set
 * (terminal, folder, file, browser, python, http, openscad, blender_plate).
 */
const mappedCategoryArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

/**
 * Generates a non-empty action string (trimmed length >= 1).
 */
const actionArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/**
 * Generates an arbitrary params object.
 */
const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

/**
 * A tool call for a supported, mapped category with NO explicit server override.
 */
const mappedToolCallArb = fc.record({
  tool: mappedCategoryArb,
  action: actionArb,
  params: paramsArb
});

// Feature: mcp-tools-wiring, Property 6: Mapped server resolution
describe('Feature: mcp-tools-wiring, Property 6: Mapped server resolution', () => {
  /**
   * **Validates: Requirements 2.2, 6.1, 6.3**
   *
   * For any supported tool category present in TOOL_SERVER_MAP with no explicit
   * server override, buildMcpRequest SHALL set the request `server` to the
   * identifier mapped for that category, and that identifier SHALL be a string
   * of trimmed length >= 1.
   */
  it('resolves server from TOOL_SERVER_MAP when no override is provided (PBT)', () => {
    fc.assert(
      fc.property(mappedToolCallArb, (toolCall) => {
        const dispatcher = createToolDispatcher({ mcpGateway: createMockGateway() });

        const mcpRequest = dispatcher.buildMcpRequest(toolCall);

        const mapped = TOOL_SERVER_MAP[toolCall.tool as keyof typeof TOOL_SERVER_MAP];

        // The mapped identifier itself is a non-empty (trimmed) string.
        expect(typeof mapped).toBe('string');
        expect(mapped.trim().length).toBeGreaterThanOrEqual(1);

        // The request server equals the mapped identifier (trimmed).
        expect(mcpRequest.server).toBe(mapped.trim());

        // And the resolved server is itself a non-empty trimmed string.
        expect(typeof mcpRequest.server).toBe('string');
        expect(mcpRequest.server.trim().length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * Every identifier in TOOL_SERVER_MAP is a non-empty string of trimmed
   * length >= 1, so no supported category maps to an empty server.
   */
  it('every mapped server identifier is a non-empty trimmed string (PBT)', () => {
    fc.assert(
      fc.property(mappedCategoryArb, (category) => {
        const mapped = TOOL_SERVER_MAP[category as keyof typeof TOOL_SERVER_MAP];
        expect(typeof mapped).toBe('string');
        expect(mapped.trim().length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 }
    );
  });
});
