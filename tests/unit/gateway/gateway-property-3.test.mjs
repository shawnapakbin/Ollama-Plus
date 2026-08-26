import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates values that are NOT functions: number, string, null, undefined,
 * plain object, and array. These are the invalid handler inputs that
 * `register` must reject.
 */
const nonFunctionHandlerArb = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.string(),
  fc.constant(null),
  fc.constant(undefined),
  fc.object(),
  fc.array(fc.anything())
);

/**
 * Generates a server/action segment string. Kept simple and non-empty so the
 * route key is well-formed; the property under test is about handler rejection,
 * not name composition.
 */
const segmentArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

// ─── Property 3: Non-function handlers are always rejected ────────────────────

describe('Feature: gateway-list-tools, Property 3: Non-function handlers are always rejected', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any value that is not a function (number, string, null, undefined,
   * object, array), calling `register(server, action, value)` throws and no
   * route is added. "No route is added" is verified via `listTools()` returning
   * an empty array after the failed register.
   */
  // Feature: gateway-list-tools, Property 3
  it('register throws for any non-function handler and adds no route (PBT)', () => {
    fc.assert(
      fc.property(segmentArb, segmentArb, nonFunctionHandlerArb, (server, action, badHandler) => {
        const gateway = createGateway();

        // register must throw for a non-function handler.
        expect(() => gateway.register(server, action, badHandler)).toThrow(
          'Gateway handler must be a function.'
        );

        // No route should have been added: the tool catalog stays empty.
        expect(gateway.listTools()).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });
});
