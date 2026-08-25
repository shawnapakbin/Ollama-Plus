/**
 * Property-based tests for sessionTitleDeriver
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 9: Session title derivation
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any first user message in a session, the session title SHALL be derived
 * from the first 60 characters of that message content (trimmed). If the message
 * is shorter than 60 characters, the full message is used. If longer, it is
 * truncated at a word boundary at or before 60 characters with an ellipsis appended.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveSessionTitle } from '../../../src/utils/agent/sessionTitleDeriver';

const MAX_TITLE_LENGTH = 60;
const ELLIPSIS = '...';

describe('sessionTitleDeriver - Property 9: Session title derivation', () => {
  // ─── Property 9a: Output length never exceeds 63 characters (60 + "...") ───

  it('output length never exceeds 63 characters for any input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (message) => {
        const result = deriveSessionTitle(message);
        expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + ELLIPSIS.length);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 9b: Messages <= 60 chars return the trimmed message as-is ────

  it('messages with trimmed length <= 60 return the trimmed message unchanged', () => {
    // Generate strings whose trimmed length is at most 60 characters
    const shortMessageArb = fc.string({ minLength: 1, maxLength: 60 }).filter(
      (s) => s.trim().length > 0 && s.trim().length <= MAX_TITLE_LENGTH
    );

    fc.assert(
      fc.property(shortMessageArb, (message) => {
        const result = deriveSessionTitle(message);
        expect(result).toBe(message.trim());
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 9c: Messages > 60 chars are truncated with ellipsis ──────────

  it('messages with trimmed length > 60 are truncated with ellipsis appended', () => {
    // Generate strings that, once trimmed, exceed 60 characters
    const longMessageArb = fc.string({ minLength: 61, maxLength: 200 }).filter(
      (s) => s.trim().length > MAX_TITLE_LENGTH
    );

    fc.assert(
      fc.property(longMessageArb, (message) => {
        const result = deriveSessionTitle(message);
        // Must end with ellipsis
        expect(result.endsWith(ELLIPSIS)).toBe(true);
        // The content before the ellipsis must be <= 60 chars
        const content = result.slice(0, -ELLIPSIS.length);
        expect(content.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
        // The content must be a prefix of the trimmed message
        expect(message.trim().startsWith(content)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 9d: Output is never empty for non-empty input (after trim) ──

  it('output is never empty for non-whitespace input', () => {
    // Generate strings that have at least one non-whitespace character
    const nonEmptyArb = fc.string({ minLength: 1, maxLength: 200 }).filter(
      (s) => s.trim().length > 0
    );

    fc.assert(
      fc.property(nonEmptyArb, (message) => {
        const result = deriveSessionTitle(message);
        expect(result.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 9e: Truncation respects word boundaries ─────────────────────

  it('truncation occurs at a word boundary (space) when possible', () => {
    // Generate messages with spaces that exceed 60 chars when trimmed
    const longWithSpacesArb = fc
      .array(fc.string({ minLength: 1, maxLength: 15 }).map((s) => s.replace(/\s/g, 'x')), {
        minLength: 5,
        maxLength: 20,
      })
      .map((words) => words.join(' '))
      .filter((s) => s.trim().length > MAX_TITLE_LENGTH && s.trim().includes(' '));

    fc.assert(
      fc.property(longWithSpacesArb, (message) => {
        const trimmed = message.trim();
        const result = deriveSessionTitle(message);

        // Result must end with ellipsis since input exceeds 60 chars
        expect(result.endsWith(ELLIPSIS)).toBe(true);

        const content = result.slice(0, -ELLIPSIS.length);

        // If there's a space within the first 60 chars, the truncation should happen at a space
        const lastSpaceInRange = trimmed.lastIndexOf(' ', MAX_TITLE_LENGTH);
        if (lastSpaceInRange > 0) {
          expect(content).toBe(trimmed.slice(0, lastSpaceInRange));
        } else {
          // No space found: truncate at exactly 60 chars
          expect(content).toBe(trimmed.slice(0, MAX_TITLE_LENGTH));
        }
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 9f: Idempotency - applying to already-derived title ──────────

  it('deriving a title from an already-short result is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (message) => {
        const first = deriveSessionTitle(message);
        const second = deriveSessionTitle(first);
        // The second derivation should return the same result
        // (since any derived title is <= 63 chars, and trimmed titles <= 60 pass through)
        // Unless the first result was exactly 63 chars (60 + ...), it might get truncated differently
        // But a title with "..." at the end is <= 63 chars, so its trimmed length is <= 63
        // If <= 60, it passes through as-is. If 61-63 (only possible if ellipsis was added), it could re-truncate.
        // This property holds for short messages
        if (first.length <= MAX_TITLE_LENGTH) {
          expect(second).toBe(first);
        }
      }),
      { numRuns: 100 }
    );
  });
});
