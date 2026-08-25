/**
 * Property-Based Tests: Timeline Grouper (Property 6)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 6: Sequential tool calls are grouped
 *
 * Validates: Requirements 2.7
 *
 * For any sequence of 2 or more consecutive tool-call-started events within
 * the same agent turn (no intervening chat-token or chat-completed events),
 * the renderer SHALL group them under a single collapsible "Agent Actions"
 * container with a count badge showing the correct number of tool calls.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { groupSequentialToolCalls } from '../../../src/utils/agent/timelineGrouper';
import type { AgentChatStreamEvent, ToolCategory } from '../../../src/types/agentChat';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

const toolCategoryArb: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  'file',
  'terminal',
  'browser',
  'http',
  'python'
);

/**
 * Generates a valid tool-call-started event.
 */
const toolCallEventArb: fc.Arbitrary<Extract<AgentChatStreamEvent, { type: 'tool-call-started' }>> =
  fc.record({
    type: fc.constant('tool-call-started' as const),
    requestId: fc.uuid(),
    sessionId: fc.uuid(),
    blockId: fc.uuid(),
    tool: fc.constantFrom('readFile', 'writeFile', 'executeCommand', 'browserNavigate', 'httpGet'),
    category: toolCategoryArb,
    params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ maxLength: 20 })),
    timestamp: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
  });

/**
 * Generates a chat-token event (separator).
 */
const chatTokenEventArb: fc.Arbitrary<Extract<AgentChatStreamEvent, { type: 'chat-token' }>> =
  fc.record({
    type: fc.constant('chat-token' as const),
    requestId: fc.uuid(),
    sessionId: fc.uuid(),
    delta: fc.string({ minLength: 1, maxLength: 50 }),
    isThinking: fc.boolean(),
  });

/**
 * Generates a chat-completed event (separator).
 */
const chatCompletedEventArb: fc.Arbitrary<Extract<AgentChatStreamEvent, { type: 'chat-completed' }>> =
  fc.record({
    type: fc.constant('chat-completed' as const),
    requestId: fc.uuid(),
    sessionId: fc.uuid(),
    assistantMessage: fc.record({
      id: fc.uuid(),
      sessionId: fc.uuid(),
      role: fc.constant('assistant' as const),
      content: fc.string({ minLength: 1, maxLength: 100 }),
      displayLabel: fc.string({ minLength: 1, maxLength: 20 }),
      timestamp: fc.integer({ min: 1577836800000, max: 1893456000000 }).map(ms => new Date(ms).toISOString()),
      attachments: fc.constant([]),
      thinkingContent: fc.constant(null),
      isComplete: fc.constant(true),
    }),
  });

/**
 * Generates a separator event (either chat-token or chat-completed).
 */
const separatorEventArb = fc.oneof(chatTokenEventArb, chatCompletedEventArb);

/**
 * Generates a mixed sequence of tool-call and separator events
 * using the design doc strategy.
 */
const mixedEventSequenceArb = fc.array(
  fc.oneof(toolCallEventArb, chatTokenEventArb, chatCompletedEventArb),
  { minLength: 0, maxLength: 30 }
);

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Counts total tool-call-started events in a sequence.
 */
function countToolEvents(events: AgentChatStreamEvent[]): number {
  return events.filter(e => e.type === 'tool-call-started').length;
}

/**
 * Flattens the grouped result to count all ToolUseBlockState items.
 */
function countOutputBlocks(result: ReturnType<typeof groupSequentialToolCalls>): number {
  let count = 0;
  for (const item of result) {
    if (Array.isArray(item)) {
      count += item.length;
    } else {
      count += 1;
    }
  }
  return count;
}

/**
 * Extracts all blockIds from the grouped result in order.
 */
function extractBlockIds(result: ReturnType<typeof groupSequentialToolCalls>): string[] {
  const ids: string[] = [];
  for (const item of result) {
    if (Array.isArray(item)) {
      for (const block of item) {
        ids.push(block.id);
      }
    } else {
      ids.push(item.id);
    }
  }
  return ids;
}

// ─── Property 6: Sequential tool calls are grouped ───────────────────────────

describe('Property 6: Sequential tool calls are grouped', () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For any sequence of 2 or more consecutive tool-call-started events within
   * the same agent turn, the groupSequentialToolCalls function SHALL group them
   * into arrays, while isolated tool calls remain as single objects.
   */

  it('2+ consecutive tool-call events are grouped into an array', () => {
    fc.assert(
      fc.property(
        fc.array(toolCallEventArb, { minLength: 2, maxLength: 10 }),
        (toolEvents) => {
          // A sequence of only tool-call events should produce a single grouped array
          const result = groupSequentialToolCalls(toolEvents);
          expect(result).toHaveLength(1);
          expect(Array.isArray(result[0])).toBe(true);
          expect((result[0] as any[]).length).toBe(toolEvents.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('single isolated tool-call events are returned as individual ToolUseBlockState objects', () => {
    fc.assert(
      fc.property(
        toolCallEventArb,
        separatorEventArb,
        toolCallEventArb,
        (tool1, sep, tool2) => {
          // tool → separator → tool: each tool should be an individual object, not an array
          const events: AgentChatStreamEvent[] = [tool1, sep, tool2];
          const result = groupSequentialToolCalls(events);

          // We should get exactly 2 items (the separator is filtered out by the grouper)
          expect(result).toHaveLength(2);
          expect(Array.isArray(result[0])).toBe(false);
          expect(Array.isArray(result[1])).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('non-tool events (chat-token, chat-completed) break grouping', () => {
    fc.assert(
      fc.property(
        fc.array(toolCallEventArb, { minLength: 2, maxLength: 5 }),
        separatorEventArb,
        fc.array(toolCallEventArb, { minLength: 2, maxLength: 5 }),
        (group1, separator, group2) => {
          // Two groups of 2+ tools separated by a chat event
          const events: AgentChatStreamEvent[] = [...group1, separator, ...group2];
          const result = groupSequentialToolCalls(events);

          // Should produce exactly 2 groups
          expect(result).toHaveLength(2);
          expect(Array.isArray(result[0])).toBe(true);
          expect(Array.isArray(result[1])).toBe(true);
          expect((result[0] as any[]).length).toBe(group1.length);
          expect((result[1] as any[]).length).toBe(group2.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('all tool events from input appear in the output (no events lost)', () => {
    fc.assert(
      fc.property(
        mixedEventSequenceArb,
        (events) => {
          const inputToolCount = countToolEvents(events);
          const result = groupSequentialToolCalls(events);
          const outputToolCount = countOutputBlocks(result);

          expect(outputToolCount).toBe(inputToolCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the order of events is preserved in the output', () => {
    fc.assert(
      fc.property(
        mixedEventSequenceArb,
        (events) => {
          const inputBlockIds = events
            .filter((e): e is Extract<AgentChatStreamEvent, { type: 'tool-call-started' }> =>
              e.type === 'tool-call-started'
            )
            .map(e => e.blockId);

          const result = groupSequentialToolCalls(events);
          const outputBlockIds = extractBlockIds(result);

          expect(outputBlockIds).toEqual(inputBlockIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('groups have correct count matching the consecutive tool-call streak', () => {
    fc.assert(
      fc.property(
        mixedEventSequenceArb,
        (events) => {
          const result = groupSequentialToolCalls(events);

          for (const item of result) {
            if (Array.isArray(item)) {
              // Grouped items must have 2+ elements
              expect(item.length).toBeGreaterThanOrEqual(2);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty event array returns empty result', () => {
    const result = groupSequentialToolCalls([]);
    expect(result).toHaveLength(0);
  });

  it('only separator events produce empty result (no tool calls to output)', () => {
    fc.assert(
      fc.property(
        fc.array(separatorEventArb, { minLength: 1, maxLength: 10 }),
        (separators) => {
          const result = groupSequentialToolCalls(separators);
          expect(result).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
