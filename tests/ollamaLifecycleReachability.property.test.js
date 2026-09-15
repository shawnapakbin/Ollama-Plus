import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createOllamaLifecycle } from '../electron/runtime/ollamaLifecycle.js';

/**
 * Feature: ollama-lifecycle-management
 * Property test for the reachability decision (Task 2.2).
 */

// Feature: ollama-lifecycle-management, Property 1: Reachability is decided solely by whether an HTTP response was obtained
describe('Property 1: Reachability is decided solely by whether an HTTP response was obtained', () => {
  /**
   * Validates: Requirements 1.2, 1.3
   *
   * For any probe outcome, probeReachability classifies the endpoint
   * reachable: true if and only if the injected fetch resolved to an HTTP
   * response (regardless of status code), and reachable: false if and only if
   * the fetch rejected or aborted. The decision never depends on the status
   * value itself.
   */

  // A minimal HTTP-response stand-in: the probe only inspects `status`.
  const httpResponseArb = fc
    .integer({ min: 100, max: 599 })
    .map((status) => ({ status }));

  // Endpoints spanning local and remote forms so `kind` is exercised too. The
  // reachability decision must be independent of endpoint kind.
  const endpointArb = fc.constantFrom(
    'http://127.0.0.1:11434',
    'http://localhost:11434',
    'http://[::1]:11434',
    'http://192.168.1.50:11434',
    'https://ollama.example.com'
  );

  // Rejection errors covering the transport-failure space: AbortError (timeout),
  // connection-class cause codes, and unrecognized errors.
  const rejectionErrorArb = fc.oneof(
    // AbortError — the shape thrown by an aborted fetch on timeout.
    fc.constant(
      (() => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        return e;
      })()
    ),
    // Connection-class cause codes attached to a TypeError('fetch failed'),
    // mirroring how undici surfaces transport failures.
    fc
      .constantFrom('ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH')
      .map((code) => {
        const e = new TypeError('fetch failed');
        e.cause = { code };
        return e;
      }),
    // Unrecognized / non-connection errors — still no HTTP response obtained.
    fc.constantFrom(
      new Error('boom'),
      new TypeError('some other type error'),
      new RangeError('out of range')
    )
  );

  it('classifies reachable: true whenever fetch resolves with an HTTP response (any status)', async () => {
    await fc.assert(
      fc.asyncProperty(endpointArb, httpResponseArb, async (endpoint, response) => {
        const fetchImpl = async () => response;
        const lifecycle = createOllamaLifecycle({ fetchImpl });

        const result = await lifecycle.probeReachability({ endpoint, timeoutMs: 5000 });

        expect(result.reachable).toBe(true);
        expect(result.status).toBe(response.status);
        // reason is only present on the unreachable branch.
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('classifies reachable: false whenever fetch rejects or aborts (no HTTP response)', async () => {
    await fc.assert(
      fc.asyncProperty(endpointArb, rejectionErrorArb, async (endpoint, error) => {
        const fetchImpl = async () => {
          throw error;
        };
        const lifecycle = createOllamaLifecycle({ fetchImpl });

        const result = await lifecycle.probeReachability({ endpoint, timeoutMs: 5000 });

        expect(result.reachable).toBe(false);
        // status is only present on the reachable branch.
        expect(result.status).toBeUndefined();
        // A reason is always attached on the unreachable branch.
        expect(['refused', 'dns', 'timeout', 'other']).toContain(result.reason);
      }),
      { numRuns: 100 }
    );
  });

  it('decides reachability independently of the response status value', async () => {
    // The same endpoint with two different resolved statuses must both be
    // reachable: the status never flips the decision.
    await fc.assert(
      fc.asyncProperty(
        endpointArb,
        httpResponseArb,
        httpResponseArb,
        async (endpoint, first, second) => {
          const makeLifecycle = (response) =>
            createOllamaLifecycle({ fetchImpl: async () => response });

          const a = await makeLifecycle(first).probeReachability({ endpoint });
          const b = await makeLifecycle(second).probeReachability({ endpoint });

          expect(a.reachable).toBe(true);
          expect(b.reachable).toBe(true);
          expect(a.reachable).toBe(b.reachable);
        }
      ),
      { numRuns: 100 }
    );
  });
});
