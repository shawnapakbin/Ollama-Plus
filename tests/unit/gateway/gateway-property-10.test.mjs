import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 10: listTools returns a fresh array on
// each call. For any gateway state, two successive listTools calls return
// distinct array references, so mutating a returned array does not change the
// result of a subsequent call.

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// The routeKey lowercases server/action. Generate non-empty identifiers used to
// register a varying set of routes so the gateway holds real state.
const segmentArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => s.trim().length > 0
);

// A set of distinct (server, action) pairs registered on the gateway. Using a
// record array keeps generation simple; duplicates just overwrite (Map.set),
// which is fine for this property.
const routesArb = fc.array(
  fc.record({
    server: segmentArb,
    action: segmentArb
  }),
  { minLength: 0, maxLength: 8 }
);

describe('Feature: gateway-list-tools, Property 10: listTools returns a fresh array on each call', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any gateway state, two successive listTools calls return distinct array
   * references, and mutating a returned array does not change the result of a
   * subsequent listTools call (length and contents remain correct).
   */
  it('two successive calls return distinct arrays and mutation does not leak (PBT)', () => {
    fc.assert(
      fc.property(routesArb, (routes) => {
        const gateway = createGateway();
        for (const { server, action } of routes) {
          gateway.register(server, action, () => 'ok', {
            description: 'd',
            parameters: { type: 'object', properties: {} }
          });
        }

        const first = gateway.listTools();
        const second = gateway.listTools();

        // Two successive calls return distinct array references.
        expect(first).not.toBe(second);

        // The two fresh arrays are equal in content before any mutation.
        expect(second).toEqual(first);

        // Capture the expected length/contents from an independent call so we
        // can verify a later call is unaffected by mutating `first`.
        const expectedLength = second.length;
        const expectedContents = gateway.listTools();

        // Mutate the first returned array in a few ways.
        first.push({ name: 'injected', description: '', parameters: {} });
        if (first.length > 1) {
          first.splice(0, 1);
        }
        first.pop();

        // A subsequent call is unaffected by the mutation of a prior result:
        // both length and contents remain correct.
        const third = gateway.listTools();
        expect(third).not.toBe(first);
        expect(third.length).toBe(expectedLength);
        expect(third).toEqual(expectedContents);
      }),
      { numRuns: 100 }
    );
  });
});
