import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  composeCombinedContent,
  composeSystemMessage
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Property-based tests for the Combined_System_Message composition helpers in
 * agentChatHandlers.js.
 *
 * NOTE: This file is shared with task 2.3 (Property 5). Only the Property 4
 * describe/test block below belongs to task 2.2 — do not remove other blocks.
 */

// ─── Generators ──────────────────────────────────────────────────────────────

/** A user/assistant transcript entry. */
const transcriptEntry = fc.record({
  role: fc.constantFrom('user', 'assistant'),
  content: fc.string()
});

/** A base transcript of user/assistant messages only. */
const baseTranscript = fc.array(transcriptEntry, { maxLength: 12 });

/**
 * Arbitrary prompt strings, biased to also cover whitespace-only and
 * blank-string edge cases (which trim to empty).
 */
const promptString = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constantFrom(' ', '   ', '\n', '\t  \n')
);

// Feature: agent-system-prompts, Property 4: Combined message composition preserves order and content
// For any master and system strings, the composed combined content contains the master text before
// the system text (master only when system is empty, system only when master is empty), and the
// composed transcript with its leading role:'system' entry removed deep-equals the original
// user/assistant transcript (unchanged order and content).
// Validates: Requirements 1.6, 4.2, 4.3, 4.6
describe('Property 4: Combined message composition preserves order and content', () => {
  it('orders master before system in the combined content', () => {
    fc.assert(
      fc.property(promptString, promptString, (master, system) => {
        const content = composeCombinedContent(master, system);
        const trimmedMaster = master.trim();
        const trimmedSystem = system.trim();

        if (trimmedMaster && trimmedSystem) {
          // Both present: master text precedes system text.
          expect(content).toBe(`${trimmedMaster}\n\n${trimmedSystem}`);
          const masterIdx = content.indexOf(trimmedMaster);
          const systemIdx = content.lastIndexOf(trimmedSystem);
          expect(masterIdx).toBeGreaterThanOrEqual(0);
          expect(masterIdx).toBeLessThan(systemIdx);
        } else if (trimmedMaster) {
          // System empty (Req 4.3): master only.
          expect(content).toBe(trimmedMaster);
        } else if (trimmedSystem) {
          // Master empty: system only.
          expect(content).toBe(trimmedSystem);
        } else {
          // Both empty.
          expect(content).toBe('');
        }
      }),
      { numRuns: 200 }
    );
  });

  it('applies the master even when the system prompt is empty', () => {
    fc.assert(
      // Req 1.6 / 4.3: with a non-empty master and empty system, the combined
      // content is exactly the trimmed master.
      fc.property(fc.string({ minLength: 1 }), (master) => {
        fc.pre(master.trim().length > 0);
        expect(composeCombinedContent(master, '')).toBe(master.trim());
        expect(composeCombinedContent(master, '   ')).toBe(master.trim());
      }),
      { numRuns: 200 }
    );
  });

  it('preserves the original transcript order and content when the system entry is removed', () => {
    fc.assert(
      fc.property(baseTranscript, promptString, promptString, (base, master, system) => {
        const composed = composeSystemMessage(base, master, system);
        const content = composeCombinedContent(master, system);

        if (content) {
          // A leading system entry is prepended; removing it yields the original.
          expect(composed[0]).toEqual({ role: 'system', content });
          expect(composed.slice(1)).toEqual(base);
        } else {
          // Both empty: no system entry, transcript unchanged.
          expect(composed).toEqual(base);
        }

        // The input must never be mutated (Req 4.6).
        expect(base.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('does not mutate the input transcript', () => {
    fc.assert(
      fc.property(baseTranscript, promptString, promptString, (base, master, system) => {
        const snapshot = base.map((m) => ({ ...m }));
        composeSystemMessage(base, master, system);
        expect(base).toEqual(snapshot);
      }),
      { numRuns: 200 }
    );
  });
});

// Feature: agent-system-prompts, Property 5: At most one system message, first, and omitted when empty
// For any base transcript, the composed transcript contains at most one role:'system' entry; when the
// combined content is non-empty that entry is at index 0 preceding all user/assistant messages, and
// when both master and system are empty the composed transcript contains zero role:'system' entries
// and equals the base transcript.
// Validates: Requirements 1.8, 4.1, 4.4
describe('Property 5: At most one system message, first, and omitted when empty', () => {
  it('never produces more than one system entry', () => {
    fc.assert(
      fc.property(baseTranscript, promptString, promptString, (base, master, system) => {
        const composed = composeSystemMessage(base, master, system);
        const systemCount = composed.filter((m) => m.role === 'system').length;
        // Req 4.4: at most one Combined_System_Message.
        expect(systemCount).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 }
    );
  });

  it('places the system entry at index 0 before all user/assistant messages when content is non-empty', () => {
    fc.assert(
      fc.property(baseTranscript, promptString, promptString, (base, master, system) => {
        const composed = composeSystemMessage(base, master, system);
        const content = composeCombinedContent(master, system);

        if (content) {
          // Req 4.1: the system message is the first entry.
          expect(composed[0].role).toBe('system');
          expect(composed[0].content).toBe(content);
          // Exactly one system entry, and it is the only one.
          expect(composed.filter((m) => m.role === 'system')).toHaveLength(1);
          // Every subsequent entry is a user/assistant message (no system after index 0).
          expect(composed.slice(1).some((m) => m.role === 'system')).toBe(false);
          expect(composed.slice(1).every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('omits the system entry entirely and equals the base transcript when both prompts are empty', () => {
    fc.assert(
      // Only exercise inputs whose combined content is empty (both trim to '').
      fc.property(baseTranscript, promptString, promptString, (base, master, system) => {
        fc.pre(composeCombinedContent(master, system) === '');
        const composed = composeSystemMessage(base, master, system);

        // Req 1.8: zero system entries when both layers are empty.
        expect(composed.filter((m) => m.role === 'system')).toHaveLength(0);
        // The composed transcript equals the base transcript.
        expect(composed).toEqual(base);
      }),
      { numRuns: 200 }
    );
  });
});
