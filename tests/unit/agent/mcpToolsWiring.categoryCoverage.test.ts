/**
 * MCP Tools Wiring — Category coverage example test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Example (not property) test asserting that the OpenSCAD and Blender Plate
 * tools are fully wired into both the runtime dispatcher tables
 * (TOOL_SERVER_MAP, DEFAULT_TOOL_TIMEOUTS) and the TypeScript category unions
 * (ToolCategory, ToolReference.category, ToolTimeouts).
 *
 * The runtime tables are plain objects, so their coverage is asserted directly.
 * The TypeScript unions are erased at runtime, so their coverage is asserted at
 * compile time via typed constants that must remain assignable to the union
 * types — if `openscad` or `blender_plate` were removed from a union, the file
 * would fail to type-check.
 */
import { describe, expect, it } from 'vitest';
import {
  TOOL_SERVER_MAP,
  DEFAULT_TOOL_TIMEOUTS
} from '../../../electron/runtime/agent/toolDispatcher.js';
import type { ToolCategory } from '../../../src/types/agentChat';
import type { ToolReference, ToolTimeouts } from '../../../src/types/agent';

// ─── Compile-time union coverage (erased at runtime) ─────────────────────────

/**
 * These typed constants must be assignable to the respective union types.
 * If `openscad` or `blender_plate` were removed from `ToolCategory` in
 * src/types/agentChat.ts, this assignment would fail `tsc`.
 */
const openscadChatCategory: ToolCategory = 'openscad';
const blenderPlateChatCategory: ToolCategory = 'blender_plate';

/**
 * `ToolReference.category` is a separate union in src/types/agent.ts. These
 * assignments pin that union to include the OpenSCAD and Blender Plate members.
 */
const openscadRefCategory: ToolReference['category'] = 'openscad';
const blenderPlateRefCategory: ToolReference['category'] = 'blender_plate';

/**
 * `ToolTimeouts` must accept optional `openscad` / `blender_plate` entries.
 * If either key were removed, this object literal would be a type error.
 */
const timeoutsWithNewTools: ToolTimeouts = {
  terminal: 60_000,
  file: 30_000,
  browser: 120_000,
  python: 60_000,
  http: 30_000,
  openscad: 120_000,
  blender_plate: 180_000
};

// Feature: mcp-tools-wiring, Category coverage (Req 6.2, 7.1)
describe('Feature: mcp-tools-wiring, Category coverage', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * TOOL_SERVER_MAP must map `openscad` and `blender_plate` to non-empty
   * server identifiers so tool calls to those categories resolve without an
   * explicit override.
   */
  it('TOOL_SERVER_MAP includes openscad and blender_plate with valid server identifiers', () => {
    for (const category of ['openscad', 'blender_plate'] as const) {
      expect(Object.prototype.hasOwnProperty.call(TOOL_SERVER_MAP, category)).toBe(true);
      const server = TOOL_SERVER_MAP[category];
      expect(typeof server).toBe('string');
      expect(server.trim().length).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * DEFAULT_TOOL_TIMEOUTS must define a positive default timeout for
   * `openscad` and `blender_plate` so neither category resolves to an
   * undefined timeout.
   */
  it('DEFAULT_TOOL_TIMEOUTS includes positive timeouts for openscad and blender_plate', () => {
    for (const category of ['openscad', 'blender_plate'] as const) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_TOOL_TIMEOUTS, category)).toBe(true);
      const timeout = DEFAULT_TOOL_TIMEOUTS[category];
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThan(0);
    }
  });

  /**
   * **Validates: Requirements 6.2, 7.1**
   *
   * The TypeScript unions carry the OpenSCAD and Blender Plate members at
   * compile time. The typed constants above enforce that; these runtime
   * assertions confirm the constants were exercised (and guard against the
   * declarations being dropped in a future edit).
   */
  it('ToolCategory / ToolReference.category unions include openscad and blender_plate', () => {
    expect(openscadChatCategory).toBe('openscad');
    expect(blenderPlateChatCategory).toBe('blender_plate');
    expect(openscadRefCategory).toBe('openscad');
    expect(blenderPlateRefCategory).toBe('blender_plate');
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * ToolTimeouts accepts the optional openscad / blender_plate entries.
   */
  it('ToolTimeouts accepts optional openscad and blender_plate entries', () => {
    expect(timeoutsWithNewTools.openscad).toBe(120_000);
    expect(timeoutsWithNewTools.blender_plate).toBe(180_000);
  });
});
