/**
 * Timeline Sorter
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Sorts timeline items (messages, tool-use blocks, reasoning indicators, etc.)
 * into strictly ascending chronological order by their ISO 8601 timestamps.
 * Returns a new array without mutating the input.
 *
 * Requirements: 2.1, 12.2
 */

/**
 * Sorts an array of items with timestamps into strictly ascending chronological order.
 *
 * - Parses each item's `timestamp` field as an ISO 8601 date string
 * - Compares using `new Date(timestamp).getTime()` for numeric ordering
 * - Returns a new array (does not mutate the input)
 * - Items with identical timestamps preserve their relative order (stable sort)
 *
 * @param items - Array of objects that each contain at least a `timestamp` field (ISO 8601 string)
 * @returns A new array sorted in ascending chronological order
 */
export function sortTimeline<T extends { timestamp: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
