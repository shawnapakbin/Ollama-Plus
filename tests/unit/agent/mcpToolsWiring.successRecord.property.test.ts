/**
 * MCP Tools Wiring — Success record shape property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that a succeeding dispatch yields a record
 * carrying every required field, `status` equal to `success`, and `error`
 * equal to null — never simultaneously indicating both success and error.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an MCP gateway that always resolves successfully with the supplied
 * output, driving the dispatcher down its success path.
 */
function createResolvingGateway(output: unknown) {
  return () => Promise.resolve(output);
}

/** The fields every ToolCallRecord must carry, per Requirement 8.1. */
const REQUIRED_FIELDS = [
  'id',
  'tool',
  'server',
  'action',
  'params',
  'output',
  'status',
  'error',
  'duration',
  'startedAt',
  'completedAt'
] as const;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Every category present in TOOL_SERVER_MAP so the tool call resolves to a
 * mapped server without an explicit override.
 */
const categoryArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

/** A non-empty action string, matching how the dispatcher builds a request. */
const actionArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0);

/** Arbitrary params object passed through to the gateway payload. */
const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

/**
 * A gateway output that resolves to a string via the dispatcher's extractor:
 * a bare string, or an object carrying a string in a recognized field.
 */
const outputArb = fc.oneof(
  fc.string({ maxLength: 200 }),
  fc.record({ data: fc.string({ maxLength: 200 }) }),
  fc.record({ output: fc.string({ maxLength: 200 }) }),
  fc.record({ result: fc.string({ maxLength: 200 }) })
);

// Feature: mcp-tools-wiring, Property 12: Success record shape
describe('Feature: mcp-tools-wiring, Property 12: Success record shape', () => {
  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For any dispatch whose gateway call resolves successfully, the returned
   * record SHALL carry every required field, SHALL set `status` to `success`,
   * and SHALL set `error` to null — never simultaneously indicating both a
   * success and an error.
   */
  it('a succeeding dispatch yields a complete success record with null error (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(categoryArb, actionArb, paramsArb, outputArb, async (tool, action, params, output) => {
        const dispatcher = createToolDispatcher({
          mcpGateway: createResolvingGateway(output)
        });

        const record = await dispatcher.dispatch({ tool, action, params });

        // Every required field is present on the record.
        for (const field of REQUIRED_FIELDS) {
          expect(record).toHaveProperty(field);
        }

        // The outcome maps to success with no error — never both.
        expect(record.status).toBe('success');
        expect(record.error).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
