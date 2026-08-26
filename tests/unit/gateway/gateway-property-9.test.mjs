import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 9: Descriptors never expose handlers.
// For any registered route, its listTools descriptor has exactly the keys
// name, description, and parameters, and none of its values is a function
// (the handler is never copied into the descriptor, and parameters does not
// contain the handler).

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Non-empty identifier segments for server/action.
const segmentArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

// Description is any string.
const descriptionArb = fc.string({ maxLength: 200 });

// Parameters as an arbitrary JSON-schema-ish object.
const parametersArb = fc.object({
  maxDepth: 3,
  key: fc.string({ minLength: 1, maxLength: 10 })
});

// A route registration: server, action, and Tool_Metadata. Some registrations
// omit metadata (undefined) to exercise the default path as well.
const routeArb = fc.record({
  server: segmentArb,
  action: segmentArb,
  metadata: fc.option(
    fc.record({ description: descriptionArb, parameters: parametersArb }),
    { nil: undefined }
  )
});

const EXPECTED_KEYS = ['description', 'name', 'parameters'];

describe('Feature: gateway-list-tools, Property 9: Descriptors never expose handlers', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any set of registered routes with function handlers and various
   * metadata, every descriptor returned by listTools has exactly the keys
   * name, description, and parameters, and none of its values is a function
   * (the internal handler is never exposed through the Tool_Catalog).
   */
  it('every descriptor has exactly {name, description, parameters} and no value is a function (PBT)', () => {
    fc.assert(
      fc.property(fc.array(routeArb, { minLength: 1, maxLength: 10 }), (routes) => {
        const gateway = createGateway();

        for (const { server, action, metadata } of routes) {
          // Register with a real function handler (the thing that must never
          // leak into a descriptor).
          const handler = () => 'ok';
          gateway.register(server, action, handler, metadata);
        }

        const tools = gateway.listTools();
        expect(tools.length).toBeGreaterThan(0);

        for (const descriptor of tools) {
          // Exactly the three descriptor keys, no more, no less.
          expect(Object.keys(descriptor).sort()).toEqual(EXPECTED_KEYS);

          // None of the descriptor's values is a function.
          for (const value of Object.values(descriptor)) {
            expect(typeof value).not.toBe('function');
          }

          // Specifically, the handler is not present under any field.
          expect(typeof descriptor.name).not.toBe('function');
          expect(typeof descriptor.description).not.toBe('function');
          expect(typeof descriptor.parameters).not.toBe('function');

          // The parameters object must not carry a function (e.g. a leaked
          // handler) at its top level.
          if (descriptor.parameters && typeof descriptor.parameters === 'object') {
            for (const value of Object.values(descriptor.parameters)) {
              expect(typeof value).not.toBe('function');
            }
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
