// Feature: mcp-tools-wiring, Property 3: Semantic failure is not a gateway error

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../mcp/lib/gateway.mjs';

/**
 * Property-based test — MCP Tools Wiring
 *
 * Feature: mcp-tools-wiring, Property 3: Semantic failure is not a gateway error
 *
 * For any handler that returns a result object indicating a semantic block or
 * tool-level failure (for example `{ blocked: true }` or `{ ok: false }`),
 * `dispatch` SHALL resolve to that object as a successful invocation and
 * `dispatchSafe` SHALL return `{ ok: true, data }` equal to it, rather than
 * treating it as a gateway error.
 *
 * Validates: Requirements 1.6, 8.6
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Server/action segment: non-empty, no ':' so it cannot interfere with the
 * gateway's `::` route-key separator. The property is about the result flowing
 * back unchanged, not about name composition.
 */
const segmentArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes(':'));

/** Arbitrary payload object passed to the handler. */
const payloadArb = fc.object({ maxDepth: 2 });

/**
 * A semantic-failure result object. These are tool-level outcomes carried as
 * data — a blocked command, a failed operation, an executable-not-found, etc.
 * Each includes the discriminator (`blocked: true` or `ok: false`) plus
 * arbitrary extra fields to prove the whole object round-trips unchanged.
 */
const semanticFailureArb = fc.oneof(
  // { blocked: true, ... } — e.g. a risky terminal command gated by policy.
  fc.record(
    {
      blocked: fc.constant(true),
      reason: fc.string(),
      command: fc.option(fc.string(), { nil: undefined }),
      output: fc.option(fc.string(), { nil: undefined })
    },
    { requiredKeys: ['blocked'] }
  ),
  // { ok: false, ... } — e.g. a sandbox / OpenSCAD / Blender failure result.
  fc.record(
    {
      ok: fc.constant(false),
      error: fc.string(),
      errorCategory: fc.option(fc.constantFrom('EXEC_NOT_FOUND', 'DOCKER_UNAVAILABLE'), {
        nil: undefined
      }),
      exitCode: fc.option(fc.integer(), { nil: undefined })
    },
    { requiredKeys: ['ok', 'error'] }
  )
);

// ─── Feature: mcp-tools-wiring, Property 3 ───────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 3: Semantic failure is not a gateway error', () => {
  /**
   * **Validates: Requirements 1.6, 8.6**
   *
   * A registered handler that returns a semantic-failure object resolves as a
   * successful invocation: `dispatch` returns that exact object, and
   * `dispatchSafe` wraps it as `{ ok: true, data }` where `data` equals the
   * object. The failure is never surfaced as a gateway error (`ok: false` at
   * the dispatchSafe level).
   */
  it('dispatch returns the semantic-failure object unchanged and dispatchSafe reports { ok: true, data } (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        payloadArb,
        semanticFailureArb,
        async (server, action, payload, result) => {
          const gateway = createGateway();
          gateway.register(server, action, () => result);

          // dispatch resolves to the handler's return value unchanged.
          const dispatched = await gateway.dispatch({ server, action, payload });
          expect(dispatched).toBe(result);
          expect(dispatched).toEqual(result);

          // dispatchSafe treats it as a successful invocation: { ok: true, data }.
          const safe = await gateway.dispatchSafe({ server, action, payload });
          expect(safe.ok).toBe(true);
          expect(safe).not.toHaveProperty('error');
          expect(safe.data).toBe(result);
          expect(safe.data).toEqual(result);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * The same guarantee holds when the handler is async (resolves to the
   * semantic-failure object), matching the real handlers that await underlying
   * library calls.
   */
  it('holds for async handlers resolving to a semantic-failure object (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        segmentArb,
        segmentArb,
        payloadArb,
        semanticFailureArb,
        async (server, action, payload, result) => {
          const gateway = createGateway();
          gateway.register(server, action, async () => result);

          const dispatched = await gateway.dispatch({ server, action, payload });
          expect(dispatched).toBe(result);

          const safe = await gateway.dispatchSafe({ server, action, payload });
          expect(safe.ok).toBe(true);
          expect(safe.data).toBe(result);
        }
      ),
      { numRuns: 100 }
    );
  });
});
