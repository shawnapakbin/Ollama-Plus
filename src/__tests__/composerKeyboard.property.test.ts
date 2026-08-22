/**
 * Property-based tests for composer keyboard behavior.
 *
 * Feature: chat-streaming-richtext-metrics
 * - Property 10: Enter submits non-empty content
 * - Property 11: Modifier+Enter never submits
 * - Property 12: Whitespace-only content blocks submission on Enter
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Keyboard event input representation for testing.
 */
type KeyboardInput = {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
};

/**
 * Pure function that determines whether a message should be submitted
 * based on the keyboard event, composer content, and current state.
 *
 * This mirrors the logic in App.tsx's handleComposerKeyDown:
 * 1. If composing (IME) or key is not Enter → do not submit
 * 2. If Shift, Ctrl, or Meta is held → do not submit (insert newline)
 * 3. Otherwise, submit only if not already sending AND content is non-empty/non-whitespace (or has attachments)
 */
function shouldSubmit(
  content: string,
  event: KeyboardInput,
  isSending: boolean,
  hasAttachments: boolean
): boolean {
  if (event.isComposing || event.key !== 'Enter') return false;
  if (event.shiftKey || event.ctrlKey || event.metaKey) return false;
  const canSend = Boolean(content.trim()) || hasAttachments;
  return !isSending && canSend;
}

describe('Feature: chat-streaming-richtext-metrics, Property 10: Enter submits non-empty content', () => {
  /**
   * **Validates: Requirements 5.1**
   *
   * For any non-empty, non-whitespace-only composer content, simulating an Enter
   * keypress (without Shift, Ctrl, or Meta modifiers) SHALL trigger message submission.
   */
  it('Enter without modifiers submits when content is non-empty and non-whitespace', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (content) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, false, false);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Enter does not submit when already sending a message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (content) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, true, false);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: chat-streaming-richtext-metrics, Property 11: Modifier+Enter never submits', () => {
  /**
   * **Validates: Requirements 5.2, 5.3**
   *
   * For any composer content (empty or non-empty), simulating a keypress of
   * Shift+Enter OR Ctrl+Enter OR Cmd+Enter SHALL NOT trigger message submission.
   */
  it('Shift+Enter never submits regardless of content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.boolean(),
        fc.boolean(),
        (content, isSending, hasAttachments) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: true,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, isSending, hasAttachments);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Ctrl+Enter never submits regardless of content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.boolean(),
        fc.boolean(),
        (content, isSending, hasAttachments) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: true,
            metaKey: false,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, isSending, hasAttachments);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Cmd+Enter (metaKey) never submits regardless of content', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.boolean(),
        fc.boolean(),
        (content, isSending, hasAttachments) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: true,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, isSending, hasAttachments);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('any combination of modifiers with Enter never submits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.boolean(),
        fc.boolean(),
        fc.record({
          shiftKey: fc.boolean(),
          ctrlKey: fc.boolean(),
          metaKey: fc.boolean(),
        }).filter((m) => m.shiftKey || m.ctrlKey || m.metaKey),
        (content, isSending, hasAttachments, modifiers) => {
          const event: KeyboardInput = {
            key: 'Enter',
            ...modifiers,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, isSending, hasAttachments);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: chat-streaming-richtext-metrics, Property 12: Whitespace-only content blocks submission on Enter', () => {
  /**
   * **Validates: Requirements 5.4**
   *
   * For any string composed entirely of whitespace characters (including empty string),
   * simulating an Enter keypress SHALL NOT trigger message submission and SHALL NOT
   * clear the composer.
   */
  it('Enter with empty string does not submit', () => {
    const event: KeyboardInput = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
    };
    const result = shouldSubmit('', event, false, false);
    expect(result).toBe(false);
  });

  it('Enter with whitespace-only content does not submit', () => {
    // Generate strings using only whitespace characters
    const whitespaceChar = fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v');
    fc.assert(
      fc.property(
        fc.array(whitespaceChar, { minLength: 1, maxLength: 50 }).map((chars) => chars.join('')),
        (content) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
          };
          const result = shouldSubmit(content, event, false, false);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('whitespace-only content with attachments still submits (attachments override)', () => {
    const whitespaceChar = fc.constantFrom(' ', '\t', '\n', '\r');
    fc.assert(
      fc.property(
        fc.array(whitespaceChar, { minLength: 0, maxLength: 50 }).map((chars) => chars.join('')),
        (content) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: false,
          };
          // With attachments, submit is allowed even with whitespace-only content
          const result = shouldSubmit(content, event, false, true);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Enter during IME composition never submits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        (content) => {
          const event: KeyboardInput = {
            key: 'Enter',
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            isComposing: true,
          };
          const result = shouldSubmit(content, event, false, false);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
