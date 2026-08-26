import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 4: Metadata does not affect dispatch
//
// For any server, action, handler, and payload, dispatching a route registered
// with Tool_Metadata returns the same result (and dispatchSafe the same
// { ok, data } / { ok, error }) as dispatching the identically-keyed route
// registered without Tool_Metadata.
//
// Validates: Requirements 1.6, 3.5, 5.1

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Server/action segments. Non-empty so dispatch does not reject on missing
 * server/action, and the same values key the route on both gateways.
 */
const segmentArb = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0);

/**
 * Random payload object passed through dispatch to the handler.
 */
const payloadArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 15 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 50 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

/**
 * Arbitrary Tool_Metadata to attach to the "with metadata" gateway. Includes a
 * description string and a JSON-schema-ish parameters object.
 */
const metadataArb = fc.record({
  description: fc.string({ maxLength: 60 }),
  parameters: fc.record({
    type: fc.constant('object'),
    properties: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
      fc.record({ type: fc.constantFrom('string', 'number', 'boolean') }),
      { minKeys: 0, maxKeys: 4 }
    )
  })
});

describe('Feature: gateway-list-tools, Property 4: Metadata does not affect dispatch', () => {
  /**
   * A value-returning handler produces identical dispatch results whether or not
   * metadata was supplied at registration. The handler returns a tagged value
   * derived from the payload so the result is deterministically checkable.
   *
   * Validates: Requirements 1.6, 3.5, 5.1
   */
  it('dispatch returns identical results with and without metadata (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(segmentArb, segmentArb, payloadArb, metadataArb, async (server, action, payload, metadata) => {
        // A pure handler that returns a tagged, deterministic value.
        const makeHandler = () => (p, ctx) => ({
          tag: 'ok',
          server: ctx.server,
          action: ctx.action,
          payload: p
        });

        const withMeta = createGateway();
        const withoutMeta = createGateway();
        withMeta.register(server, action, makeHandler(), metadata);
        withoutMeta.register(server, action, makeHandler());

        const request = { server, action, payload };
        const resultWith = await withMeta.dispatch(request);
        const resultWithout = await withoutMeta.dispatch(request);
        expect(resultWith).toEqual(resultWithout);

        const safeWith = await withMeta.dispatchSafe(request);
        const safeWithout = await withoutMeta.dispatchSafe(request);
        expect(safeWith).toEqual(safeWithout);
        expect(safeWith.ok).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * An error-throwing handler produces identical dispatchSafe { ok:false, error }
   * results whether or not metadata was supplied at registration, covering the
   * error path of the { ok, error } equivalence.
   *
   * Validates: Requirements 1.6, 3.5, 5.1
   */
  it('dispatchSafe returns identical { ok:false, error } for throwing handlers with and without metadata (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        payloadArb,
        metadataArb,
        fc.string({ minLength: 1, maxLength: 40 }),
        async (server, action, payload, metadata, errorMessage) => {
          const makeThrowingHandler = () => () => {
            throw new Error(errorMessage);
          };

          const withMeta = createGateway();
          const withoutMeta = createGateway();
          withMeta.register(server, action, makeThrowingHandler(), metadata);
          withoutMeta.register(server, action, makeThrowingHandler());

          const request = { server, action, payload };

          const safeWith = await withMeta.dispatchSafe(request);
          const safeWithout = await withoutMeta.dispatchSafe(request);

          expect(safeWith).toEqual(safeWithout);
          expect(safeWith.ok).toBe(false);
          expect(safeWith.error).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });
});
