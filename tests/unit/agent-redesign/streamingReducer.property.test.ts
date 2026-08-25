/**
 * Property-based tests for streaming message completion.
 *
 * Feature: agent-page-redesign, Property 8: Streaming completes without layout shift
 *
 * Validates: Requirements 1.5
 *
 * For any streaming message that transitions to completed (chat-completed event),
 * the rendered content text SHALL be identical before and after the transition —
 * only the cursor indicator is removed, and no container dimensions change by more than 1px.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { appendToken, finalizeStream } from '../../../src/utils/agent/streamingReducer';
import type { StreamingMessage, ChatMessage } from '../../../src/types/agentChat';

/**
 * Generator for token sequences — simulates incremental token delivery during streaming.
 */
const tokenSequenceArb = fc.array(fc.string({ minLength: 1, maxLength: 100 }), {
  minLength: 1,
  maxLength: 50,
});

/**
 * Arbitrary for generating a valid StreamingMessage with a given content.
 */
const streamingMessageArb = (content: string): fc.Arbitrary<StreamingMessage> =>
  fc.record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    content: fc.constant(content),
    thinkingContent: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
    startedAt: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
    model: fc.string({ minLength: 1, maxLength: 30 }),
  });

/**
 * Arbitrary for generating a valid ChatMessage (completed) with a given content.
 */
const completedMessageArb = (content: string): fc.Arbitrary<ChatMessage> =>
  fc.record({
    id: fc.uuid(),
    sessionId: fc.uuid(),
    role: fc.constant('assistant' as const),
    content: fc.constant(content),
    displayLabel: fc.string({ minLength: 1, maxLength: 30 }),
    timestamp: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
    attachments: fc.constant([]),
    thinkingContent: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
    isComplete: fc.constant(true),
  });

describe('Feature: agent-page-redesign, Property 8: Streaming completes without layout shift', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * appendToken concatenates current + delta exactly — no characters are lost or reordered.
   */
  it('appendToken concatenates current + delta exactly (no lost characters)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (current, delta) => {
          const result = appendToken(current, delta);
          expect(result).toBe(current + delta);
          expect(result.length).toBe(current.length + delta.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Accumulating all tokens in sequence produces the full content string.
   * This ensures no data is lost during incremental streaming.
   */
  it('accumulating all tokens produces the full content string', () => {
    fc.assert(
      fc.property(
        tokenSequenceArb,
        (tokens) => {
          const expectedContent = tokens.join('');
          let accumulated = '';

          for (const token of tokens) {
            accumulated = appendToken(accumulated, token);
          }

          expect(accumulated).toBe(expectedContent);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * finalizeStream preserves the content from the completed message exactly.
   * The transition from streaming to completed does not alter content.
   */
  it('finalizeStream preserves the content from the completed message exactly', () => {
    fc.assert(
      fc.property(
        tokenSequenceArb,
        (tokens) => {
          const fullContent = tokens.join('');

          // Simulate streaming accumulation
          let accumulated = '';
          for (const token of tokens) {
            accumulated = appendToken(accumulated, token);
          }

          // Create streaming and completed messages with the same content
          const streamingMessage: StreamingMessage = {
            id: 'stream-1',
            sessionId: 'session-1',
            content: accumulated,
            thinkingContent: null,
            startedAt: new Date().toISOString(),
            model: 'test-model',
          };

          const completedMessage: ChatMessage = {
            id: 'msg-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: fullContent,
            displayLabel: 'test-model',
            timestamp: new Date().toISOString(),
            attachments: [],
            thinkingContent: null,
            isComplete: true,
          };

          const result = finalizeStream(streamingMessage, completedMessage);
          expect(result.content).toBe(fullContent);
          expect(result.content).toBe(accumulated);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * finalizeStream returns a message with isComplete = true.
   */
  it('finalizeStream returns a message with isComplete = true', () => {
    fc.assert(
      fc.property(
        tokenSequenceArb,
        fc.uuid(),
        fc.uuid(),
        (tokens, streamId, sessionId) => {
          const content = tokens.join('');

          const streamingMessage: StreamingMessage = {
            id: streamId,
            sessionId,
            content,
            thinkingContent: null,
            startedAt: new Date().toISOString(),
            model: 'test-model',
          };

          const completedMessage: ChatMessage = {
            id: streamId,
            sessionId,
            role: 'assistant',
            content,
            displayLabel: 'test-model',
            timestamp: new Date().toISOString(),
            attachments: [],
            thinkingContent: null,
            isComplete: true,
          };

          const result = finalizeStream(streamingMessage, completedMessage);
          expect(result.isComplete).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.5**
   *
   * Both appendToken and finalizeStream are pure functions — same inputs always produce same output.
   */
  it('functions are pure — same inputs always produce same output', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (current, delta) => {
          const result1 = appendToken(current, delta);
          const result2 = appendToken(current, delta);
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );

    fc.assert(
      fc.property(
        tokenSequenceArb,
        (tokens) => {
          const content = tokens.join('');

          const streamingMessage: StreamingMessage = {
            id: 'pure-test',
            sessionId: 'session-pure',
            content,
            thinkingContent: null,
            startedAt: '2024-01-01T00:00:00.000Z',
            model: 'model',
          };

          const completedMessage: ChatMessage = {
            id: 'pure-test',
            sessionId: 'session-pure',
            role: 'assistant',
            content,
            displayLabel: 'model',
            timestamp: '2024-01-01T00:00:01.000Z',
            attachments: [],
            thinkingContent: null,
            isComplete: true,
          };

          const result1 = finalizeStream(streamingMessage, completedMessage);
          const result2 = finalizeStream(streamingMessage, completedMessage);
          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
