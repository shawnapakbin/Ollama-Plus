/**
 * MCP Tools Wiring — Output truncation property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that a successful dispatch truncates the
 * gateway output to at most 10,000 characters, and that the stored output is
 * a prefix of the original gateway output.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createToolDispatcher } from '../../../electron/runtime/agent/toolDispatcher.js';
import { MAX_OUTPUT_LENGTH } from '../../../electron/runtime/agent/outputFormatter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an MCP gateway that resolves the supplied string output. The
 * dispatcher's extractOutput reduces a string result to itself, so the raw
 * output fed to truncation is exactly this string.
 */
function createStringGateway(output: string) {
  return () => Promise.resolve(output);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Output strings of varying lengths, including many well beyond the 10,000
 * character limit so the truncation branch is exercised.
 */
const outputArb = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: MAX_OUTPUT_LENGTH }) },
  {
    weight: 2,
    arbitrary: fc.string({ minLength: MAX_OUTPUT_LENGTH + 1, maxLength: MAX_OUTPUT_LENGTH * 3 })
  }
);

const actionArb = fc.string({ minLength: 1, maxLength: 20 }).map((s) => `a${s}`);

// Feature: mcp-tools-wiring, Property 14: Output truncation to 10,000 characters
describe('Feature: mcp-tools-wiring, Property 14: Output truncation to 10,000 characters', () => {
  /**
   * **Validates: Requirements 8.7**
   *
   * For any tool call output of length L characters, the dispatched record's
   * `output` SHALL have length min(L, 10000) and SHALL be a prefix of the
   * original gateway output.
   */
  it('record output has length min(L, 10000) and is a prefix of the original (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(outputArb, actionArb, async (rawOutput, action) => {
        const dispatcher = createToolDispatcher({
          mcpGateway: createStringGateway(rawOutput)
        });

        const record = await dispatcher.dispatch({ tool: 'terminal', action, params: {} });

        expect(record.status).toBe('success');

        const expectedLength = Math.min(rawOutput.length, MAX_OUTPUT_LENGTH);
        expect(record.output.length).toBe(expectedLength);

        // The stored output must be a prefix of the original gateway output.
        expect(rawOutput.startsWith(record.output)).toBe(true);
        expect(record.output).toBe(rawOutput.slice(0, expectedLength));
      }),
      { numRuns: 100 }
    );
  });
});
