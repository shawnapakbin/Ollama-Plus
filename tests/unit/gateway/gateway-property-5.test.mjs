import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a server/action segment string. Kept non-empty so the route key is
 * well-formed. Underscores are allowed here because Property 5 addresses
 * re-registration semantics, not name round-tripping.
 */
const segmentArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/**
 * Generates a metadata object with a string description and a JSON-schema-ish
 * parameters object. Kept as a non-null, non-array object so it survives
 * `register`'s normalization unchanged.
 */
const metadataArb = fc.record({
  description: fc.string({ maxLength: 60 }),
  parameters: fc.record(
    {
      type: fc.constant('object'),
      properties: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.record({ type: fc.constantFrom('string', 'number', 'boolean') })
      )
    },
    { requiredKeys: ['type', 'properties'] }
  )
});

// ─── Property 5: Re-registration retains the most recent handler and metadata ─

describe('Feature: gateway-list-tools, Property 5: Re-registration retains the most recent handler and metadata', () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * For any two registrations on the same `server::action` key, `dispatch`
   * invokes the second handler and the `listTools` descriptor reflects the
   * second registration's metadata. There is also exactly one descriptor for
   * that key (Map.set overwrite semantics).
   */
  // Feature: gateway-list-tools, Property 5
  it('second registration wins for handler, metadata, and descriptor uniqueness (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        metadataArb,
        metadataArb,
        async (server, action, firstMeta, secondMeta) => {
          const gateway = createGateway();

          // Distinct tagged return values so we can tell which handler ran.
          const firstValue = { tag: 'first-handler' };
          const secondValue = { tag: 'second-handler' };
          const firstHandler = () => firstValue;
          const secondHandler = () => secondValue;

          // Register the same server::action twice with distinct handlers and
          // distinct metadata.
          gateway.register(server, action, firstHandler, firstMeta);
          gateway.register(server, action, secondHandler, secondMeta);

          // dispatch must invoke the SECOND handler.
          const dispatched = await gateway.dispatch({ server, action, payload: {} });
          expect(dispatched).toBe(secondValue);
          expect(dispatched).not.toBe(firstValue);

          const tools = gateway.listTools();

          // Exactly one descriptor exists for that key (re-registration
          // overwrites rather than appends).
          expect(tools).toHaveLength(1);

          // The descriptor reflects the SECOND registration's metadata.
          const descriptor = tools[0];
          expect(descriptor.description).toBe(secondMeta.description);
          expect(descriptor.parameters).toEqual(secondMeta.parameters);
        }
      ),
      { numRuns: 100 }
    );
  });
});
