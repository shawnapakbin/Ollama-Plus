import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a non-empty server/action segment string. Underscore is allowed
 * here because Property 2 does not exercise the name round-trip; it only checks
 * that omitted metadata yields default descriptors and stays dispatchable.
 */
const segmentArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => s.trim().length > 0
);

// ─── Property 2: Omitted metadata yields defaults and remains dispatchable ────

describe('Feature: gateway-list-tools, Property 2: Omitted metadata yields defaults and remains dispatchable', () => {
  /**
   * **Validates: Requirements 1.3, 1.4, 2.4, 2.5**
   *
   * For any server and action, registering a handler with no Tool_Metadata
   * produces a listTools descriptor whose description is '' and whose
   * parameters deep-equal { type: 'object', properties: {} }, and the route is
   * immediately dispatchable (no deferred registration).
   */
  // Feature: gateway-list-tools, Property 2
  it('registers with defaults and dispatches immediately when metadata is omitted (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(segmentArb, segmentArb, async (server, action) => {
        const gateway = createGateway();

        // Register a handler WITHOUT any metadata argument.
        const sentinel = { dispatched: true, server, action };
        gateway.register(server, action, () => sentinel);

        // A fresh gateway with exactly one registered route yields exactly one
        // descriptor; matching by name is avoided here because segments may
        // contain characters that make name-reconstruction ambiguous (that
        // round-trip concern is covered by Property 7).
        const tools = gateway.listTools();
        expect(tools).toHaveLength(1);
        const descriptor = tools[0];

        // Default description is the empty string (Req 2.4).
        expect(descriptor.description).toBe('');

        // Default parameters deep-equal the empty JSON-schema object (Req 2.5).
        expect(descriptor.parameters).toEqual({ type: 'object', properties: {} });

        // The route is immediately dispatchable — registration was not deferred
        // pending metadata (Req 1.3, 1.4).
        const result = await gateway.dispatch({ server, action, payload: {} });
        expect(result).toBe(sentinel);
      }),
      { numRuns: 100 }
    );
  });
});
