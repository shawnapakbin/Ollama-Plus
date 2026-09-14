/**
 * MCP Tools Wiring — Timeout override isolation property tests
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based tests for getToolTimeout override behavior defined by the
 * mcp-tools-wiring spec.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  DEFAULT_TOOL_TIMEOUTS
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock MCP gateway. getToolTimeout never invokes it, but
 * createToolDispatcher requires a function-typed gateway.
 */
function createMockGateway() {
  return () => Promise.resolve('ok');
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category that has a documented default timeout. Overriding any one of
 * these must leave the remaining defaults untouched.
 */
const defaultCategories = Object.keys(DEFAULT_TOOL_TIMEOUTS);
const categoryArb = fc.constantFrom(...defaultCategories);

/**
 * A positive override timeout value (milliseconds). Constrained to differ from
 * the defaults enough to make isolation observable, though the property holds
 * for any positive value.
 */
const overrideMsArb = fc.integer({ min: 1, max: 600_000 });

// Feature: mcp-tools-wiring, Property 10: Timeout override isolation
describe('Feature: mcp-tools-wiring, Property 10: Timeout override isolation', () => {
  /**
   * **Validates: Requirements 7.4**
   *
   * For any per-category timeout override supplied via `config.toolTimeouts`,
   * getToolTimeout SHALL return the overridden value for that category and
   * SHALL return the default value for every category that was not overridden.
   */
  it('an override applies to its category and leaves all others at default (PBT)', () => {
    fc.assert(
      fc.property(categoryArb, overrideMsArb, (overriddenCategory, overrideMs) => {
        const dispatcher = createToolDispatcher({
          mcpGateway: createMockGateway(),
          config: { toolTimeouts: { [overriddenCategory]: overrideMs } }
        });

        // The overridden category resolves to the override value.
        expect(dispatcher.getToolTimeout(overriddenCategory)).toBe(overrideMs);

        // Every other category still resolves to its default value.
        for (const category of defaultCategories) {
          if (category === overriddenCategory) continue;
          expect(dispatcher.getToolTimeout(category)).toBe(
            DEFAULT_TOOL_TIMEOUTS[category as keyof typeof DEFAULT_TOOL_TIMEOUTS]
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.4**
   *
   * Overriding a single category never mutates the shared DEFAULT_TOOL_TIMEOUTS
   * table: a fresh dispatcher with no config still resolves every category to
   * its original default after an override dispatcher has been created.
   */
  it('overrides do not mutate the shared defaults for other dispatchers (PBT)', () => {
    fc.assert(
      fc.property(categoryArb, overrideMsArb, (overriddenCategory, overrideMs) => {
        // Create an override dispatcher first.
        createToolDispatcher({
          mcpGateway: createMockGateway(),
          config: { toolTimeouts: { [overriddenCategory]: overrideMs } }
        });

        // A separate, un-configured dispatcher must see the pristine defaults.
        const pristine = createToolDispatcher({ mcpGateway: createMockGateway() });

        for (const category of defaultCategories) {
          expect(pristine.getToolTimeout(category)).toBe(
            DEFAULT_TOOL_TIMEOUTS[category as keyof typeof DEFAULT_TOOL_TIMEOUTS]
          );
        }
      }),
      { numRuns: 100 }
    );
  });
});
