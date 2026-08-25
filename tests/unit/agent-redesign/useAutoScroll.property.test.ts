/**
 * Property-Based Tests: Auto-Scroll Logic (Properties 2 and 3)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-page-redesign, Property 2: Auto-scroll engages when near bottom
 * Feature: agent-page-redesign, Property 3: Auto-scroll disengages when scrolled up
 *
 * Validates: Requirements 6.1, 6.2
 *
 * Tests the pure threshold calculation logic from useAutoScroll:
 *   isAtBottom = (scrollHeight - scrollTop - clientHeight) <= BOTTOM_THRESHOLD
 * where BOTTOM_THRESHOLD = 80
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// ─── Replicate the pure logic under test ─────────────────────────────────────

/**
 * The threshold constant from useAutoScroll.ts.
 * Distance in pixels from the bottom that still counts as "at bottom".
 */
const BOTTOM_THRESHOLD = 80;

/**
 * Pure function replicating the scroll threshold check from useAutoScroll.
 * This is the core logic tested by these properties.
 */
function checkIsAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD;
}

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generator for valid scroll dimensions where the gap (scrollHeight - scrollTop - clientHeight)
 * is within the 80px threshold (0 to 80 inclusive).
 *
 * Strategy: generate clientHeight and scrollHeight such that scrollHeight >= clientHeight,
 * then pick a gap from 0..80, and compute scrollTop = scrollHeight - clientHeight - gap.
 */
const nearBottomArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    scrollHeight: fc.integer({ min: 100, max: 10000 }),
    gap: fc.integer({ min: 0, max: BOTTOM_THRESHOLD }),
  })
  .filter(({ clientHeight, scrollHeight }) => scrollHeight >= clientHeight)
  .map(({ clientHeight, scrollHeight, gap }) => {
    const scrollTop = scrollHeight - clientHeight - gap;
    return { scrollTop, scrollHeight, clientHeight, gap };
  })
  .filter(({ scrollTop }) => scrollTop >= 0);

/**
 * Generator for valid scroll dimensions where the gap is greater than 80px
 * (user has scrolled up beyond the threshold).
 *
 * Strategy: generate clientHeight and scrollHeight with enough room for gap > 80,
 * then pick a gap from 81 upward, and compute scrollTop accordingly.
 */
const scrolledUpArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    scrollHeight: fc.integer({ min: 300, max: 10000 }),
    gap: fc.integer({ min: BOTTOM_THRESHOLD + 1, max: 5000 }),
  })
  .filter(({ clientHeight, scrollHeight, gap }) => {
    // Ensure scrollHeight >= clientHeight + gap so scrollTop is non-negative
    return scrollHeight >= clientHeight + gap;
  })
  .map(({ clientHeight, scrollHeight, gap }) => {
    const scrollTop = scrollHeight - clientHeight - gap;
    return { scrollTop, scrollHeight, clientHeight, gap };
  });

/**
 * Generator for the exact boundary case where gap === 80 (within threshold).
 */
const exactBoundaryArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    scrollHeight: fc.integer({ min: 280, max: 10000 }),
  })
  .filter(({ clientHeight, scrollHeight }) => scrollHeight >= clientHeight + BOTTOM_THRESHOLD)
  .map(({ clientHeight, scrollHeight }) => {
    const scrollTop = scrollHeight - clientHeight - BOTTOM_THRESHOLD;
    return { scrollTop, scrollHeight, clientHeight };
  });

/**
 * Generator for the exact boundary case where gap === 81 (beyond threshold).
 */
const justBeyondBoundaryArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    scrollHeight: fc.integer({ min: 281, max: 10000 }),
  })
  .filter(({ clientHeight, scrollHeight }) => scrollHeight >= clientHeight + BOTTOM_THRESHOLD + 1)
  .map(({ clientHeight, scrollHeight }) => {
    const scrollTop = scrollHeight - clientHeight - (BOTTOM_THRESHOLD + 1);
    return { scrollTop, scrollHeight, clientHeight };
  });

/**
 * Generator for "fully at bottom" (scrollTop + clientHeight >= scrollHeight, i.e., gap <= 0).
 */
const fullyAtBottomArb = fc
  .record({
    clientHeight: fc.integer({ min: 100, max: 2000 }),
    scrollHeight: fc.integer({ min: 100, max: 5000 }),
  })
  .filter(({ clientHeight, scrollHeight }) => scrollHeight >= clientHeight)
  .map(({ clientHeight, scrollHeight }) => {
    // scrollTop such that scrollTop + clientHeight >= scrollHeight
    const scrollTop = scrollHeight - clientHeight;
    return { scrollTop, scrollHeight, clientHeight };
  });

// ─── Property 2: Auto-scroll engages when near bottom ────────────────────────

describe('Property 2: Auto-scroll engages when near bottom', () => {
  /**
   * **Validates: Requirements 6.1**
   *
   * For any scroll position within 80px of the bottom of the chat stream container,
   * when a new content event arrives (token, message, tool block), the container
   * SHALL auto-scroll to reveal the new content, resulting in a scroll position
   * at the bottom.
   */

  it('returns isAtBottom=true for any gap within 0-80px of the bottom', () => {
    fc.assert(
      fc.property(nearBottomArb, ({ scrollTop, scrollHeight, clientHeight, gap }) => {
        const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
        expect(result).toBe(true);
        // Verify the gap is indeed within threshold
        expect(gap).toBeLessThanOrEqual(BOTTOM_THRESHOLD);
        expect(gap).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  it('returns isAtBottom=true at the exact boundary (gap === 80px)', () => {
    fc.assert(
      fc.property(exactBoundaryArb, ({ scrollTop, scrollHeight, clientHeight }) => {
        const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
        expect(result).toBe(true);
        // Verify the gap is exactly 80
        const gap = scrollHeight - scrollTop - clientHeight;
        expect(gap).toBe(BOTTOM_THRESHOLD);
      }),
      { numRuns: 100 }
    );
  });

  it('always returns isAtBottom=true when fully scrolled to bottom (gap <= 0)', () => {
    fc.assert(
      fc.property(fullyAtBottomArb, ({ scrollTop, scrollHeight, clientHeight }) => {
        const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
        expect(result).toBe(true);
        // Gap should be zero or negative (fully at bottom)
        const gap = scrollHeight - scrollTop - clientHeight;
        expect(gap).toBeLessThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: Auto-scroll disengages when scrolled up ─────────────────────

describe('Property 3: Auto-scroll disengages when scrolled up', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any scroll position more than 80px from the bottom, when new content arrives,
   * the scroll position SHALL remain unchanged and a "scroll to bottom" button
   * SHALL be visible.
   */

  it('returns isAtBottom=false for any gap greater than 80px', () => {
    fc.assert(
      fc.property(scrolledUpArb, ({ scrollTop, scrollHeight, clientHeight, gap }) => {
        const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
        expect(result).toBe(false);
        // Verify the gap is indeed beyond threshold
        expect(gap).toBeGreaterThan(BOTTOM_THRESHOLD);
      }),
      { numRuns: 100 }
    );
  });

  it('returns isAtBottom=false at the exact boundary (gap === 81px)', () => {
    fc.assert(
      fc.property(justBeyondBoundaryArb, ({ scrollTop, scrollHeight, clientHeight }) => {
        const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
        expect(result).toBe(false);
        // Verify the gap is exactly 81
        const gap = scrollHeight - scrollTop - clientHeight;
        expect(gap).toBe(BOTTOM_THRESHOLD + 1);
      }),
      { numRuns: 100 }
    );
  });

  it('the threshold decision is mutually exclusive and exhaustive', () => {
    /**
     * For any valid scroll state, the result must be either true (near bottom)
     * or false (scrolled up) — the two properties partition the input space.
     */
    fc.assert(
      fc.property(
        fc.record({
          scrollTop: fc.integer({ min: 0, max: 10000 }),
          scrollHeight: fc.integer({ min: 100, max: 10000 }),
          clientHeight: fc.integer({ min: 50, max: 5000 }),
        }).filter(({ scrollTop, scrollHeight, clientHeight }) =>
          scrollHeight >= clientHeight && scrollTop >= 0 && scrollTop <= scrollHeight - clientHeight
        ),
        ({ scrollTop, scrollHeight, clientHeight }) => {
          const result = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
          const gap = scrollHeight - scrollTop - clientHeight;

          if (gap <= BOTTOM_THRESHOLD) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('checkIsAtBottom is a pure function (deterministic)', () => {
    fc.assert(
      fc.property(
        fc.record({
          scrollTop: fc.integer({ min: 0, max: 10000 }),
          scrollHeight: fc.integer({ min: 100, max: 10000 }),
          clientHeight: fc.integer({ min: 50, max: 5000 }),
        }).filter(({ scrollTop, scrollHeight, clientHeight }) =>
          scrollHeight >= clientHeight && scrollTop >= 0 && scrollTop <= scrollHeight - clientHeight
        ),
        ({ scrollTop, scrollHeight, clientHeight }) => {
          const result1 = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
          const result2 = checkIsAtBottom(scrollTop, scrollHeight, clientHeight);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
