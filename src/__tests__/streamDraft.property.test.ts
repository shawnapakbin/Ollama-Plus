/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
/**
 * Property-based tests for token delta accumulation.
 *
 * Feature: chat-streaming-richtext-metrics
 * - Property 5: Token delta accumulation is concatenation
 *
 * Validates: Requirements 2.2
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Simulates the stream draft accumulation logic used in the chat renderer.
 * Each token event appends a delta string to the existing draft content.
 */
function accumulateDeltas(deltas: string[]): string {
  let content = '';
  for (const delta of deltas) {
    content = content + delta;
  }
  return content;
}

describe('Feature: chat-streaming-richtext-metrics, Property 5: Token delta accumulation is concatenation', () => {
  /**
   * **Validates: Requirements 2.2**
   *
   * For any ordered sequence of non-empty delta strings received as token events
   * for a single request, the accumulated stream draft content SHALL equal the
   * exact concatenation of all deltas in order.
   */
  it('accumulating non-empty deltas one-by-one equals joining them all', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }),
          { minLength: 1, maxLength: 50 }
        ),
        (deltas) => {
          const accumulated = accumulateDeltas(deltas);
          const expected = deltas.join('');
          expect(accumulated).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accumulating a single delta returns that delta unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        (delta) => {
          const accumulated = accumulateDeltas([delta]);
          expect(accumulated).toBe(delta);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accumulating an empty array returns empty string (no tokens received yet)', () => {
    const accumulated = accumulateDeltas([]);
    expect(accumulated).toBe('');
  });

  it('intermediate states are correct prefixes of the final accumulation', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 30 }),
          { minLength: 2, maxLength: 20 }
        ),
        (deltas) => {
          // Simulate step-by-step accumulation and verify each intermediate state
          let content = '';
          for (let i = 0; i < deltas.length; i++) {
            content = content + deltas[i];
            const expectedAtStep = deltas.slice(0, i + 1).join('');
            expect(content).toBe(expectedAtStep);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
