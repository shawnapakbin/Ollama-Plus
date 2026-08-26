import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 6: One descriptor per registered route.
// For any set of registered routes with distinct server::action keys, listTools
// returns an array whose length equals the number of registered routes, with
// exactly one descriptor per route.

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Non-empty identifier segments for server/action. Exclude ':' so segments
// cannot interact with the routeKey's '::' separator: this property is about
// one-descriptor-per-route counting, and a segment containing ':' would make
// the key->name decomposition (which splits on '::') ambiguous. Round-trip of
// names under adversarial separators is covered separately by Property 7.
const segmentArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes(':'));

// A single route candidate: { server, action }. The descriptor name is composed
// from the lowercased segments (routeKey lowercases both), so distinctness must
// be enforced on the lowercased "server::action" key to avoid Map overwrite.
const routeArb = fc.record({
  server: segmentArb,
  action: segmentArb
});

// A set of routes with keys that are distinct AFTER lowercasing. We dedupe on
// the lowercased key so no two generated routes collide in the routes Map.
const distinctRoutesArb = fc
  .array(routeArb, { minLength: 0, maxLength: 15 })
  .map((routes) => {
    const seen = new Set();
    const unique = [];
    for (const route of routes) {
      const key = `${route.server.toLowerCase()}::${route.action.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(route);
    }
    return unique;
  });

describe('Feature: gateway-list-tools, Property 6: One descriptor per registered route', () => {
  /**
   * **Validates: Requirements 2.2, 2.6**
   *
   * For any set of registered routes with distinct server::action keys,
   * listTools returns an array whose length equals the number of registered
   * routes, with exactly one descriptor per route.
   */
  it('listTools returns exactly one descriptor per registered route (PBT)', () => {
    fc.assert(
      fc.property(distinctRoutesArb, (routes) => {
        const gateway = createGateway();
        for (const { server, action } of routes) {
          gateway.register(server, action, () => 'ok');
        }

        const tools = gateway.listTools();

        // Length equals the number of registered routes.
        expect(tools).toHaveLength(routes.length);

        // Each expected name (composed from lowercased segments) appears
        // exactly once in the returned catalog.
        const nameCounts = new Map();
        for (const tool of tools) {
          nameCounts.set(tool.name, (nameCounts.get(tool.name) || 0) + 1);
        }

        for (const { server, action } of routes) {
          const expectedName = `${server.toLowerCase()}_${action.toLowerCase()}`;
          expect(nameCounts.get(expectedName)).toBe(1);
        }

        // No extra descriptors beyond the registered routes.
        expect(nameCounts.size).toBe(routes.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * An empty gateway returns an empty array from listTools.
   */
  it('empty gateway returns an empty array', () => {
    const gateway = createGateway();
    expect(gateway.listTools()).toEqual([]);
  });
});
