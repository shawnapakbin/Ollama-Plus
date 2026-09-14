import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// Feature: mcp-tools-wiring, Property 5: MCP request schema
//
// For any valid tool call (a category present in TOOL_SERVER_MAP or an explicit
// server override, plus a non-empty action, plus optional params), buildMcpRequest
// SHALL produce a request whose `server` is a string of trimmed length >= 1, whose
// `action` is a string of trimmed length >= 1, and whose `payload` is an object.
//
// Validates: Requirements 6.5

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category present in the dispatcher's server map. Includes the newly
 * wired `openscad` and `blender_plate` categories.
 */
const mappedCategoryArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

/**
 * A non-empty action string (trimmed length >= 1).
 */
const actionArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

/**
 * A non-empty explicit server override (trimmed length >= 1).
 */
const serverOverrideArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/**
 * Optional params: sometimes absent (undefined), sometimes an object.
 */
const paramsArb = fc.option(
  fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
    fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
    { minKeys: 0, maxKeys: 5 }
  ),
  { nil: undefined }
);

/**
 * A valid tool call reached via a mapped category (no explicit server override).
 */
const mappedToolCallArb = fc.record(
  {
    tool: mappedCategoryArb,
    action: actionArb,
    params: paramsArb
  },
  { requiredKeys: ['tool', 'action'] }
);

/**
 * A valid tool call reached via an explicit server override. The `tool` may be
 * any string (including one absent from the map) because the override provides
 * the server directly.
 */
const overrideToolCallArb = fc.record(
  {
    tool: fc.string({ maxLength: 20 }),
    server: serverOverrideArb,
    action: actionArb,
    params: paramsArb
  },
  { requiredKeys: ['server', 'action'] }
);

// ─── Property 5: MCP request schema ──────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 5: MCP request schema', () => {
  /**
   * Validates: Requirements 6.5
   *
   * A tool call resolved through a mapped category yields a request whose
   * `server` and `action` are trimmed non-empty strings and whose `payload`
   * is a (non-null) object.
   */
  it('mapped-category calls produce a valid request schema (PBT)', () => {
    const dispatcher = createToolDispatcher({ mcpGateway: () => Promise.resolve('ok') });

    fc.assert(
      fc.property(mappedToolCallArb, (toolCall) => {
        const request = dispatcher.buildMcpRequest(toolCall);

        expect(typeof request.server).toBe('string');
        expect(request.server.trim().length).toBeGreaterThanOrEqual(1);

        expect(typeof request.action).toBe('string');
        expect(request.action.trim().length).toBeGreaterThanOrEqual(1);

        expect(typeof request.payload).toBe('object');
        expect(request.payload).not.toBeNull();
        expect(Array.isArray(request.payload)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Validates: Requirements 6.5
   *
   * A tool call carrying an explicit server override yields a request whose
   * `server` and `action` are trimmed non-empty strings and whose `payload`
   * is a (non-null) object, even when the category is absent from the map.
   */
  it('explicit-override calls produce a valid request schema (PBT)', () => {
    const dispatcher = createToolDispatcher({ mcpGateway: () => Promise.resolve('ok') });

    fc.assert(
      fc.property(overrideToolCallArb, (toolCall) => {
        const request = dispatcher.buildMcpRequest(toolCall);

        expect(typeof request.server).toBe('string');
        expect(request.server.trim().length).toBeGreaterThanOrEqual(1);

        expect(typeof request.action).toBe('string');
        expect(request.action.trim().length).toBeGreaterThanOrEqual(1);

        expect(typeof request.payload).toBe('object');
        expect(request.payload).not.toBeNull();
        expect(Array.isArray(request.payload)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
