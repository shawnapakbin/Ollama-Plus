// Feature: mcp-tools-wiring, Property 1: Routing identity
//
// For any registered route (server, action) and any payload object, dispatching
// a request to that route invokes the corresponding handler exactly once and
// resolves to the handler's return value unchanged.

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Server/action segments. The gateway lowercases both segments in routeKey and
 * splits the composed key on '::', so exclude ':' to keep the key unambiguous.
 * Non-empty (trimmed) so the route is well-formed and dispatch does not reject
 * for a missing server/action.
 */
const segmentArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0 && !s.includes(':'));

/**
 * Arbitrary payload object. dispatch coerces a non-object payload to {}, so the
 * routing-identity property (handler invoked once, return value unchanged) is
 * exercised with genuine object payloads.
 */
const payloadArb = fc.object({ maxDepth: 3 });

/**
 * Arbitrary return values a handler may resolve to: primitives, objects, arrays,
 * and semantic-failure shapes. The handler's return value must flow back through
 * dispatch unchanged (same reference for objects/arrays, same value otherwise).
 */
const returnValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.constant(null),
  fc.object({ maxDepth: 3 }),
  fc.array(fc.anything(), { maxLength: 5 }),
  fc.record({ blocked: fc.boolean(), reason: fc.string() }),
  fc.record({ ok: fc.boolean() })
);

// ─── Property 1: Routing identity ─────────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 1: Routing identity', () => {
  /**
   * **Validates: Requirements 1.2, 3.2, 4.2, 5.2**
   *
   * Register a route with a spy handler, dispatch to it, and assert the handler
   * is invoked exactly once and that dispatch resolves to the handler's return
   * value unchanged.
   */
  it('dispatching to a registered route invokes the handler once and returns its value unchanged (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        payloadArb,
        returnValueArb,
        async (server, action, payload, returnValue) => {
          const gateway = createGateway();

          // Spy handler that resolves to the arbitrary return value. Using a
          // reference-preserving return lets us assert the value is unchanged.
          const handler = vi.fn(async () => returnValue);

          gateway.register(server, action, handler, {
            description: 'routing identity handler',
            parameters: { type: 'object', properties: {} }
          });

          const result = await gateway.dispatch({ server, action, payload });

          // Handler invoked exactly once.
          expect(handler).toHaveBeenCalledTimes(1);

          // dispatch resolves to the handler's return value unchanged.
          // toBe asserts identity, so object/array values must be the SAME
          // reference (never cloned) and primitives the same value.
          expect(result).toBe(returnValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});
