// Feature: mcp-tools-wiring, Property 22: Probe reports exactly seven entries
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  assembleProbeShape,
  PROBE_SERVICE_KEYS
} from '../mcp/lib/probeHelpers.mjs';

/**
 * Property 22: Probe reports exactly seven entries
 *
 * For any probe cycle, the Status_Probe result contains exactly seven health
 * entries: one gateway entry plus one entry for each of the browser, terminal,
 * folder, python, openscad, and blender_plate services.
 *
 * `assembleProbeShape` is the pure helper extracted from `electron/main.js`'s
 * `probeMcpServices()`. `electron/main.js` is not importable in unit tests, so
 * we test the helper that pins the seven-entry shape. It performs no I/O and no
 * timing, so its output shape depends only on the supplied entries — and the
 * shape is fixed regardless of those entries' contents.
 *
 * Validates: Requirements 11.1
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// An arbitrary status entry object (the helper does not inspect entry contents).
const entryArb = fc.record(
  {
    ok: fc.boolean(),
    note: fc.string({ maxLength: 220 }),
    executable: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
    activeSessionCount: fc.option(fc.nat(), { nil: undefined })
  },
  { requiredKeys: ['ok'] }
);

// The gateway entry.
const gatewayArb = fc.record({
  ok: fc.boolean(),
  note: fc.string({ maxLength: 220 })
});

// The six per-service entries, one for each canonical service key.
const servicesArb = fc.record({
  browser: entryArb,
  terminal: entryArb,
  folder: entryArb,
  python: entryArb,
  openscad: entryArb,
  blender_plate: entryArb
});

// Arbitrary extra keys that might accidentally be present on the services input.
// They MUST NOT leak into the assembled result.
const extraKeyArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => !(PROBE_SERVICE_KEYS as readonly string[]).includes(s));

const EXPECTED_SERVICE_KEYS = [...PROBE_SERVICE_KEYS].sort();

describe('Feature: mcp-tools-wiring, Property 22: Probe reports exactly seven entries', () => {
  it('assembles exactly one gateway entry plus the six canonical service entries (PBT)', () => {
    fc.assert(
      fc.property(gatewayArb, servicesArb, (gateway, services) => {
        const result = assembleProbeShape(gateway, services);

        // Exactly one gateway entry.
        expect(result).toHaveProperty('gateway');
        expect(result.gateway).toBe(gateway);

        // Exactly six service entries with the canonical keys — no more, no fewer.
        const serviceKeys = Object.keys(result.services).sort();
        expect(serviceKeys).toEqual(EXPECTED_SERVICE_KEYS);
        expect(serviceKeys.length).toBe(6);

        // Total health entries = gateway + services = exactly seven.
        const totalEntries = 1 + Object.keys(result.services).length;
        expect(totalEntries).toBe(7);

        // Each canonical service entry is carried through verbatim.
        for (const key of PROBE_SERVICE_KEYS) {
          expect(result.services[key]).toBe(
            (services as Record<string, unknown>)[key]
          );
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never leaks extra service keys into the seven-entry shape (PBT)', () => {
    fc.assert(
      fc.property(
        gatewayArb,
        servicesArb,
        fc.dictionary(extraKeyArb, entryArb, { maxKeys: 5 }),
        (gateway, services, extras) => {
          // Contaminate the services input with unexpected keys.
          const contaminated = { ...services, ...extras };
          const result = assembleProbeShape(gateway, contaminated);

          // The result still has exactly the six canonical service keys.
          expect(Object.keys(result.services).sort()).toEqual(EXPECTED_SERVICE_KEYS);
          expect(1 + Object.keys(result.services).length).toBe(7);

          // None of the extra keys leaked through.
          for (const extra of Object.keys(extras)) {
            expect(Object.keys(result.services)).not.toContain(extra);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
