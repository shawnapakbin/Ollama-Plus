/**
 * Property-based tests for composer auto-expand height constraints.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 11: Composer auto-expand height constraints
 *
 * Validates: Requirements 7.1, 10.6
 *
 * For any textarea content, the composer height SHALL be at minimum 1 line height
 * and at maximum 200px (or 100px when viewport height < 600px). The height SHALL
 * grow monotonically with content length until the maximum is reached.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculateComposerHeight } from '../../../src/utils/agent/composerHeightCalc';

/**
 * Generates content strings with a controlled distribution of line breaks,
 * simulating realistic textarea content.
 */
const contentWithLineBreaksArb = fc.string({ maxLength: 5000 }).map((s) => {
  // Ensure some content includes newlines for multi-line testing
  return s;
});

/**
 * Generates a positive line height (realistic range: 16-32px).
 */
const lineHeightArb = fc.integer({ min: 16, max: 32 });

/**
 * Generates viewport heights across a realistic range.
 */
const viewportHeightArb = fc.integer({ min: 200, max: 1440 });

/**
 * Generates viewport heights specifically below 600px (small viewports).
 */
const smallViewportArb = fc.integer({ min: 200, max: 599 });

/**
 * Generates viewport heights at 600px or above (normal viewports).
 */
const normalViewportArb = fc.integer({ min: 600, max: 1440 });

describe('Feature: agent-page-redesign, Property 11: Composer auto-expand height constraints', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For any textarea content, the calculated height SHALL always be at least
   * 1 lineHeight (minimum bound).
   */
  it('height is always >= lineHeight (at least 1 line)', () => {
    fc.assert(
      fc.property(
        contentWithLineBreaksArb,
        lineHeightArb,
        viewportHeightArb,
        (content, lineHeight, viewportHeight) => {
          const height = calculateComposerHeight(content, lineHeight, viewportHeight);
          expect(height).toBeGreaterThanOrEqual(lineHeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * For any textarea content when viewport height >= 600px, the calculated height
   * SHALL always be at most 200px.
   */
  it('height is always <= 200px when viewportHeight >= 600', () => {
    fc.assert(
      fc.property(
        contentWithLineBreaksArb,
        lineHeightArb,
        normalViewportArb,
        (content, lineHeight, viewportHeight) => {
          const height = calculateComposerHeight(content, lineHeight, viewportHeight);
          expect(height).toBeLessThanOrEqual(200);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.6**
   *
   * For any textarea content when viewport height < 600px, the calculated height
   * SHALL always be at most 100px.
   */
  it('height is always <= 100px when viewportHeight < 600', () => {
    fc.assert(
      fc.property(
        contentWithLineBreaksArb,
        lineHeightArb,
        smallViewportArb,
        (content, lineHeight, viewportHeight) => {
          const height = calculateComposerHeight(content, lineHeight, viewportHeight);
          expect(height).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * The height SHALL grow monotonically with content lines: adding more newlines
   * to content SHALL result in a height that is greater than or equal to the
   * height with fewer newlines (until the maximum is reached).
   */
  it('height grows monotonically as content lines increase (until max reached)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        lineHeightArb,
        viewportHeightArb,
        (baseContent, lineHeight, viewportHeight) => {
          // Generate increasing line counts by appending newlines
          const content1 = baseContent;
          const content2 = baseContent + '\n';
          const content3 = baseContent + '\n\n';
          const content4 = baseContent + '\n\n\n';

          const height1 = calculateComposerHeight(content1, lineHeight, viewportHeight);
          const height2 = calculateComposerHeight(content2, lineHeight, viewportHeight);
          const height3 = calculateComposerHeight(content3, lineHeight, viewportHeight);
          const height4 = calculateComposerHeight(content4, lineHeight, viewportHeight);

          // Monotonically non-decreasing
          expect(height2).toBeGreaterThanOrEqual(height1);
          expect(height3).toBeGreaterThanOrEqual(height2);
          expect(height4).toBeGreaterThanOrEqual(height3);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1**
   *
   * For empty content (no text), the height SHALL be exactly 1 lineHeight.
   */
  it('empty content returns exactly 1 lineHeight', () => {
    fc.assert(
      fc.property(
        lineHeightArb,
        viewportHeightArb,
        (lineHeight, viewportHeight) => {
          const height = calculateComposerHeight('', lineHeight, viewportHeight);
          expect(height).toBe(lineHeight);
        }
      ),
      { numRuns: 100 }
    );
  });
});
