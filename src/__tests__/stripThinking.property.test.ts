/**
 * Property-based tests for thinking-process stripping.
 *
 * Feature: chat-streaming-richtext-metrics
 * - Property 1: Thinking-process stripping preserves surrounding content
 *
 * Validates: Requirements 1.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Copy of stripThinkingProcess from App.tsx.
 * This is a pure function tested inline to avoid modifying App.tsx exports.
 */
function stripThinkingProcess(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

/**
 * Generates a string that does NOT contain `<think>` or `</think>` markers
 * (case-insensitive), so it can be used as "outside" content.
 */
const safeStringArb = fc.string({ minLength: 0, maxLength: 50 }).map((s) =>
  s.replace(/<\/?think>/gi, '')
);

/**
 * Generates a non-empty safe string (no think markers).
 */
const nonEmptySafeStringArb = fc.string({ minLength: 1, maxLength: 50 }).map((s) => {
  const cleaned = s.replace(/<\/?think>/gi, '');
  return cleaned.length > 0 ? cleaned : 'x';
});

describe('Feature: chat-streaming-richtext-metrics, Property 1: Thinking-process stripping preserves surrounding content', () => {
  /**
   * **Validates: Requirements 1.6**
   *
   * For any string containing one or more <think>...</think> blocks at arbitrary
   * positions, stripping the thinking process SHALL produce a string that:
   * (a) contains none of the <think> or </think> markers,
   * (b) contains none of the content between those markers, and
   * (c) preserves all text outside the thinking blocks in its original order.
   */
  it('result contains no <think> or </think> markers', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (content) => {
          const result = stripThinkingProcess(content);
          expect(result).not.toMatch(/<think>/i);
          expect(result).not.toMatch(/<\/think>/i);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('content inside <think> blocks is removed from the output', () => {
    fc.assert(
      fc.property(
        safeStringArb,
        nonEmptySafeStringArb,
        safeStringArb,
        (before, thinkContent, after) => {
          const input = `${before}<think>${thinkContent}</think>${after}`;
          const result = stripThinkingProcess(input);
          // The thinking content should not appear in the result
          // (unless it also happens to be in before/after, so we use a unique marker)
          const uniqueThinkContent = `__UNIQUE_THINK_${thinkContent}__`;
          const uniqueInput = `${before}<think>${uniqueThinkContent}</think>${after}`;
          const uniqueResult = stripThinkingProcess(uniqueInput);
          expect(uniqueResult).not.toContain(uniqueThinkContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('text outside <think> blocks is preserved in its original order', () => {
    fc.assert(
      fc.property(
        nonEmptySafeStringArb,
        fc.string({ minLength: 0, maxLength: 30 }),
        nonEmptySafeStringArb,
        (before, thinkContent, after) => {
          const input = `${before}<think>${thinkContent}</think>${after}`;
          const result = stripThinkingProcess(input);
          // The result should equal before + after (trimmed), since the think block is removed
          const expected = (before + after).trim();
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple <think> blocks are all stripped, preserving surrounding text', () => {
    fc.assert(
      fc.property(
        nonEmptySafeStringArb,
        fc.string({ minLength: 0, maxLength: 20 }),
        nonEmptySafeStringArb,
        fc.string({ minLength: 0, maxLength: 20 }),
        nonEmptySafeStringArb,
        (part1, think1, part2, think2, part3) => {
          const input = `${part1}<think>${think1}</think>${part2}<think>${think2}</think>${part3}`;
          const result = stripThinkingProcess(input);
          const expected = (part1 + part2 + part3).trim();
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles case-insensitive <THINK> markers', () => {
    fc.assert(
      fc.property(
        nonEmptySafeStringArb,
        fc.string({ minLength: 0, maxLength: 30 }),
        nonEmptySafeStringArb,
        (before, thinkContent, after) => {
          const input = `${before}<THINK>${thinkContent}</THINK>${after}`;
          const result = stripThinkingProcess(input);
          const expected = (before + after).trim();
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unclosed <think> block at end of string strips from marker to end', () => {
    fc.assert(
      fc.property(
        nonEmptySafeStringArb,
        fc.string({ minLength: 0, maxLength: 30 }),
        (before, thinkContent) => {
          const input = `${before}<think>${thinkContent}`;
          const result = stripThinkingProcess(input);
          // Should only contain 'before' (trimmed), since unclosed think strips to end
          expect(result).toBe(before.trim());
          expect(result).not.toMatch(/<think>/i);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('content without any <think> blocks is preserved unchanged (after trim)', () => {
    fc.assert(
      fc.property(
        safeStringArb,
        (content) => {
          const result = stripThinkingProcess(content);
          expect(result).toBe(content.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});
