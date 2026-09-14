// Feature: mcp-tools-wiring, Property 4: Route metadata validity
//
// For any route returned by `listTools` after registration, the entry's
// `description` SHALL be a non-empty string and its `parameters` SHALL be an
// object with `type: 'object'`.
//
// This property mirrors how the feature registers its Gateway_Routes in
// electron/main.js: each route supplies a non-empty description string plus a
// JSON-schema `parameters` object. The gateway is responsible for substituting a
// `{ type: 'object', properties: {} }` default whenever the stored `parameters`
// is malformed (missing, null, non-object, or an array). This test therefore
// registers routes with a valid (non-empty) description while feeding the
// gateway arbitrary — including malformed — `parameters`, and asserts that every
// enumerated `listTools` entry is well-formed: a non-empty description and a
// parameters object whose `type` is `'object'`.
//
// Validates: Requirements 1.3

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createGateway } from '../../../mcp/lib/gateway.mjs';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Server/action segments. The gateway lowercases both segments in routeKey and
 * composes the key as `${server}::${action}`; excluding ':' keeps the key
 * unambiguous when listTools splits it back apart. Non-empty (trimmed) so the
 * route is well-formed.
 */
const segmentArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((s) => s.trim().length > 0 && !s.includes(':'));

/**
 * Non-empty description strings — the shape the feature's real route
 * registrations always supply (Requirement 1.3). `register` stores a string
 * description verbatim, so a non-empty input must survive to listTools unchanged.
 */
const descriptionArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

/**
 * A well-formed JSON-schema `parameters` object of `type: 'object'`.
 */
const validParametersArb = fc.record({
  type: fc.constant('object'),
  properties: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 10 }).filter((s) => s.trim().length > 0),
    fc.record({ type: fc.constantFrom('string', 'number', 'boolean') }),
    { minKeys: 0, maxKeys: 4 }
  )
});

/**
 * Malformed `parameters` values. The gateway must substitute the default
 * `{ type: 'object', properties: {} }` for any of these, so the resulting
 * listTools entry still reports `type: 'object'`.
 */
const malformedParametersArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.anything(), { maxLength: 4 })
);

/**
 * Metadata whose `parameters` is either valid or malformed. In every case the
 * gateway must produce a listTools entry with `type: 'object'`.
 */
const parametersArb = fc.oneof(validParametersArb, malformedParametersArb);

/**
 * A single route registration: unique enough server/action segments plus a
 * non-empty description and arbitrary (possibly malformed) parameters.
 */
const registrationArb = fc.record({
  server: segmentArb,
  action: segmentArb,
  description: descriptionArb,
  parameters: parametersArb
});

// ─── Property 4: Route metadata validity ──────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 4: Route metadata validity', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * Register one or more routes with non-empty descriptions and arbitrary
   * (including malformed) parameters, then assert every listTools entry has a
   * non-empty string description and a parameters object with `type: 'object'`.
   */
  it('every listTools entry has a non-empty description and a type:"object" parameters object (PBT)', () => {
    fc.assert(
      fc.property(fc.array(registrationArb, { minLength: 1, maxLength: 8 }), (registrations) => {
        const gateway = createGateway();

        for (const reg of registrations) {
          gateway.register(reg.server, reg.action, () => 'ok', {
            description: reg.description,
            parameters: reg.parameters
          });
        }

        const tools = gateway.listTools();

        // At least one route was registered, so listTools is non-empty. Note
        // that server/action collisions may reduce the count below the number
        // of registrations (routes are keyed by `server::action`), which is
        // fine — the property must hold for every enumerated entry.
        expect(tools.length).toBeGreaterThanOrEqual(1);

        for (const tool of tools) {
          // Description: a non-empty string.
          expect(typeof tool.description).toBe('string');
          expect(tool.description.length).toBeGreaterThan(0);

          // Parameters: an object (not null, not an array) with type 'object'.
          expect(tool.parameters).toBeTypeOf('object');
          expect(tool.parameters).not.toBeNull();
          expect(Array.isArray(tool.parameters)).toBe(false);
          expect(tool.parameters.type).toBe('object');
        }
      }),
      { numRuns: 100 }
    );
  });
});
