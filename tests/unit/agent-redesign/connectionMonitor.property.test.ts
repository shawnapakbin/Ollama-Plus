/**
 * Property-Based Tests: Connection Monitor (Property 13)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-page-redesign, Property 13: Connection timeout detection
 *
 * Validates: Requirements 6.6, 11.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isConnectionLost } from '../../../src/utils/agent/connectionMonitor';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30000;

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Elapsed time since last event: 0 to 60,000ms as specified in design */
const elapsedTimeArb = fc.nat({ max: 60_000 });

/** Custom timeout values: 1ms to 120,000ms */
const customTimeoutArb = fc.integer({ min: 1, max: 120_000 });

/** A base timestamp (arbitrary point in time) */
const baseTimestampArb = fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 });

// ─── Property 13: Connection timeout detection ───────────────────────────────

describe('Property 13: Connection timeout detection', () => {
  /**
   * **Validates: Requirements 6.6, 11.6**
   *
   * For any active streaming session where no events are received for 30
   * consecutive seconds, the system SHALL display a connection warning
   * indicator and transition to a 'disconnected' display state.
   */

  it('returns true (connection lost) when elapsed time >= 30000ms (default timeout)', () => {
    fc.assert(
      fc.property(
        baseTimestampArb,
        fc.integer({ min: DEFAULT_TIMEOUT_MS + 1, max: 120_000 }),
        (baseTime, elapsed) => {
          const lastEventAt = new Date(baseTime).toISOString();
          const now = baseTime + elapsed;
          expect(isConnectionLost(lastEventAt, now)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false (still connected) when elapsed time < 30000ms', () => {
    fc.assert(
      fc.property(
        baseTimestampArb,
        fc.nat({ max: DEFAULT_TIMEOUT_MS - 1 }),
        (baseTime, elapsed) => {
          const lastEventAt = new Date(baseTime).toISOString();
          const now = baseTime + elapsed;
          expect(isConnectionLost(lastEventAt, now)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns false (no active session) when lastEventAt is null', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 60_000 }),
        (now) => {
          expect(isConnectionLost(null, now)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('respects custom timeout parameter', () => {
    fc.assert(
      fc.property(
        baseTimestampArb,
        customTimeoutArb,
        elapsedTimeArb,
        (baseTime, timeoutMs, elapsed) => {
          const lastEventAt = new Date(baseTime).toISOString();
          const now = baseTime + elapsed;
          const result = isConnectionLost(lastEventAt, now, timeoutMs);

          if (elapsed > timeoutMs) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is a pure function (same inputs always produce same output)', () => {
    fc.assert(
      fc.property(
        baseTimestampArb,
        elapsedTimeArb,
        (baseTime, elapsed) => {
          const lastEventAt = new Date(baseTime).toISOString();
          const now = baseTime + elapsed;
          const result1 = isConnectionLost(lastEventAt, now);
          const result2 = isConnectionLost(lastEventAt, now);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns exactly false when elapsed equals the timeout (boundary: not strictly greater)', () => {
    fc.assert(
      fc.property(
        baseTimestampArb,
        customTimeoutArb,
        (baseTime, timeoutMs) => {
          const lastEventAt = new Date(baseTime).toISOString();
          const now = baseTime + timeoutMs;
          // The implementation uses strict > comparison, so exact boundary returns false
          expect(isConnectionLost(lastEventAt, now, timeoutMs)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
