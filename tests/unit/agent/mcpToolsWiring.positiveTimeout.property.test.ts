/**
 * MCP Tools Wiring — Positive timeout per category property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that getToolTimeout resolves to a positive
 * timeout for every tool category — including the newly wired `openscad` and
 * `blender_plate` categories as well as unrecognized categories, which fall
 * back to a positive default.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  DEFAULT_TOOL_TIMEOUTS
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock MCP gateway. getToolTimeout never invokes it, but the
 * dispatcher factory requires a function-typed gateway.
 */
function createMockGateway() {
  return () => Promise.resolve('ok');
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every known category present in DEFAULT_TOOL_TIMEOUTS, including the newly
 * wired `openscad` and `blender_plate` categories. Deriving the arbitrary from
 * the table keeps the test aligned with the wired tool set.
 */
const knownCategoryArb = fc.constantFrom(...Object.keys(DEFAULT_TOOL_TIMEOUTS));

/**
 * Categories that are NOT present in DEFAULT_TOOL_TIMEOUTS — these must fall
 * back to a positive default rather than yielding a non-positive value.
 */
const unknownCategoryArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !(s.toLowerCase() in DEFAULT_TOOL_TIMEOUTS));

/**
 * The full input space getToolTimeout accepts: known categories, unknown
 * categories, and non-string/absent inputs (which also fall back).
 */
const anyToolInputArb = fc.oneof(
  knownCategoryArb,
  unknownCategoryArb,
  fc.constantFrom('', undefined, null),
  fc.integer(),
  fc.boolean()
);

// Feature: mcp-tools-wiring, Property 9: Every category resolves to a positive timeout
describe('Feature: mcp-tools-wiring, Property 9: Every category resolves to a positive timeout', () => {
  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * For any tool category — including `openscad`, `blender_plate`, and
   * unrecognized categories — getToolTimeout SHALL return a number greater
   * than zero.
   */
  it('getToolTimeout returns a positive number for every category (PBT)', () => {
    fc.assert(
      fc.property(anyToolInputArb, (tool) => {
        const dispatcher = createToolDispatcher({ mcpGateway: createMockGateway() });

        const timeout = dispatcher.getToolTimeout(tool as string);

        expect(typeof timeout).toBe('number');
        expect(Number.isFinite(timeout)).toBe(true);
        expect(timeout).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * `openscad` and `blender_plate` resolve to their positive mapped defaults,
   * confirming the newly wired categories are covered.
   */
  it('openscad and blender_plate resolve to their positive mapped defaults', () => {
    const dispatcher = createToolDispatcher({ mcpGateway: createMockGateway() });

    expect(dispatcher.getToolTimeout('openscad')).toBe(DEFAULT_TOOL_TIMEOUTS.openscad);
    expect(dispatcher.getToolTimeout('openscad')).toBeGreaterThan(0);

    expect(dispatcher.getToolTimeout('blender_plate')).toBe(DEFAULT_TOOL_TIMEOUTS.blender_plate);
    expect(dispatcher.getToolTimeout('blender_plate')).toBeGreaterThan(0);
  });

  /**
   * **Validates: Requirements 7.1, 7.5**
   *
   * Every default timeout in the table is itself a positive number, so no
   * supported category maps to a non-positive value.
   */
  it('every default timeout in the table is a positive number (PBT)', () => {
    fc.assert(
      fc.property(knownCategoryArb, (category) => {
        const value = DEFAULT_TOOL_TIMEOUTS[category as keyof typeof DEFAULT_TOOL_TIMEOUTS];
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
