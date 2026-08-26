/**
 * Property-Based Test for toolOutputFormatter
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 5: Tool output truncation at 10 lines
 *
 * **Validates: Requirements 2.5**
 *
 * Property: For any tool output string with N newline-separated lines where N > 10,
 * the collapsed view SHALL display exactly 10 lines, and expanding SHALL reveal all N lines.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatToolOutput } from '../../../src/utils/agent/toolOutputFormatter';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a tool output string with more than 10 lines (11-500 lines) */
const overflowOutputArb = fc
  .array(fc.string(), { minLength: 11, maxLength: 500 })
  .map(lines => lines.join('\n'));

/** Generates a tool output string with 10 or fewer lines (1-10 lines) */
const nonOverflowOutputArb = fc
  .array(fc.string(), { minLength: 1, maxLength: 10 })
  .map(lines => lines.join('\n'));

/** Generates a tool output with a parameterized line count exceeding a given maxLines */
const parameterizedOverflowArb = fc.integer({ min: 2, max: 100 }).chain(maxLines =>
  fc.tuple(
    fc.constant(maxLines),
    fc.array(fc.string(), { minLength: maxLines + 1, maxLength: maxLines + 200 })
      .map(lines => lines.join('\n'))
  )
);

// ─── Property-Based Tests: Property 5 ───────────────────────────────────────

describe('toolOutputFormatter - Property 5: Tool output truncation at 10 lines', () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * For any tool output string with N newline-separated lines where N > 10,
   * the collapsed view SHALL display exactly 10 lines, and expanding SHALL
   * reveal all N lines.
   */

  // ─── Property 5a: Overflow outputs produce exactly 10 truncated lines ───────

  it('outputs with > 10 lines produce exactly 10 lines in truncated result', () => {
    fc.assert(
      fc.property(overflowOutputArb, (output) => {
        const result = formatToolOutput(output);
        const truncatedLines = result.truncated.split('\n');
        expect(truncatedLines).toHaveLength(10);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 5b: Overflow outputs set isOverflow to true ───────────────────

  it('outputs with > 10 lines set isOverflow to true', () => {
    fc.assert(
      fc.property(overflowOutputArb, (output) => {
        const result = formatToolOutput(output);
        expect(result.isOverflow).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 5c: totalLines equals actual line count for overflow ──────────

  it('totalLines equals the actual number of newline-separated lines for overflow outputs', () => {
    fc.assert(
      fc.property(overflowOutputArb, (output) => {
        const result = formatToolOutput(output);
        const actualLines = output.split('\n').length;
        expect(result.totalLines).toBe(actualLines);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 5d: Non-overflow outputs return original content unchanged ────

  it('outputs with <= 10 lines return the original content unchanged', () => {
    fc.assert(
      fc.property(nonOverflowOutputArb, (output) => {
        const result = formatToolOutput(output);
        expect(result.truncated).toBe(output);
        expect(result.isOverflow).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 5e: totalLines always equals line count regardless of overflow ─

  it('totalLines always equals the number of newline-separated lines in any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(overflowOutputArb, nonOverflowOutputArb),
        (output) => {
          const result = formatToolOutput(output);
          const actualLines = output.split('\n').length;
          expect(result.totalLines).toBe(actualLines);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 5f: Truncated content is a prefix of the original ─────────────

  it('truncated output is always a prefix of the original output', () => {
    fc.assert(
      fc.property(overflowOutputArb, (output) => {
        const result = formatToolOutput(output);
        expect(output.startsWith(result.truncated)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 5g: Custom maxLines parameter is respected ────────────────────

  it('respects custom maxLines parameter for truncation', () => {
    fc.assert(
      fc.property(parameterizedOverflowArb, ([maxLines, output]) => {
        const result = formatToolOutput(output, maxLines);
        const truncatedLines = result.truncated.split('\n');
        expect(truncatedLines).toHaveLength(maxLines);
        expect(result.isOverflow).toBe(true);
        expect(result.totalLines).toBe(output.split('\n').length);
      }),
      { numRuns: 100 }
    );
  });
});
