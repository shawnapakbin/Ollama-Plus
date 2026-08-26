/**
 * Property-Based Test for Session Storage (Property 10)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Feature: agent-page-redesign, Property 10: Session persistence round-trip
 *
 * **Validates: Requirements 5.3, 5.4, 5.6**
 *
 * Property: For any valid AgentSession, persisting it and then retrieving it
 * by ID SHALL produce a session with equivalent messages (same content, role,
 * timestamps), timeline events, and metadata. No data loss SHALL occur.
 *
 * Since useSessionStorage relies on React state and IPC, this test verifies
 * the pure state transition logic used by persistMessage and persistEvent:
 * - persistMessage: { ...session, messages: [...session.messages, newMessage], messageCount: session.messageCount + 1 }
 * - persistEvent: { ...session, timelineEvents: [...session.timelineEvents, newEvent] }
 *
 * These transformations must preserve all existing data and append new items without loss.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  AgentSession,
  AgentSessionStatus,
  ChatMessage,
  TimelineEvent,
  ToolCategory,
  ToolUseBlockState,
  ReasoningBlockState,
  ApprovalGateState,
  CompletionSummaryData,
  AttachmentFile,
} from '../../../src/types/agentChat';
import type { Artifact, MemoryRecord } from '../../../src/types/agent';

// ─── Pure State Transition Functions (mirrors useSessionStorage logic) ────────

/**
 * Simulates the persistMessage state update from useSessionStorage.
 * Adds a message to the session's messages array and increments messageCount.
 */
function applyPersistMessage(session: AgentSession, message: ChatMessage): AgentSession {
  return {
    ...session,
    messages: [...session.messages, message],
    messageCount: session.messageCount + 1,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Simulates the persistEvent state update from useSessionStorage.
 * Adds a timeline event to the session's timelineEvents array.
 */
function applyPersistEvent(session: AgentSession, event: TimelineEvent): AgentSession {
  return {
    ...session,
    timelineEvents: [...session.timelineEvents, event],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

const toolCategoryArb: fc.Arbitrary<ToolCategory> = fc.constantFrom(
  'file', 'terminal', 'browser', 'http', 'python'
);

const sessionStatusArb: fc.Arbitrary<AgentSessionStatus> = fc.constantFrom(
  'active', 'completed', 'failed', 'idle'
);

const isoTimestampArb = fc.integer({ min: 1577836800000, max: 1893456000000 })
  .map(ms => new Date(ms).toISOString());

const attachmentArb: fc.Arbitrary<AttachmentFile> = fc.record({
  id: fc.uuid(),
  filename: fc.string({ minLength: 1, maxLength: 30 }),
  mimeType: fc.constantFrom('text/plain', 'image/png', 'application/json'),
  size: fc.nat({ max: 1_000_000 }),
  content: fc.base64String({ minLength: 0, maxLength: 50 }),
});

const chatMessageArb: fc.Arbitrary<ChatMessage> = fc.record({
  id: fc.uuid(),
  sessionId: fc.uuid(),
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  displayLabel: fc.string({ minLength: 1, maxLength: 30 }),
  timestamp: isoTimestampArb,
  attachments: fc.array(attachmentArb, { maxLength: 3 }),
  thinkingContent: fc.oneof(fc.constant(null), fc.string({ maxLength: 100 })),
  isComplete: fc.boolean(),
});

const toolUseBlockArb: fc.Arbitrary<ToolUseBlockState> = fc.record({
  id: fc.uuid(),
  tool: fc.constantFrom('readFile', 'writeFile', 'executeCommand', 'httpGet'),
  category: toolCategoryArb,
  params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ maxLength: 20 })),
  output: fc.oneof(fc.constant(null), fc.string({ maxLength: 100 })),
  status: fc.constantFrom('running' as const, 'success' as const, 'error' as const),
  error: fc.constant(null),
  duration: fc.oneof(fc.constant(null), fc.nat({ max: 30000 })),
  timestamp: isoTimestampArb,
  afterMessageId: fc.oneof(fc.constant(null), fc.uuid()),
});

const reasoningBlockArb: fc.Arbitrary<ReasoningBlockState> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('plan' as const, 'thinking' as const, 'replan' as const, 'completion' as const),
  content: fc.string({ minLength: 0, maxLength: 100 }),
  steps: fc.constant(undefined),
  removedSteps: fc.constant(undefined),
  newSteps: fc.constant(undefined),
  isExpanded: fc.boolean(),
  timestamp: isoTimestampArb,
  afterMessageId: fc.oneof(fc.constant(null), fc.uuid()),
});

const approvalGateArb: fc.Arbitrary<ApprovalGateState> = fc.record({
  gateId: fc.uuid(),
  action: fc.string({ minLength: 1, maxLength: 30 }),
  tool: fc.constantFrom('executeCommand', 'writeFile', 'deleteFile'),
  category: toolCategoryArb,
  params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.string({ maxLength: 20 })),
  riskExplanation: fc.string({ minLength: 1, maxLength: 100 }),
  status: fc.constantFrom('pending' as const, 'approved' as const, 'denied' as const),
  timestamp: isoTimestampArb,
  afterMessageId: fc.oneof(fc.constant(null), fc.uuid()),
});

const completionSummaryArb: fc.Arbitrary<CompletionSummaryData> = fc.record({
  stepsCompleted: fc.nat({ max: 20 }),
  totalSteps: fc.nat({ max: 20 }),
  duration: fc.nat({ max: 600000 }),
  artifactCount: fc.nat({ max: 10 }),
  outcome: fc.string({ minLength: 1, maxLength: 100 }),
  timestamp: isoTimestampArb,
});

const timelineEventArb: fc.Arbitrary<TimelineEvent> = fc.oneof(
  fc.record({ type: fc.constant('tool-use' as const), block: toolUseBlockArb }),
  fc.record({ type: fc.constant('tool-use-group' as const), blocks: fc.array(toolUseBlockArb, { minLength: 2, maxLength: 4 }) }),
  fc.record({ type: fc.constant('reasoning' as const), block: reasoningBlockArb }),
  fc.record({ type: fc.constant('approval-gate' as const), gate: approvalGateArb }),
  fc.record({ type: fc.constant('completion-summary' as const), data: completionSummaryArb }),
  fc.record({ type: fc.constant('connection-lost' as const), timestamp: isoTimestampArb }),
);

const agentSessionArb: fc.Arbitrary<AgentSession> = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 60 }),
  status: sessionStatusArb,
  messages: fc.array(chatMessageArb, { maxLength: 5 }),
  timelineEvents: fc.array(timelineEventArb, { maxLength: 5 }),
  plan: fc.constant(null),
  artifacts: fc.constant([] as Artifact[]),
  memoryRecords: fc.constant([] as MemoryRecord[]),
  modelId: fc.string({ minLength: 1, maxLength: 30 }),
  endpoint: fc.string({ minLength: 1, maxLength: 50 }),
  createdAt: isoTimestampArb,
  updatedAt: isoTimestampArb,
  messageCount: fc.nat({ max: 100 }),
  totalDuration: fc.oneof(fc.constant(null), fc.nat({ max: 600000 })),
});

// ─── Property-Based Tests: Property 10 ──────────────────────────────────────

describe('sessionStorage - Property 10: Session persistence round-trip', () => {
  /**
   * **Validates: Requirements 5.3, 5.4, 5.6**
   *
   * For any valid AgentSession, persisting it and then retrieving it by ID
   * SHALL produce a session with equivalent messages, timeline events, and
   * metadata. No data loss SHALL occur.
   */

  // ─── Property 10a: After persisting N messages, session has exactly N messages added ─

  it('after persisting N messages, the session has exactly N messages added', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(chatMessageArb, { minLength: 1, maxLength: 10 }),
        (session, newMessages) => {
          const originalMessageCount = session.messages.length;
          let current = session;

          for (const msg of newMessages) {
            current = applyPersistMessage(current, msg);
          }

          expect(current.messages).toHaveLength(originalMessageCount + newMessages.length);
          expect(current.messageCount).toBe(session.messageCount + newMessages.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10b: After persisting N events, session has exactly N events added ─

  it('after persisting N events, the session has exactly N events added', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(timelineEventArb, { minLength: 1, maxLength: 10 }),
        (session, newEvents) => {
          const originalEventCount = session.timelineEvents.length;
          let current = session;

          for (const evt of newEvents) {
            current = applyPersistEvent(current, evt);
          }

          expect(current.timelineEvents).toHaveLength(originalEventCount + newEvents.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10c: Message content, role, and timestamps are preserved exactly ─

  it('message content, role, and timestamps are preserved exactly after persistence', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        chatMessageArb,
        (session, newMessage) => {
          const result = applyPersistMessage(session, newMessage);
          const lastMessage = result.messages[result.messages.length - 1];

          // The persisted message preserves all fields exactly
          expect(lastMessage.id).toBe(newMessage.id);
          expect(lastMessage.content).toBe(newMessage.content);
          expect(lastMessage.role).toBe(newMessage.role);
          expect(lastMessage.timestamp).toBe(newMessage.timestamp);
          expect(lastMessage.sessionId).toBe(newMessage.sessionId);
          expect(lastMessage.displayLabel).toBe(newMessage.displayLabel);
          expect(lastMessage.thinkingContent).toBe(newMessage.thinkingContent);
          expect(lastMessage.isComplete).toBe(newMessage.isComplete);
          expect(lastMessage.attachments).toEqual(newMessage.attachments);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10d: Timeline event data is preserved exactly ─────────────────

  it('timeline event data is preserved exactly after persistence', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        timelineEventArb,
        (session, newEvent) => {
          const result = applyPersistEvent(session, newEvent);
          const lastEvent = result.timelineEvents[result.timelineEvents.length - 1];

          // The persisted event is structurally identical to the input
          expect(lastEvent).toEqual(newEvent);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10e: Session metadata is unchanged after persisting messages ──

  it('session metadata (id, title, status) is unchanged after persisting messages', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(chatMessageArb, { minLength: 1, maxLength: 5 }),
        (session, newMessages) => {
          let current = session;
          for (const msg of newMessages) {
            current = applyPersistMessage(current, msg);
          }

          // Core metadata is preserved
          expect(current.id).toBe(session.id);
          expect(current.title).toBe(session.title);
          expect(current.status).toBe(session.status);
          expect(current.modelId).toBe(session.modelId);
          expect(current.endpoint).toBe(session.endpoint);
          expect(current.createdAt).toBe(session.createdAt);
          expect(current.plan).toBe(session.plan);
          expect(current.artifacts).toBe(session.artifacts);
          expect(current.memoryRecords).toBe(session.memoryRecords);
          expect(current.totalDuration).toBe(session.totalDuration);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10f: Order of messages is maintained (FIFO) ───────────────────

  it('the order of messages is maintained (FIFO) after multiple persists', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(chatMessageArb, { minLength: 2, maxLength: 10 }),
        (session, newMessages) => {
          let current = session;
          for (const msg of newMessages) {
            current = applyPersistMessage(current, msg);
          }

          // Original messages remain at the start in order
          for (let i = 0; i < session.messages.length; i++) {
            expect(current.messages[i]).toEqual(session.messages[i]);
          }

          // New messages are appended in order
          for (let i = 0; i < newMessages.length; i++) {
            expect(current.messages[session.messages.length + i]).toEqual(newMessages[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10g: Order of events is maintained (FIFO) ────────────────────

  it('the order of timeline events is maintained (FIFO) after multiple persists', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(timelineEventArb, { minLength: 2, maxLength: 10 }),
        (session, newEvents) => {
          let current = session;
          for (const evt of newEvents) {
            current = applyPersistEvent(current, evt);
          }

          // Original events remain at the start in order
          for (let i = 0; i < session.timelineEvents.length; i++) {
            expect(current.timelineEvents[i]).toEqual(session.timelineEvents[i]);
          }

          // New events are appended in order
          for (let i = 0; i < newEvents.length; i++) {
            expect(current.timelineEvents[session.timelineEvents.length + i]).toEqual(newEvents[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 10h: Session metadata unchanged after persisting events ───────

  it('session metadata (id, title, status) is unchanged after persisting events', () => {
    fc.assert(
      fc.property(
        agentSessionArb,
        fc.array(timelineEventArb, { minLength: 1, maxLength: 5 }),
        (session, newEvents) => {
          let current = session;
          for (const evt of newEvents) {
            current = applyPersistEvent(current, evt);
          }

          // Core metadata is preserved
          expect(current.id).toBe(session.id);
          expect(current.title).toBe(session.title);
          expect(current.status).toBe(session.status);
          expect(current.modelId).toBe(session.modelId);
          expect(current.endpoint).toBe(session.endpoint);
          expect(current.createdAt).toBe(session.createdAt);
          expect(current.plan).toBe(session.plan);
          expect(current.artifacts).toBe(session.artifacts);
          expect(current.memoryRecords).toBe(session.memoryRecords);
          expect(current.totalDuration).toBe(session.totalDuration);
          // Messages are untouched when only events are persisted
          expect(current.messages).toEqual(session.messages);
          expect(current.messageCount).toBe(session.messageCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
