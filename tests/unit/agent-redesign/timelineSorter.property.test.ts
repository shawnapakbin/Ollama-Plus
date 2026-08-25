/**
 * Property-Based Tests: Timeline Sorter (Property 14)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 14: Chat timeline chronological ordering
 *
 * Validates: Requirements 2.1, 12.2
 *
 * For any set of chat messages and timeline events in a session, they SHALL be
 * rendered in strictly ascending chronological order by their timestamps. No
 * event SHALL appear before an event with an earlier timestamp.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sortTimeline } from '../../../src/utils/agent/timelineSorter';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generates a valid ISO 8601 timestamp from a constrained integer (milliseconds since epoch).
 * Uses integer range to avoid Invalid Date issues with fc.date().
 */
const timestampArb = fc.integer({
  min: 946684800000,  // 2000-01-01T00:00:00.000Z
  max: 1924991999999, // 2030-12-31T23:59:59.999Z
}).map(ms => new Date(ms).toISOString());

/**
 * Generates a timeline item with a random ISO 8601 timestamp.
 */
const timelineItemArb = fc.record({
  timestamp: timestampArb,
});

/**
 * Generates an array of timeline items with random timestamps.
 */
const timelineArrayArb = fc.array(timelineItemArb, { minLength: 0, maxLength: 50 });

/**
 * Generates a timeline item with additional properties to test generic behavior.
 */
const richTimelineItemArb = fc.record({
  id: fc.uuid(),
  timestamp: timestampArb,
  type: fc.constantFrom('message', 'tool-use', 'reasoning', 'approval-gate'),
});

const richTimelineArrayArb = fc.array(richTimelineItemArb, { minLength: 0, maxLength: 50 });

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Checks if an array of items is in ascending chronological order.
 * Items with equal timestamps are allowed (stable sort).
 */
function isAscendingOrder<T extends { timestamp: string }>(items: T[]): boolean {
  for (let i = 1; i < items.length; i++) {
    const prevTime = new Date(items[i - 1].timestamp).getTime();
    const currTime = new Date(items[i].timestamp).getTime();
    if (currTime < prevTime) {
      return false;
    }
  }
  return true;
}

// ─── Property 14: Chat timeline chronological ordering ───────────────────────

describe('Property 14: Chat timeline chronological ordering', () => {
  /**
   * **Validates: Requirements 2.1, 12.2**
   *
   * For any set of chat messages and timeline events in a session, they SHALL
   * be rendered in strictly ascending chronological order by their timestamps.
   */

  it('output is always in ascending chronological order (each timestamp >= previous)', () => {
    fc.assert(
      fc.property(
        timelineArrayArb,
        (items) => {
          const sorted = sortTimeline(items);
          expect(isAscendingOrder(sorted)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('output contains the same number of items as input', () => {
    fc.assert(
      fc.property(
        timelineArrayArb,
        (items) => {
          const sorted = sortTimeline(items);
          expect(sorted.length).toBe(items.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('output contains the same items as input (no items lost or added)', () => {
    fc.assert(
      fc.property(
        richTimelineArrayArb,
        (items) => {
          const sorted = sortTimeline(items);

          // Every input item should appear in the output
          const inputIds = items.map(i => i.id).sort();
          const outputIds = sorted.map(i => i.id).sort();
          expect(outputIds).toEqual(inputIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sorting is idempotent (sorting a sorted array returns the same array)', () => {
    fc.assert(
      fc.property(
        timelineArrayArb,
        (items) => {
          const sorted = sortTimeline(items);
          const sortedAgain = sortTimeline(sorted);
          expect(sortedAgain).toEqual(sorted);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty input returns empty output', () => {
    const result = sortTimeline([]);
    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });

  it('does not mutate the original input array', () => {
    fc.assert(
      fc.property(
        timelineArrayArb,
        (items) => {
          const originalCopy = items.map(i => ({ ...i }));
          sortTimeline(items);
          expect(items).toEqual(originalCopy);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves additional properties on items through sorting', () => {
    fc.assert(
      fc.property(
        richTimelineArrayArb,
        (items) => {
          const sorted = sortTimeline(items);

          // Every item in the output should have all its original properties intact
          for (const sortedItem of sorted) {
            const original = items.find(i => i.id === sortedItem.id);
            expect(original).toBeDefined();
            expect(sortedItem.timestamp).toBe(original!.timestamp);
            expect(sortedItem.type).toBe(original!.type);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
