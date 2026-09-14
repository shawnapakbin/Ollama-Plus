import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: mcp-tools-wiring, Property 2: Unknown-route rejection
//
// For any server identifier and any action string that is NOT registered under
// that server, `dispatch` rejects with an unknown-route error identifying the
// route, and no registered handler is invoked. `dispatchSafe` mirrors this by
// returning { ok: false } with the sanitized unknown-route error.

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Non-empty server/action segments. The gateway lowercases both segments when
// composing the route key, so route identity is compared case-insensitively.
const segmentArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => s.trim().length > 0
);

// Payload is any plain object; a non-object payload is coerced to {} by the
// gateway, which does not affect routing.
const payloadArb = fc.object({ maxDepth: 2 });

/**
 * Produces a { registered, requested } pair where `requested` targets an action
 * that is guaranteed NOT to be registered under the requested server. We build a
 * fresh gateway with a single registered route and then request a route whose
 * lowercased key differs from the registered one.
 */
const scenarioArb = fc
  .record({
    regServer: segmentArb,
    regAction: segmentArb,
    reqServer: segmentArb,
    reqAction: segmentArb
  })
  .filter(({ regServer, regAction, reqServer, reqAction }) => {
    const regKey = `${regServer.toLowerCase()}::${regAction.toLowerCase()}`;
    const reqKey = `${reqServer.toLowerCase()}::${reqAction.toLowerCase()}`;
    // Ensure the requested route is genuinely unregistered.
    return regKey !== reqKey;
  });

describe('Feature: mcp-tools-wiring, Property 2: Unknown-route rejection', () => {
  /**
   * **Validates: Requirements 1.4, 2.3, 3.3, 4.3, 4.4, 5.3**
   *
   * Dispatching to an action that is not registered under the target server
   * rejects with an unknown-route error naming the route, and the single
   * registered handler is never invoked. `dispatchSafe` returns
   * { ok: false, error } carrying the same unknown-route error text.
   */
  it('rejects an unregistered route with an unknown-route error and invokes no handler (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, payloadArb, async (scenario, payload) => {
        const { regServer, regAction, reqServer, reqAction } = scenario;

        const gateway = createGateway();

        // Register exactly one route with a spy handler that must never fire.
        const handler = vi.fn(() => ({ ok: true, data: 'should-not-run' }));
        gateway.register(regServer, regAction, handler);

        const request = { server: reqServer, action: reqAction, payload };

        // dispatch rejects with an unknown-route error identifying the route.
        let rejected = false;
        try {
          await gateway.dispatch(request);
        } catch (err) {
          rejected = true;
          const message = String(err && err.message ? err.message : err);
          expect(message).toMatch(/unknown mcp route/i);
          // The error identifies the requested (lowercased) route.
          expect(message).toContain(reqServer.toLowerCase());
          expect(message).toContain(reqAction.toLowerCase());
        }
        expect(rejected).toBe(true);

        // dispatchSafe surfaces the same failure as { ok: false, error }.
        const safe = await gateway.dispatchSafe(request);
        expect(safe.ok).toBe(false);
        expect(typeof safe.error).toBe('string');
        expect(safe.error).toMatch(/unknown mcp route/i);

        // No registered handler was invoked across either call.
        expect(handler).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
