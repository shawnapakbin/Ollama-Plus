/**
 * Unit tests for timelineSorter
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests the timeline sorting logic:
 * - Returns items in ascending chronological order
 * - Does not mutate the input array
 * - Handles empty arrays
 * - Handles items with identical timestamps (stable sort)
 * - Works with additional properties on items
 */

import { describe, it, expect } from 'vitest';
import { sortTimeline } from '../../../src/utils/agent/timelineSorter';

describe('sortTimeline', () => {
  it('returns an empty array when given an empty array', () => {
    expect(sortTimeline([])).toEqual([]);
  });

  it('returns a single item unchanged', () => {
    const items = [{ timestamp: '2024-01-01T00:00:00.000Z' }];
    expect(sortTimeline(items)).toEqual(items);
  });

  it('sorts items in ascending chronological order', () => {
    const items = [
      { timestamp: '2024-03-01T12:00:00.000Z' },
      { timestamp: '2024-01-01T00:00:00.000Z' },
      { timestamp: '2024-02-15T06:30:00.000Z' },
    ];
    const sorted = sortTimeline(items);
    expect(sorted).toEqual([
      { timestamp: '2024-01-01T00:00:00.000Z' },
      { timestamp: '2024-02-15T06:30:00.000Z' },
      { timestamp: '2024-03-01T12:00:00.000Z' },
    ]);
  });

  it('does not mutate the input array', () => {
    const items = [
      { timestamp: '2024-03-01T12:00:00.000Z' },
      { timestamp: '2024-01-01T00:00:00.000Z' },
    ];
    const original = [...items];
    sortTimeline(items);
    expect(items).toEqual(original);
  });

  it('preserves additional properties on items', () => {
    const items = [
      { id: 'b', timestamp: '2024-06-15T10:00:00.000Z', type: 'tool-use' as const },
      { id: 'a', timestamp: '2024-06-15T09:00:00.000Z', type: 'reasoning' as const },
    ];
    const sorted = sortTimeline(items);
    expect(sorted[0]).toEqual({ id: 'a', timestamp: '2024-06-15T09:00:00.000Z', type: 'reasoning' });
    expect(sorted[1]).toEqual({ id: 'b', timestamp: '2024-06-15T10:00:00.000Z', type: 'tool-use' });
  });

  it('handles items with identical timestamps (preserves relative order)', () => {
    const items = [
      { id: '1', timestamp: '2024-01-01T00:00:00.000Z' },
      { id: '2', timestamp: '2024-01-01T00:00:00.000Z' },
      { id: '3', timestamp: '2024-01-01T00:00:00.000Z' },
    ];
    const sorted = sortTimeline(items);
    // Stable sort should preserve input order for equal timestamps
    expect(sorted.map((s) => s.id)).toEqual(['1', '2', '3']);
  });

  it('sorts timestamps with sub-second precision', () => {
    const items = [
      { timestamp: '2024-01-01T00:00:00.500Z' },
      { timestamp: '2024-01-01T00:00:00.100Z' },
      { timestamp: '2024-01-01T00:00:00.900Z' },
    ];
    const sorted = sortTimeline(items);
    expect(sorted).toEqual([
      { timestamp: '2024-01-01T00:00:00.100Z' },
      { timestamp: '2024-01-01T00:00:00.500Z' },
      { timestamp: '2024-01-01T00:00:00.900Z' },
    ]);
  });

  it('handles already-sorted input', () => {
    const items = [
      { timestamp: '2024-01-01T00:00:00.000Z' },
      { timestamp: '2024-01-02T00:00:00.000Z' },
      { timestamp: '2024-01-03T00:00:00.000Z' },
    ];
    const sorted = sortTimeline(items);
    expect(sorted).toEqual(items);
  });

  it('handles reverse-sorted input', () => {
    const items = [
      { timestamp: '2024-01-03T00:00:00.000Z' },
      { timestamp: '2024-01-02T00:00:00.000Z' },
      { timestamp: '2024-01-01T00:00:00.000Z' },
    ];
    const sorted = sortTimeline(items);
    expect(sorted).toEqual([
      { timestamp: '2024-01-01T00:00:00.000Z' },
      { timestamp: '2024-01-02T00:00:00.000Z' },
      { timestamp: '2024-01-03T00:00:00.000Z' },
    ]);
  });
});
