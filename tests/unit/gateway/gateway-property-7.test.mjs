import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools, Property 7: Names round-trip through the
// Tool_Name_Convention. For any registered route whose server segment contains
// no underscore, splitting the descriptor's name on its first underscore
// recovers a server and action that match the route that produced it.

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// The server segment must contain NO underscore so that splitting the composed
// name on the FIRST underscore recovers the server exactly. It must also be
// non-empty after lowercasing (routeKey lowercases both segments). We filter
// out any string whose lowercased form is empty or contains an underscore. We
// also exclude ':' so the segment cannot interact with the routeKey's '::'
// separator, which would make the key->name decomposition ambiguous.
const serverArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => {
  const lower = s.toLowerCase();
  return lower.length > 0 && !lower.includes('_') && !s.includes(':');
});

// The action segment may contain underscores; it is preserved as the remainder
// after the first underscore split. It must be non-empty after lowercasing. We
// exclude ':' so the segment cannot interact with the routeKey's '::' separator.
const actionArb = fc.string({ minLength: 1, maxLength: 30 }).filter(
  (s) => s.toLowerCase().length > 0 && !s.includes(':')
);

describe('Feature: gateway-list-tools, Property 7: Names round-trip through the Tool_Name_Convention', () => {
  /**
   * **Validates: Requirements 2.3, 2.8**
   *
   * For any registered route whose server segment contains no underscore,
   * splitting the descriptor's name on its first underscore recovers a server
   * and action that match the (lowercased) route that produced it.
   */
  it('descriptor name splits on the first underscore back into the route server/action (PBT)', () => {
    fc.assert(
      fc.property(serverArb, actionArb, (server, action) => {
        const gateway = createGateway();
        gateway.register(server, action, () => 'ok');

        // routeKey lowercases both segments, so the descriptor name is composed
        // from the lowercased server/action.
        const expectedServer = server.toLowerCase();
        const expectedAction = action.toLowerCase();
        const expectedName = `${expectedServer}_${expectedAction}`;

        const tools = gateway.listTools();
        const descriptor = tools.find((t) => t.name === expectedName);

        expect(descriptor).toBeDefined();

        // Recover server/action the way the Tool_Name_Convention does: split on
        // the FIRST underscore.
        const idx = descriptor.name.indexOf('_');
        const recoveredServer = descriptor.name.slice(0, idx);
        const recoveredAction = descriptor.name.slice(idx + 1);

        expect(recoveredServer).toBe(expectedServer);
        expect(recoveredAction).toBe(expectedAction);
      }),
      { numRuns: 100 }
    );
  });
});
