import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  classifyEndpoint,
  normalizeOllamaBaseUrl,
} from '../electron/runtime/ollamaClient.js';

/**
 * Feature: ollama-lifecycle-management
 * Property tests for endpoint classification.
 */

// Feature: ollama-lifecycle-management, Property 2: Endpoint classification is total and stable
describe('Property 2: Endpoint classification is total and stable', () => {
  /**
   * Validates: Requirements 4.2, 5.7, 5.8, 6.3, 6.4
   *
   * For any endpoint string, classifyEndpoint returns exactly one of
   * kind: 'local' | 'remote'; 127.0.0.1/localhost/::1 classify as 'local',
   * all other hosts as 'remote'; and the returned normalizedEndpoint
   * round-trips through normalizeOllamaBaseUrl (it is a fixed point).
   */

  const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

  // Local host forms: bare host, with scheme, with/without port. The IPv6
  // loopback must be bracketed in a URL authority.
  const localEndpointArb = fc
    .record({
      host: fc.constantFrom(...LOCAL_HOSTS),
      scheme: fc.constantFrom('', 'http://', 'https://'),
      port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null }),
    })
    .map(({ host, scheme, port }) => {
      const authorityHost = host === '::1' ? '[::1]' : host;
      const portPart = port === null ? '' : `:${port}`;
      return `${scheme}${authorityHost}${portPart}`;
    });

  // LAN IPs (private ranges) — always remote.
  const lanIpArb = fc
    .oneof(
      fc
        .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
        .map(([c, d]) => `192.168.${c}.${d}`),
      fc
        .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
        .map(([c, d]) => `10.0.${c}.${d}`),
      fc
        .tuple(fc.integer({ min: 16, max: 31 }), fc.integer({ min: 0, max: 255 }))
        .map(([b, c]) => `172.${b}.${c}.1`)
    )
    .chain((ip) =>
      fc
        .record({
          scheme: fc.constantFrom('', 'http://', 'https://'),
          port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null }),
        })
        .map(({ scheme, port }) => {
          const portPart = port === null ? '' : `:${port}`;
          return `${scheme}${ip}${portPart}`;
        })
    );

  // Non-local hostnames (never one of the local host forms).
  const remoteHostnameArb = fc
    .record({
      label: fc
        .string({ minLength: 1, maxLength: 20 })
        .map((s) => s.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((s) => s.length > 0 && !LOCAL_HOSTS.includes(s.toLowerCase())),
      tld: fc.constantFrom('com', 'net', 'org', 'io', 'local', 'internal'),
      scheme: fc.constantFrom('', 'http://', 'https://'),
      port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null }),
    })
    .map(({ label, tld, scheme, port }) => {
      const portPart = port === null ? '' : `:${port}`;
      return `${scheme}${label}.${tld}${portPart}`;
    });

  it('always returns exactly one valid kind for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (endpoint) => {
        const result = classifyEndpoint(endpoint);
        expect(result.kind === 'local' || result.kind === 'remote').toBe(true);
        expect(typeof result.normalizedEndpoint).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('classifies 127.0.0.1 / localhost / ::1 forms as local', () => {
    fc.assert(
      fc.property(localEndpointArb, (endpoint) => {
        const result = classifyEndpoint(endpoint);
        expect(result.kind).toBe('local');
      }),
      { numRuns: 100 }
    );
  });

  it('classifies LAN IPs as remote', () => {
    fc.assert(
      fc.property(lanIpArb, (endpoint) => {
        const result = classifyEndpoint(endpoint);
        expect(result.kind).toBe('remote');
      }),
      { numRuns: 100 }
    );
  });

  it('classifies non-local hostnames as remote', () => {
    fc.assert(
      fc.property(remoteHostnameArb, (endpoint) => {
        const result = classifyEndpoint(endpoint);
        expect(result.kind).toBe('remote');
      }),
      { numRuns: 100 }
    );
  });

  it('produces a normalizedEndpoint that round-trips through normalizeOllamaBaseUrl', () => {
    fc.assert(
      fc.property(
        fc.oneof(localEndpointArb, lanIpArb, remoteHostnameArb, fc.string()),
        (endpoint) => {
          const { normalizedEndpoint } = classifyEndpoint(endpoint);
          // The normalized endpoint is a fixed point: normalizing it again
          // yields the same value.
          expect(normalizeOllamaBaseUrl(normalizedEndpoint)).toBe(normalizedEndpoint);
        }
      ),
      { numRuns: 100 }
    );
  });
});
