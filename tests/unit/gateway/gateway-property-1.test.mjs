import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 1: Provided metadata round-trips through
// listTools. For any server, action, description string, and JSON-schema
// parameters object, after registering a route with that Tool_Metadata, the
// descriptor returned by listTools for that route's name carries exactly the
// registered description and parameters.

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// The routeKey lowercases server/action, so descriptor names are composed from
// the lowercased segments. Generate non-empty identifiers and match on the
// composed lowercased name. Exclude ':' so segments cannot interact with the
// routeKey's '::' separator, which would make the key->name decomposition
// ambiguous (the key is split on '::' to recover server/action).
const segmentArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => s.trim().length > 0 && !s.includes(':')
);

// Description is any string (Req 2.4 stores the registered description string).
const descriptionArb = fc.string({ maxLength: 200 });

// Parameters must be a non-null, non-array object to round-trip; otherwise the
// gateway substitutes the default { type: 'object', properties: {} }.
const parametersArb = fc.object({
  maxDepth: 3,
  key: fc.string({ minLength: 1, maxLength: 10 })
});

describe('Feature: gateway-list-tools, Property 1: Provided metadata round-trips through listTools', () => {
  /**
   * **Validates: Requirements 1.2, 2.4, 2.5**
   *
   * For any server, action, description string, and JSON-schema parameters
   * object, after registering a route with that Tool_Metadata, the descriptor
   * returned by listTools for that route's name carries exactly the registered
   * description and parameters.
   */
  it('descriptor for a registered route carries exactly the registered description and parameters (PBT)', () => {
    fc.assert(
      fc.property(
        segmentArb,
        segmentArb,
        descriptionArb,
        parametersArb,
        (server, action, description, parameters) => {
          const gateway = createGateway();
          gateway.register(server, action, () => 'ok', { description, parameters });

          // routeKey lowercases both segments, and the descriptor name is
          // composed from those lowercased segments.
          const expectedName = `${server.toLowerCase()}_${action.toLowerCase()}`;

          const tools = gateway.listTools();
          const descriptor = tools.find((t) => t.name === expectedName);

          expect(descriptor).toBeDefined();
          // The registered description string round-trips exactly.
          expect(descriptor.description).toBe(description);
          // The registered parameters object round-trips exactly (same value).
          expect(descriptor.parameters).toEqual(parameters);
        }
      ),
      { numRuns: 100 }
    );
  });
});
