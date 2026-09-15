import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createOllamaLifecycle } from '../electron/runtime/ollamaLifecycle.js';

/**
 * Feature: ollama-lifecycle-management
 * Property test for remote-start refusal (Task 2.5).
 *
 * Dedicated file for the `startLocalServer` start-flow properties so it does not
 * conflict with the reachability property file.
 */

// Feature: ollama-lifecycle-management, Property 4: Start refuses remote endpoints without spawning
describe('Property 4: Start refuses remote endpoints without spawning', () => {
  /**
   * Validates: Requirements 4.2
   *
   * For any Remote_Endpoint (any host that is NOT 127.0.0.1 / localhost / ::1),
   * startLocalServer resolves to { ok: false, reason: 'remote' } and NEVER
   * invokes the injected spawn implementation — the refusal happens before any
   * process control (Requirement 4.2).
   */

  // Remote hosts spanning LAN IPs, public IPs, and hostnames. None of these are
  // the local-host forms (127.0.0.1 / localhost / ::1), so every one must
  // classify as remote.
  const remoteHostArb = fc.oneof(
    // Private/LAN IPv4 ranges.
    fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .map(([c, d]) => `192.168.${c}.${d}`),
    fc
      .tuple(fc.integer({ min: 16, max: 31 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
      .map(([b, c, d]) => `172.${b}.${c}.${d}`),
    fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 1, max: 254 }))
      .map(([b, c, d]) => `10.${b}.${c}.${d}`),
    // Arbitrary public IPv4 (first octet avoids 10/127 and stays routable-ish).
    fc
      .tuple(
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 254 })
      )
      .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    // Hostnames (single-label and dotted domains).
    fc.constantFrom(
      'ollama.example.com',
      'ollama.lan',
      'my-server',
      'gpu-box.internal',
      'inference.corp.example.org',
      'host01'
    )
  );

  // Compose a full endpoint string from a remote host, optionally with a scheme
  // and/or an explicit port, so the classification is exercised across the
  // scheme/port variations the design calls out.
  const remoteEndpointArb = fc
    .record({
      host: remoteHostArb,
      scheme: fc.constantFrom('http://', 'https://', ''),
      port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null })
    })
    .map(({ host, scheme, port }) => `${scheme}${host}${port === null ? '' : `:${port}`}`);

  it('returns { ok: false, reason: "remote" } and never spawns for any remote endpoint', async () => {
    await fc.assert(
      fc.asyncProperty(remoteEndpointArb, async (endpoint) => {
        // Spy spawn implementation that records every invocation. It must never
        // be called for a remote endpoint (Requirement 4.2).
        const spawnCalls = [];
        const spawnImpl = (...args) => {
          spawnCalls.push(args);
          // Return a benign child-process stand-in in case it were ever called
          // (it must not be) so the test fails on the assertion below rather
          // than on an unexpected throw.
          return { on() {}, unref() {} };
        };

        // A fetch spy that also records invocations: a refused remote endpoint
        // must be rejected before any readiness probing occurs.
        const fetchCalls = [];
        const fetchImpl = async (...args) => {
          fetchCalls.push(args);
          return { status: 200 };
        };

        // Resolve the binary through injected seams so resolution can never be
        // the reason for the refusal — the refusal must be purely from the
        // remote classification, ahead of resolution and spawning.
        const lifecycle = createOllamaLifecycle({
          spawnImpl,
          fetchImpl,
          whichImpl: () => '/usr/bin/ollama',
          fileExistsImpl: () => true
        });

        const result = await lifecycle.startLocalServer({ endpoint });

        expect(result).toEqual({ ok: false, reason: 'remote' });
        // The injected spawn implementation is never invoked (Requirement 4.2).
        expect(spawnCalls).toHaveLength(0);
        // No readiness probing occurs for a refused remote endpoint.
        expect(fetchCalls).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
