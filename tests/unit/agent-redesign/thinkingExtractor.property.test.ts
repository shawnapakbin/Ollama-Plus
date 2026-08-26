/**
 * Property-based tests for thinking block extraction.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 15: Thinking block extraction
 *
 * Validates: Requirements 1.7
 *
 * For any assistant message content containing text wrapped in <think>...</think> tags,
 * the content within the tags SHALL be extracted into a collapsible thinking block
 * (collapsed by default), and the remaining content SHALL be rendered as the main
 * message body without the think tags.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractThinking } from '../../../src/utils/agent/thinkingExtractor';

/**
 * Generates a string that does NOT contain <think> or </think> markers
 * (case-insensitive), ensuring it can be used as content outside think blocks.
 */
const safeStringArb = fc.string({ minLength: 0, maxLength: 60 }).map((s) =>
  s.replace(/<\/?think>/gi, '').replace(/<think/gi, '').replace(/think>/gi, '')
);

/**
 * Generates a non-empty safe string guaranteed to have at least one character
 * after stripping think-related markers.
 */
const nonEmptySafeStringArb = fc.string({ minLength: 1, maxLength: 60 }).map((s) => {
  const cleaned = s.replace(/<\/?think>/gi, '').replace(/<think/gi, '').replace(/think>/gi, '');
  return cleaned.length > 0 ? cleaned : 'x';
});

/**
 * Generates a safe string guaranteed to contain non-whitespace characters
 * after trimming (and free of think markers). Falls back to 'x' when the
 * generated value is blank after cleaning, so a genuine thinking block is
 * always present. The non-trimmed `cleaned` value is returned when non-blank,
 * so surrounding whitespace around genuine content is still possible while
 * guaranteeing `.trim().length > 0`.
 */
const nonBlankSafeStringArb = fc.string({ minLength: 1, maxLength: 60 }).map((s) => {
  const cleaned = s
    .replace(/<\/?think>/gi, '')
    .replace(/<think/gi, '')
    .replace(/think>/gi, '');
  return cleaned.trim().length > 0 ? cleaned : 'x';
});

/**
 * Generates a non-empty string composed solely of whitespace characters
 * (spaces, tabs, newlines, carriage returns). Such a value is non-empty
 * before trimming but empty after trimming, exercising the documented
 * null-for-blank contract of extractThinking.
 */
const whitespaceOnlyArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 })
  .map((chars) => chars.join(''));

describe('Feature: agent-page-redesign, Property 15: Thinking block extraction', () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * For any content with a <think>...</think> block, the extracted thinking content
   * SHALL contain the text from within the tags, and the main content SHALL NOT
   * contain any <think> or </think> markers.
   */
  it('extracts thinking content and removes think tags from main content', () => {
    fc.assert(
      fc.property(
        fc.tuple(safeStringArb, nonBlankSafeStringArb, safeStringArb),
        ([prefix, thinking, suffix]) => {
          const input = `${prefix}<think>${thinking}</think>${suffix}`;
          const result = extractThinking(input);

          // Main content must not contain think tags
          expect(result.mainContent).not.toMatch(/<think>/i);
          expect(result.mainContent).not.toMatch(/<\/think>/i);

          // Thinking content must be extracted (non-null)
          expect(result.thinkingContent).not.toBeNull();

          // The extracted thinking should contain the trimmed thinking text
          expect(result.thinkingContent).toContain(thinking.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * For any content WITHOUT think tags, the main content SHALL be the original
   * content (trimmed) and thinkingContent SHALL be null.
   */
  it('content without think tags returns null thinkingContent and preserved mainContent', () => {
    fc.assert(
      fc.property(
        safeStringArb,
        (content) => {
          const result = extractThinking(content);

          // No think tags means no thinking content extracted
          expect(result.thinkingContent).toBeNull();

          // Main content should be the original trimmed
          expect(result.mainContent).toBe(content.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * For any content with think tags, the text outside the think blocks SHALL
   * be preserved in the main content in its original order.
   */
  it('text outside think blocks is preserved in main content', () => {
    fc.assert(
      fc.property(
        fc.tuple(nonEmptySafeStringArb, safeStringArb, nonEmptySafeStringArb),
        ([prefix, thinking, suffix]) => {
          const input = `${prefix}<think>${thinking}</think>${suffix}`;
          const result = extractThinking(input);

          // The prefix and suffix should appear in main content in order.
          // After trimming the main content, it should contain prefix content
          // and suffix content.
          const mainContent = result.mainContent;
          expect(mainContent).toContain(prefix.trim());
          expect(mainContent).toContain(suffix.trim());

          // Verify ordering: prefix appears before suffix
          if (prefix.trim().length > 0 && suffix.trim().length > 0) {
            const pIdx = mainContent.indexOf(prefix.trim());
            const sIdx = mainContent.indexOf(suffix.trim(), pIdx + prefix.trim().length);
            expect(pIdx).toBeLessThan(sIdx);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * For any content with multiple think blocks, ALL thinking content SHALL be
   * extracted and concatenated, and the main content SHALL contain none of the
   * think block content.
   */
  it('multiple think blocks are all extracted and concatenated', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          safeStringArb,
          nonBlankSafeStringArb,
          safeStringArb,
          nonBlankSafeStringArb,
          safeStringArb
        ),
        ([part1, think1, part2, think2, part3]) => {
          const input = `${part1}<think>${think1}</think>${part2}<think>${think2}</think>${part3}`;
          const result = extractThinking(input);

          // Main content must not contain think tags
          expect(result.mainContent).not.toMatch(/<think>/i);
          expect(result.mainContent).not.toMatch(/<\/think>/i);

          // Both thinking blocks should be extracted
          expect(result.thinkingContent).not.toBeNull();
          expect(result.thinkingContent!).toContain(think1.trim());
          expect(result.thinkingContent!).toContain(think2.trim());

          // Thinking blocks are concatenated with double newline
          const blocks = result.thinkingContent!.split('\n\n');
          expect(blocks.length).toBeGreaterThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * For any content with an empty think block, the thinkingContent SHALL be null
   * (empty blocks are skipped) and main content is preserved.
   */
  it('empty think blocks result in null thinkingContent', () => {
    fc.assert(
      fc.property(
        fc.tuple(nonEmptySafeStringArb, nonEmptySafeStringArb),
        ([prefix, suffix]) => {
          const input = `${prefix}<think></think>${suffix}`;
          const result = extractThinking(input);

          // Empty think block should not produce thinking content
          expect(result.thinkingContent).toBeNull();

          // Main content should still contain the surrounding text
          expect(result.mainContent).toContain(prefix.trim());
          expect(result.mainContent).toContain(suffix.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * For any content with an unclosed <think> tag (no closing </think>),
   * everything after the opening tag SHALL be treated as thinking content,
   * and the main content SHALL only contain text before the tag.
   */
  it('unclosed think tag treats remaining content as thinking', () => {
    fc.assert(
      fc.property(
        fc.tuple(nonBlankSafeStringArb, nonBlankSafeStringArb),
        ([prefix, thinkContent]) => {
          const input = `${prefix}<think>${thinkContent}`;
          const result = extractThinking(input);

          // Main content should be the text before the unclosed tag
          expect(result.mainContent).toBe(prefix.trim());

          // Thinking content should contain the rest
          expect(result.thinkingContent).not.toBeNull();
          expect(result.thinkingContent).toBe(thinkContent.trim());

          // No think tags in main content
          expect(result.mainContent).not.toMatch(/<think>/i);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 3.6**
   *
   * Contract lock-in: for an unclosed <think> tag whose content is whitespace-only
   * (non-empty before trimming, empty after trimming), extractThinking SHALL treat
   * it as "no thinking" — returning thinkingContent as null while mainContent is the
   * trimmed prefix text. This asserts the documented null-for-blank contract as a
   * property rather than leaving it implicit.
   */
  it('unclosed think tag with whitespace-only content yields null thinkingContent', () => {
    fc.assert(
      fc.property(
        fc.tuple(nonBlankSafeStringArb, whitespaceOnlyArb),
        ([prefix, blank]) => {
          const input = `${prefix}<think>${blank}`;
          const result = extractThinking(input);
          expect(result.thinkingContent).toBeNull();
          expect(result.mainContent).toBe(prefix.trim());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * The extraction is case-insensitive: <THINK>, <Think>, <think> all work.
   */
  it('extraction is case-insensitive', () => {
    const caseVariants = fc.constantFrom(
      '<think>', '<THINK>', '<Think>', '<tHiNk>'
    );
    const closingVariants = fc.constantFrom(
      '</think>', '</THINK>', '</Think>', '</tHiNk>'
    );

    fc.assert(
      fc.property(
        fc.tuple(nonEmptySafeStringArb, nonBlankSafeStringArb, nonEmptySafeStringArb, caseVariants, closingVariants),
        ([prefix, thinking, suffix, openTag, closeTag]) => {
          const input = `${prefix}${openTag}${thinking}${closeTag}${suffix}`;
          const result = extractThinking(input);

          // Thinking should be extracted regardless of case
          expect(result.thinkingContent).not.toBeNull();
          expect(result.thinkingContent).toContain(thinking.trim());

          // Main content should not contain the tags
          expect(result.mainContent).not.toMatch(/<think>/i);
          expect(result.mainContent).not.toMatch(/<\/think>/i);
        }
      ),
      { numRuns: 100 }
    );
  });
});
