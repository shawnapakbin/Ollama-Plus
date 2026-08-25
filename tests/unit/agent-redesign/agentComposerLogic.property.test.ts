/**
 * Property-Based Tests: Agent Composer Logic (Property 1)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-page-redesign, Property 1: Message submission rejects whitespace-only input
 *
 * Validates: Requirements 7.2, 7.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isValidMessage, shouldSubmitOnKeyDown } from '../../../src/utils/agent/agentComposerLogic';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generator for whitespace-only strings using the specified characters:
 * space, tab, newline, carriage return, and non-breaking space.
 */
const whitespaceOnlyArb = fc.array(
  fc.constantFrom(' ', '\t', '\n', '\r', '\u00A0'),
  { minLength: 1, maxLength: 50 }
).map(chars => chars.join(''));

/**
 * Generator for strings containing at least one non-whitespace character.
 * Uses filter to guarantee meaningful content.
 */
const nonWhitespaceArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0
);

/**
 * Generator for non-Enter key names.
 */
const nonEnterKeyArb = fc.constantFrom(
  'a', 'b', 'Shift', 'Control', 'Alt', 'Tab', 'Escape',
  'ArrowUp', 'ArrowDown', 'Backspace', 'Delete', 'Space', ' '
);

// ─── Property 1: Message submission rejects whitespace-only input ────────────

describe('Property 1: Message submission rejects whitespace-only input', () => {
  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * For any string composed entirely of whitespace characters (spaces, tabs,
   * newlines), the Agent Composer SHALL reject submission and the message list
   * SHALL remain unchanged.
   */

  it('rejects all whitespace-only strings', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, (content) => {
        expect(isValidMessage(content)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects the empty string', () => {
    expect(isValidMessage('')).toBe(false);
  });

  it('accepts strings containing at least one non-whitespace character', () => {
    fc.assert(
      fc.property(nonWhitespaceArb, (content) => {
        expect(isValidMessage(content)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function (same input always yields same output)', () => {
    fc.assert(
      fc.property(
        fc.oneof(whitespaceOnlyArb, nonWhitespaceArb, fc.constant('')),
        (content) => {
          const result1 = isValidMessage(content);
          const result2 = isValidMessage(content);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── shouldSubmitOnKeyDown: keyboard submission properties ────────────────────

describe('Property 1 (supplementary): shouldSubmitOnKeyDown keyboard submission', () => {
  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * Enter (without Shift) submits; Shift+Enter allows newline insertion;
   * non-Enter keys never trigger submission.
   */

  it('returns true for Enter without Shift', () => {
    fc.assert(
      fc.property(fc.constant({ key: 'Enter', shiftKey: false }), (e) => {
        expect(shouldSubmitOnKeyDown(e)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('returns false for Enter with Shift (newline insertion)', () => {
    fc.assert(
      fc.property(fc.constant({ key: 'Enter', shiftKey: true }), (e) => {
        expect(shouldSubmitOnKeyDown(e)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('returns false for non-Enter keys regardless of Shift state', () => {
    fc.assert(
      fc.property(
        nonEnterKeyArb,
        fc.boolean(),
        (key, shiftKey) => {
          expect(shouldSubmitOnKeyDown({ key, shiftKey })).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is a pure function (same input always yields same output)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant({ key: 'Enter', shiftKey: false }),
          fc.constant({ key: 'Enter', shiftKey: true }),
          nonEnterKeyArb.chain(key => fc.boolean().map(shiftKey => ({ key, shiftKey })))
        ),
        (e) => {
          const result1 = shouldSubmitOnKeyDown(e);
          const result2 = shouldSubmitOnKeyDown(e);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
