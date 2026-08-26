import { describe, expect, it, vi } from 'vitest';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// Feature: gateway-list-tools — Task 2.11
// Example / edge-case unit tests for metadata-aware `register` and `listTools`.
// These complement the property-based suites (Properties 1–10) with concrete
// base-case and edge-case assertions.
//
// Covered acceptance criteria:
//   - Req 1.1: `register` accepts an optional 4th Tool_Metadata argument.
//   - Req 2.1: the gateway exposes a `listTools` method.
//   - Req 2.6: `listTools` on a fresh gateway returns [].
//   - Req 6.2: malformed stored metadata is logged once (via the injected
//              logger) while a default descriptor is still returned.

const DEFAULT_PARAMETERS = { type: 'object', properties: {} };

describe('Feature: gateway-list-tools — register / listTools example + edge cases', () => {
  // ─── Req 1.1: register accepts a 4th metadata argument without throwing ─────
  it('register accepts a 4th Tool_Metadata argument without throwing (Req 1.1)', () => {
    const gateway = createGateway();

    expect(() => {
      gateway.register('browser', 'list_sessions', () => 'ok', {
        description: 'List active browser sessions.',
        parameters: { type: 'object', properties: {} }
      });
    }).not.toThrow();

    // The metadata is stored and surfaced through listTools.
    const tools = gateway.listTools();
    const descriptor = tools.find((t) => t.name === 'browser_list_sessions');
    expect(descriptor).toBeDefined();
    expect(descriptor.description).toBe('List active browser sessions.');
    expect(descriptor.parameters).toEqual({ type: 'object', properties: {} });
  });

  it('register still works when the 4th argument is omitted (Req 1.1 / additive)', () => {
    const gateway = createGateway();

    expect(() => {
      gateway.register('browser', 'action', () => 'ok');
    }).not.toThrow();

    const descriptor = gateway
      .listTools()
      .find((t) => t.name === 'browser_action');
    expect(descriptor).toBeDefined();
    expect(descriptor.description).toBe('');
    expect(descriptor.parameters).toEqual(DEFAULT_PARAMETERS);
  });

  // ─── Req 2.1: listTools is a function on the returned interface ─────────────
  it('exposes listTools as a function on the gateway interface (Req 2.1)', () => {
    const gateway = createGateway();
    expect(typeof gateway.listTools).toBe('function');
  });

  // ─── Req 2.6: a fresh gateway enumerates to an empty array ──────────────────
  it('listTools() on a fresh gateway returns [] (Req 2.6)', () => {
    const gateway = createGateway();
    const tools = gateway.listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toEqual([]);
  });

  // ─── Req 6.2: malformed stored metadata is logged once + default returned ───
  //
  // `register` normalizes metadata before storage, so a malformed value cannot
  // be stored through the ordinary object path — which means `listTools`' own
  // defensive logging branch is unreachable via a plain metadata object.
  //
  // To exercise the branch AS IMPLEMENTED we construct a stored entry that is
  // genuinely malformed. `register` reads `meta.parameters` several times while
  // validating it and then stores the value from its final read:
  //
  //   const parameters = meta.parameters                    // read #1
  //     && typeof meta.parameters === 'object'              // read #2
  //     && !Array.isArray(meta.parameters)                  // read #3
  //     ? meta.parameters                                    // read #4 -> STORED
  //     : { type: 'object', properties: {} };
  //
  // A `parameters` getter that returns a valid object for the guard reads but a
  // malformed value (null) on the final read passes validation yet stores a
  // malformed `parameters`. `listTools` then hits its defensive default and
  // logs exactly once for that route, which is the behavior Req 6.2 specifies.
  it('logs malformed stored metadata once via the injected logger and still returns a default descriptor (Req 6.2)', () => {
    const logger = { warn: vi.fn() };
    const gateway = createGateway({ logger });

    // Getter that survives register's validation reads but stores null.
    let readCount = 0;
    const malformedMetadata = {
      description: 'valid description',
      get parameters() {
        readCount += 1;
        // The final read inside register (read #4) is the one whose value is
        // stored; return a valid object for the earlier guard reads and a
        // malformed value on/after that final read so the STORED value is null.
        return readCount >= 4 ? null : { type: 'object', properties: {} };
      }
    };

    gateway.register('browser', 'create_session', () => 'ok', malformedMetadata);

    // Enumerate — this must not throw and must substitute defaults.
    const tools = gateway.listTools();
    const descriptor = tools.find((t) => t.name === 'browser_create_session');

    expect(descriptor).toBeDefined();
    // Default parameters substituted for the malformed stored value.
    expect(descriptor.parameters).toEqual(DEFAULT_PARAMETERS);
    // Descriptor is well-formed (exactly the three public keys, no handler).
    expect(Object.keys(descriptor).sort()).toEqual([
      'description',
      'name',
      'parameters'
    ]);

    // The injected logger's warn was called exactly once for the offending
    // route (Req 6.2).
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, detail] = logger.warn.mock.calls[0];
    expect(typeof message).toBe('string');
    expect(detail).toMatchObject({ route: 'browser::create_session' });

    // Subsequent enumerations do NOT re-log the same offending route (logged
    // once), and continue to return a valid default descriptor.
    const toolsAgain = gateway.listTools();
    const descriptorAgain = toolsAgain.find(
      (t) => t.name === 'browser_create_session'
    );
    expect(descriptorAgain).toBeDefined();
    expect(descriptorAgain.parameters).toEqual(DEFAULT_PARAMETERS);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
