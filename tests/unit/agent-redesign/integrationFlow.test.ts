/**
 * Integration Tests: Full Conversation Flow
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests the coordination between useAgentChat, useAgentChatStream,
 * and useSessionStorage by mocking the IPC layer (window.electronAPI)
 * and simulating the full event flow.
 *
 * Test scenarios:
 * 1. Send message -> receive tokens -> complete -> message persisted
 * 2. Tool execution inline in chat stream
 * 3. Approval gate flow (approve + deny)
 * 4. Session resume
 * 5. Error + retry
 *
 * Requirements: 1.1, 2.1, 4.4, 5.4, 11.5, 12.1
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentChat } from '../../../src/hooks/useAgentChat';
import type { AgentChatStreamEvent, ChatMessage, AgentSession } from '../../../src/types/agentChat';

// ─── IPC Mock Infrastructure ─────────────────────────────────────────────────

type StreamListener = (event: AgentChatStreamEvent) => void;

let streamListener: StreamListener | null = null;
let mockUnsubscribe: ReturnType<typeof vi.fn>;
let mockSendAgentChatMessage: ReturnType<typeof vi.fn>;
let mockStopAgentGeneration: ReturnType<typeof vi.fn>;
let mockApproveAgentGate: ReturnType<typeof vi.fn>;
let mockDenyAgentGate: ReturnType<typeof vi.fn>;
let mockListAgentChatSessions: ReturnType<typeof vi.fn>;
let mockGetAgentChatSession: ReturnType<typeof vi.fn>;
let mockGetLastActiveAgentSession: ReturnType<typeof vi.fn>;
let mockDeleteAgentSession: ReturnType<typeof vi.fn>;

function setupMockElectronAPI() {
  mockUnsubscribe = vi.fn();
  mockSendAgentChatMessage = vi.fn().mockResolvedValue({
    sessionId: 'session-1',
    requestId: 'req-1',
  });
  mockStopAgentGeneration = vi.fn().mockResolvedValue(undefined);
  mockApproveAgentGate = vi.fn().mockResolvedValue({ success: true });
  mockDenyAgentGate = vi.fn().mockResolvedValue({ success: true });
  mockListAgentChatSessions = vi.fn().mockResolvedValue([]);
  mockGetAgentChatSession = vi.fn().mockResolvedValue(null);
  mockGetLastActiveAgentSession = vi.fn().mockResolvedValue(null);
  mockDeleteAgentSession = vi.fn().mockResolvedValue(undefined);

  (window as any).electronAPI = {
    sendAgentChatMessage: mockSendAgentChatMessage,
    onAgentChatStream: (listener: StreamListener) => {
      streamListener = listener;
      return mockUnsubscribe;
    },
    stopAgentGeneration: mockStopAgentGeneration,
    approveAgentGate: mockApproveAgentGate,
    denyAgentGate: mockDenyAgentGate,
    listAgentChatSessions: mockListAgentChatSessions,
    getAgentChatSession: mockGetAgentChatSession,
    getLastActiveAgentSession: mockGetLastActiveAgentSession,
    deleteAgentSession: mockDeleteAgentSession,
  };
}

/** Emit a stream event as if from the main process */
function emitEvent(event: AgentChatStreamEvent) {
  if (!streamListener) {
    throw new Error('Stream listener not registered. Was the hook rendered?');
  }
  streamListener(event);
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createUserMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'user-msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello, build me a web app',
    displayLabel: 'Shawna',
    timestamp: '2024-03-15T10:00:00.000Z',
    attachments: [],
    thinkingContent: null,
    isComplete: true,
    ...overrides,
  };
}

function createAssistantMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'assistant-msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: 'I will help you build a web app. Let me start by creating the project structure.',
    displayLabel: 'llama3',
    timestamp: '2024-03-15T10:00:05.000Z',
    attachments: [],
    thinkingContent: null,
    isComplete: true,
    ...overrides,
  };
}

function createMockSession(overrides?: Partial<AgentSession>): AgentSession {
  return {
    id: 'session-1',
    title: 'Build me a web app',
    status: 'active',
    messages: [
      createUserMessage(),
      createAssistantMessage(),
    ],
    timelineEvents: [],
    plan: null,
    artifacts: [],
    memoryRecords: [],
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    createdAt: '2024-03-15T10:00:00.000Z',
    updatedAt: '2024-03-15T10:00:05.000Z',
    messageCount: 2,
    totalDuration: null,
    ...overrides,
  };
}

const defaultConfig = {
  model: 'llama3',
  endpoint: 'http://localhost:11434',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Full Conversation Flow', () => {
  beforeEach(() => {
    streamListener = null;
    setupMockElectronAPI();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
  });

  // ─── Test 1: Send message → receive tokens → complete → message persisted ──

  describe('send message → receive tokens → complete → message persisted', () => {
    it('transitions from idle to streaming on chat-started event', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Initial state is idle
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.messages).toHaveLength(0);

      // Send a message
      await act(async () => {
        await result.current.sendMessage('Hello agent', []);
      });

      expect(mockSendAgentChatMessage).toHaveBeenCalledWith({
        sessionId: undefined,
        content: 'Hello agent',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        attachments: undefined,
      });

      // Emit chat-started event
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage({ content: 'Hello agent' }),
        });
      });

      // State transitions to streaming
      expect(result.current.isStreaming).toBe(true);
      // User message is added to messages
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[0].content).toBe('Hello agent');
      // Streaming message placeholder is created
      expect(result.current.streamingMessage).not.toBeNull();
      expect(result.current.streamingMessage?.content).toBe('');
    });

    it('accumulates tokens into the streaming message', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Emit chat-started
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Emit multiple tokens
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Hello',
          isThinking: false,
        });
      });

      expect(result.current.streamingMessage?.content).toBe('Hello');

      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: ', I can help',
          isThinking: false,
        });
      });

      expect(result.current.streamingMessage?.content).toBe('Hello, I can help');

      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: ' you!',
          isThinking: false,
        });
      });

      expect(result.current.streamingMessage?.content).toBe('Hello, I can help you!');
    });

    it('accumulates thinking tokens separately', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Emit chat-started
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Emit thinking token
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Let me think about this...',
          isThinking: true,
        });
      });

      expect(result.current.streamingMessage?.thinkingContent).toBe('Let me think about this...');
      expect(result.current.streamingMessage?.content).toBe('');

      // Then a normal token
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Here is my answer.',
          isThinking: false,
        });
      });

      expect(result.current.streamingMessage?.thinkingContent).toBe('Let me think about this...');
      expect(result.current.streamingMessage?.content).toBe('Here is my answer.');
    });

    it('finalizes the message on chat-completed and returns to idle', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Emit chat-started
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Emit tokens
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Final response content.',
          isThinking: false,
        });
      });

      // Emit chat-completed
      const assistantMsg = createAssistantMessage({ content: 'Final response content.' });
      act(() => {
        emitEvent({
          type: 'chat-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          assistantMessage: assistantMsg,
        });
      });

      // State returns to idle
      expect(result.current.isStreaming).toBe(false);
      // Streaming message is cleared
      expect(result.current.streamingMessage).toBeNull();
      // Messages now include both user and assistant
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].role).toBe('user');
      expect(result.current.messages[1].role).toBe('assistant');
      expect(result.current.messages[1].content).toBe('Final response content.');
    });

    it('completes the full flow: send → start → tokens → complete', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Step 1: Send message
      await act(async () => {
        await result.current.sendMessage('Create a React component', []);
      });

      // Step 2: Receive chat-started
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage({ content: 'Create a React component' }),
        });
      });

      expect(result.current.isStreaming).toBe(true);
      expect(result.current.messages).toHaveLength(1);

      // Step 3: Receive tokens
      act(() => {
        emitEvent({ type: 'chat-token', requestId: 'req-1', sessionId: 'session-1', delta: 'Sure, ', isThinking: false });
        emitEvent({ type: 'chat-token', requestId: 'req-1', sessionId: 'session-1', delta: "I'll create ", isThinking: false });
        emitEvent({ type: 'chat-token', requestId: 'req-1', sessionId: 'session-1', delta: 'the component.', isThinking: false });
      });

      expect(result.current.streamingMessage?.content).toBe("Sure, I'll create the component.");

      // Step 4: Receive completion
      act(() => {
        emitEvent({
          type: 'chat-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          assistantMessage: createAssistantMessage({
            content: "Sure, I'll create the component.",
          }),
        });
      });

      // Final assertions
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingMessage).toBeNull();
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[1].content).toBe("Sure, I'll create the component.");
      expect(result.current.messages[1].isComplete).toBe(true);
    });
  });

  // ─── Test 2: Tool execution inline in chat stream ──────────────────────────

  describe('tool execution inline in chat stream', () => {
    it('transitions to tool-executing state on tool-call-started', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start a chat session
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Agent starts a tool call
      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-block-1',
          tool: 'write_file',
          category: 'file',
          params: { path: '/src/App.tsx', content: 'export default function App() {}' },
          timestamp: '2024-03-15T10:00:02.000Z',
        });
      });

      // State transitions to tool-executing
      expect(result.current.isStreaming).toBe(false);
      // Tool block is added
      expect(result.current.toolBlocks).toHaveLength(1);
      expect(result.current.toolBlocks[0].id).toBe('tool-block-1');
      expect(result.current.toolBlocks[0].tool).toBe('write_file');
      expect(result.current.toolBlocks[0].category).toBe('file');
      expect(result.current.toolBlocks[0].status).toBe('running');
      expect(result.current.toolBlocks[0].output).toBeNull();
    });

    it('updates tool block on tool-call-completed and returns to streaming', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start chat
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Tool call started
      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-block-1',
          tool: 'write_file',
          category: 'file',
          params: { path: '/src/App.tsx' },
          timestamp: '2024-03-15T10:00:02.000Z',
        });
      });

      // Tool call completed
      act(() => {
        emitEvent({
          type: 'tool-call-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-block-1',
          tool: 'write_file',
          output: 'File written successfully',
          status: 'success',
          error: null,
          duration: 150,
          timestamp: '2024-03-15T10:00:02.150Z',
        });
      });

      // Returns to streaming state
      expect(result.current.isStreaming).toBe(true);
      // Tool block is updated with output
      expect(result.current.toolBlocks[0].status).toBe('success');
      expect(result.current.toolBlocks[0].output).toBe('File written successfully');
      expect(result.current.toolBlocks[0].duration).toBe(150);
      expect(result.current.toolBlocks[0].error).toBeNull();
    });

    it('handles tool error state correctly', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-block-1',
          tool: 'execute_command',
          category: 'terminal',
          params: { command: 'npm install' },
          timestamp: '2024-03-15T10:00:02.000Z',
        });
      });

      act(() => {
        emitEvent({
          type: 'tool-call-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-block-1',
          tool: 'execute_command',
          output: '',
          status: 'error',
          error: {
            message: 'Command timed out after 30s',
            classification: 'timeout',
            retryInfo: 'Retrying (attempt 2/3)...',
          },
          duration: 30000,
          timestamp: '2024-03-15T10:00:32.000Z',
        });
      });

      expect(result.current.toolBlocks[0].status).toBe('error');
      expect(result.current.toolBlocks[0].error?.message).toBe('Command timed out after 30s');
      expect(result.current.toolBlocks[0].error?.classification).toBe('timeout');
      expect(result.current.toolBlocks[0].error?.retryInfo).toBe('Retrying (attempt 2/3)...');
    });

    it('handles multiple sequential tool calls', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // First tool call
      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-1',
          tool: 'read_file',
          category: 'file',
          params: { path: '/package.json' },
          timestamp: '2024-03-15T10:00:01.000Z',
        });
      });

      act(() => {
        emitEvent({
          type: 'tool-call-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-1',
          tool: 'read_file',
          output: '{ "name": "app" }',
          status: 'success',
          error: null,
          duration: 50,
          timestamp: '2024-03-15T10:00:01.050Z',
        });
      });

      // Second tool call
      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-2',
          tool: 'write_file',
          category: 'file',
          params: { path: '/src/index.ts' },
          timestamp: '2024-03-15T10:00:02.000Z',
        });
      });

      act(() => {
        emitEvent({
          type: 'tool-call-completed',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-2',
          tool: 'write_file',
          output: 'Written',
          status: 'success',
          error: null,
          duration: 80,
          timestamp: '2024-03-15T10:00:02.080Z',
        });
      });

      expect(result.current.toolBlocks).toHaveLength(2);
      expect(result.current.toolBlocks[0].id).toBe('tool-1');
      expect(result.current.toolBlocks[0].status).toBe('success');
      expect(result.current.toolBlocks[1].id).toBe('tool-2');
      expect(result.current.toolBlocks[1].status).toBe('success');
    });
  });

  // ─── Test 3: Approval gate flow (approve + deny) ───────────────────────────

  describe('approval gate flow (approve + deny)', () => {
    it('transitions to waiting-approval state on approval-gate event', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start chat and tool execution
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'tool-call-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'tool-1',
          tool: 'execute_command',
          category: 'terminal',
          params: { command: 'rm -rf /tmp/old' },
          timestamp: '2024-03-15T10:00:02.000Z',
        });
      });

      // Approval gate triggered
      act(() => {
        emitEvent({
          type: 'approval-gate',
          requestId: 'req-1',
          sessionId: 'session-1',
          gateId: 'gate-1',
          action: 'Delete directory /tmp/old',
          tool: 'execute_command',
          category: 'terminal',
          params: { command: 'rm -rf /tmp/old' },
          riskExplanation: 'This will permanently delete the directory and its contents.',
          timestamp: '2024-03-15T10:00:03.000Z',
        });
      });

      // State transitions to waiting-approval
      expect(result.current.isPendingApproval).toBe(true);
      expect(result.current.isStreaming).toBe(false);
      // Gate is recorded
      expect(result.current.approvalGates).toHaveLength(1);
      expect(result.current.approvalGates[0].gateId).toBe('gate-1');
      expect(result.current.approvalGates[0].status).toBe('pending');
      expect(result.current.approvalGates[0].riskExplanation).toBe(
        'This will permanently delete the directory and its contents.'
      );
    });

    it('approves a gate and resumes tool-executing state', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Setup: get to waiting-approval state
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'approval-gate',
          requestId: 'req-1',
          sessionId: 'session-1',
          gateId: 'gate-1',
          action: 'Delete files',
          tool: 'execute_command',
          category: 'terminal',
          params: {},
          riskExplanation: 'Risky operation',
          timestamp: '2024-03-15T10:00:03.000Z',
        });
      });

      expect(result.current.isPendingApproval).toBe(true);

      // Approve the gate
      act(() => {
        result.current.approveGate('gate-1');
      });

      // IPC method was called
      expect(mockApproveAgentGate).toHaveBeenCalledWith('session-1', 'gate-1');
      // Gate status updated to approved
      expect(result.current.approvalGates[0].status).toBe('approved');
      // No longer pending approval
      expect(result.current.isPendingApproval).toBe(false);
    });

    it('denies a gate and transitions to streaming (agent replans)', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Setup: get to waiting-approval state
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'approval-gate',
          requestId: 'req-1',
          sessionId: 'session-1',
          gateId: 'gate-1',
          action: 'Delete production database',
          tool: 'execute_command',
          category: 'terminal',
          params: { command: 'DROP DATABASE prod' },
          riskExplanation: 'Dropping production database is irreversible.',
          timestamp: '2024-03-15T10:00:03.000Z',
        });
      });

      expect(result.current.isPendingApproval).toBe(true);

      // Deny the gate
      act(() => {
        result.current.denyGate('gate-1');
      });

      // IPC method was called
      expect(mockDenyAgentGate).toHaveBeenCalledWith('session-1', 'gate-1');
      // Gate status updated to denied
      expect(result.current.approvalGates[0].status).toBe('denied');
      // State transitions to streaming (agent will replan)
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.isPendingApproval).toBe(false);
    });

    it('handles multiple gates in sequence', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // First gate
      act(() => {
        emitEvent({
          type: 'approval-gate',
          requestId: 'req-1',
          sessionId: 'session-1',
          gateId: 'gate-1',
          action: 'Install package',
          tool: 'execute_command',
          category: 'terminal',
          params: {},
          riskExplanation: 'Modifies node_modules',
          timestamp: '2024-03-15T10:00:03.000Z',
        });
      });

      act(() => {
        result.current.approveGate('gate-1');
      });

      // Second gate after more execution
      act(() => {
        emitEvent({
          type: 'approval-gate',
          requestId: 'req-1',
          sessionId: 'session-1',
          gateId: 'gate-2',
          action: 'Delete old files',
          tool: 'execute_command',
          category: 'terminal',
          params: {},
          riskExplanation: 'Permanent deletion',
          timestamp: '2024-03-15T10:00:05.000Z',
        });
      });

      expect(result.current.approvalGates).toHaveLength(2);
      expect(result.current.approvalGates[0].status).toBe('approved');
      expect(result.current.approvalGates[1].status).toBe('pending');
      expect(result.current.isPendingApproval).toBe(true);

      // Deny the second gate
      act(() => {
        result.current.denyGate('gate-2');
      });

      expect(result.current.approvalGates[1].status).toBe('denied');
    });
  });

  // ─── Test 4: Session resume ────────────────────────────────────────────────

  describe('session resume', () => {
    it('loads a previous session and populates state', async () => {
      const existingSession = createMockSession({
        id: 'session-prev',
        messages: [
          createUserMessage({ id: 'old-user-1', content: 'Previous conversation' }),
          createAssistantMessage({ id: 'old-asst-1', content: 'I helped before' }),
        ],
        timelineEvents: [
          {
            type: 'tool-use',
            block: {
              id: 'old-tool-1',
              tool: 'read_file',
              category: 'file',
              params: { path: '/readme.md' },
              output: '# README',
              status: 'success',
              error: null,
              duration: 30,
              timestamp: '2024-03-14T10:00:01.000Z',
              afterMessageId: 'old-user-1',
            },
          },
        ],
        messageCount: 2,
      });

      mockGetAgentChatSession.mockResolvedValue(existingSession);

      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Load previous session
      await act(async () => {
        await result.current.loadSession('session-prev');
      });

      // Session messages are populated
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0].content).toBe('Previous conversation');
      expect(result.current.messages[1].content).toBe('I helped before');
      // Tool blocks are reconstructed from timeline events
      expect(result.current.toolBlocks).toHaveLength(1);
      expect(result.current.toolBlocks[0].tool).toBe('read_file');
      // State is idle (not streaming)
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingMessage).toBeNull();
    });

    it('resumes a session by sending a new message that appends to existing messages', async () => {
      const existingSession = createMockSession({
        id: 'session-resume',
        messages: [
          createUserMessage({ id: 'msg-1', content: 'Initial question' }),
          createAssistantMessage({ id: 'msg-2', content: 'Initial answer' }),
        ],
        timelineEvents: [],
        messageCount: 2,
      });

      mockGetAgentChatSession.mockResolvedValue(existingSession);

      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Load the session
      await act(async () => {
        await result.current.loadSession('session-resume');
      });

      expect(result.current.messages).toHaveLength(2);

      // Send a follow-up message
      await act(async () => {
        await result.current.sendMessage('Follow up question', []);
      });

      // Emit chat-started for the follow-up
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-2',
          sessionId: 'session-resume',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage({ id: 'msg-3', content: 'Follow up question' }),
        });
      });

      // The new user message is appended to existing messages
      expect(result.current.messages).toHaveLength(3);
      expect(result.current.messages[2].content).toBe('Follow up question');
      expect(result.current.isStreaming).toBe(true);

      // Complete the follow-up
      act(() => {
        emitEvent({
          type: 'chat-completed',
          requestId: 'req-2',
          sessionId: 'session-resume',
          assistantMessage: createAssistantMessage({
            id: 'msg-4',
            content: 'Here is the follow-up answer.',
          }),
        });
      });

      expect(result.current.messages).toHaveLength(4);
      expect(result.current.messages[3].content).toBe('Here is the follow-up answer.');
      expect(result.current.isStreaming).toBe(false);
    });

    it('starts a new session and clears all state', async () => {
      const existingSession = createMockSession();
      mockGetAgentChatSession.mockResolvedValue(existingSession);

      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Load a session
      await act(async () => {
        await result.current.loadSession('session-1');
      });

      expect(result.current.messages).toHaveLength(2);

      // Start a new session
      act(() => {
        result.current.startNewSession();
      });

      // All state is cleared
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.streamingMessage).toBeNull();
      expect(result.current.toolBlocks).toHaveLength(0);
      expect(result.current.reasoningBlocks).toHaveLength(0);
      expect(result.current.approvalGates).toHaveLength(0);
      expect(result.current.completionSummary).toBeNull();
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isConnected).toBe(true);
    });

    it('restores approval gate and reasoning block state from timeline events', async () => {
      const existingSession = createMockSession({
        id: 'session-complex',
        timelineEvents: [
          {
            type: 'reasoning',
            block: {
              id: 'reason-1',
              type: 'plan',
              content: 'Step 1: Read. Step 2: Write.',
              steps: [
                { id: 's1', title: 'Read files', status: 'completed' },
                { id: 's2', title: 'Write output', status: 'pending' },
              ],
              isExpanded: true,
              timestamp: '2024-03-15T10:00:01.000Z',
              afterMessageId: 'user-msg-1',
            },
          },
          {
            type: 'approval-gate',
            gate: {
              gateId: 'gate-past',
              action: 'Deploy to staging',
              tool: 'execute_command',
              category: 'terminal',
              params: {},
              riskExplanation: 'Deploys code to staging env',
              status: 'approved',
              timestamp: '2024-03-15T10:00:02.000Z',
              afterMessageId: 'user-msg-1',
            },
          },
          {
            type: 'completion-summary',
            data: {
              stepsCompleted: 3,
              totalSteps: 3,
              duration: 15000,
              artifactCount: 2,
              outcome: 'Deployment successful',
              timestamp: '2024-03-15T10:00:10.000Z',
            },
          },
        ],
      });

      mockGetAgentChatSession.mockResolvedValue(existingSession);

      const { result } = renderHook(() => useAgentChat(defaultConfig));

      await act(async () => {
        await result.current.loadSession('session-complex');
      });

      // Reasoning blocks restored
      expect(result.current.reasoningBlocks).toHaveLength(1);
      expect(result.current.reasoningBlocks[0].type).toBe('plan');
      expect(result.current.reasoningBlocks[0].content).toBe('Step 1: Read. Step 2: Write.');

      // Approval gates restored
      expect(result.current.approvalGates).toHaveLength(1);
      expect(result.current.approvalGates[0].gateId).toBe('gate-past');
      expect(result.current.approvalGates[0].status).toBe('approved');

      // Completion summary restored
      expect(result.current.completionSummary).not.toBeNull();
      expect(result.current.completionSummary?.outcome).toBe('Deployment successful');
      expect(result.current.completionSummary?.stepsCompleted).toBe(3);
    });
  });

  // ─── Test 5: Error + retry ─────────────────────────────────────────────────

  describe('error + retry', () => {
    it('transitions to error state on chat-error event', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start streaming
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Receive some tokens
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Partial response...',
          isThinking: false,
        });
      });

      expect(result.current.isStreaming).toBe(true);
      expect(result.current.streamingMessage?.content).toBe('Partial response...');

      // Error occurs
      act(() => {
        emitEvent({
          type: 'chat-error',
          requestId: 'req-1',
          sessionId: 'session-1',
          message: 'Connection reset by peer',
          classification: 'transient',
          canRetry: true,
        });
      });

      // State transitions to error
      expect(result.current.isStreaming).toBe(false);
      // Partial content is preserved as a message
      expect(result.current.messages).toHaveLength(2); // user + partial assistant
      const partialMsg = result.current.messages[1];
      expect(partialMsg.role).toBe('assistant');
      expect(partialMsg.content).toBe('Partial response...');
      expect(partialMsg.isComplete).toBe(false);
      // Streaming message is cleared
      expect(result.current.streamingMessage).toBeNull();
    });

    it('retries the last message by re-sending it', async () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Send the original message
      await act(async () => {
        await result.current.sendMessage('Do something complex', []);
      });

      // Start and error
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage({ content: 'Do something complex' }),
        });
      });

      act(() => {
        emitEvent({
          type: 'chat-error',
          requestId: 'req-1',
          sessionId: 'session-1',
          message: 'Model not responding',
          classification: 'transient',
          canRetry: true,
        });
      });

      // Clear the mock call count
      mockSendAgentChatMessage.mockClear();

      // Retry
      act(() => {
        result.current.retryLastMessage();
      });

      // Verify retry sends the same message
      expect(mockSendAgentChatMessage).toHaveBeenCalledTimes(1);
      expect(mockSendAgentChatMessage).toHaveBeenCalledWith({
        sessionId: 'session-1',
        content: 'Do something complex',
        model: 'llama3',
        endpoint: 'http://localhost:11434',
        attachments: undefined,
      });
    });

    it('handles connection lost event', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start streaming
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      expect(result.current.isConnected).toBe(true);

      // Connection lost
      act(() => {
        emitEvent({
          type: 'connection-lost',
          sessionId: 'session-1',
          lastEventAt: '2024-03-15T10:00:05.000Z',
          timestamp: '2024-03-15T10:00:35.000Z',
        });
      });

      expect(result.current.isConnected).toBe(false);
    });

    it('handles stop generation during streaming', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start streaming
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Some tokens
      act(() => {
        emitEvent({
          type: 'chat-token',
          requestId: 'req-1',
          sessionId: 'session-1',
          delta: 'Interrupted content',
          isThinking: false,
        });
      });

      expect(result.current.isStreaming).toBe(true);

      // User stops generation
      act(() => {
        result.current.stopGeneration();
      });

      // IPC stop called
      expect(mockStopAgentGeneration).toHaveBeenCalledWith('session-1');
      // Streaming stopped, partial content preserved
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.streamingMessage).toBeNull();
      // Partial message added to messages
      const lastMsg = result.current.messages[result.current.messages.length - 1];
      expect(lastMsg.role).toBe('assistant');
      expect(lastMsg.content).toBe('Interrupted content');
      expect(lastMsg.isComplete).toBe(false);
    });

    it('task-complete event returns state to idle with completion summary', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      // Start chat
      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      // Task completes
      act(() => {
        emitEvent({
          type: 'task-complete',
          requestId: 'req-1',
          sessionId: 'session-1',
          summary: {
            stepsCompleted: 4,
            totalSteps: 4,
            duration: 25000,
            artifactCount: 5,
            outcome: 'All tasks completed successfully',
            timestamp: '2024-03-15T10:01:00.000Z',
          },
          timestamp: '2024-03-15T10:01:00.000Z',
        });
      });

      expect(result.current.isStreaming).toBe(false);
      expect(result.current.completionSummary).not.toBeNull();
      expect(result.current.completionSummary?.stepsCompleted).toBe(4);
      expect(result.current.completionSummary?.outcome).toBe('All tasks completed successfully');
    });
  });

  // ─── Test: Reasoning events ────────────────────────────────────────────────

  describe('reasoning event handling', () => {
    it('records plan reasoning blocks', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'reasoning',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'plan-1',
          reasoningType: 'plan',
          content: 'I will create the project structure first.',
          steps: [
            { id: 's1', title: 'Create directory structure', status: 'active' },
            { id: 's2', title: 'Write configuration', status: 'pending' },
            { id: 's3', title: 'Implement components', status: 'pending' },
          ],
          timestamp: '2024-03-15T10:00:01.000Z',
        });
      });

      expect(result.current.reasoningBlocks).toHaveLength(1);
      expect(result.current.reasoningBlocks[0].type).toBe('plan');
      expect(result.current.reasoningBlocks[0].content).toBe('I will create the project structure first.');
      expect(result.current.reasoningBlocks[0].steps).toHaveLength(3);
    });

    it('records replan events with modified steps', () => {
      const { result } = renderHook(() => useAgentChat(defaultConfig));

      act(() => {
        emitEvent({
          type: 'chat-started',
          requestId: 'req-1',
          sessionId: 'session-1',
          model: 'llama3',
          endpoint: 'http://localhost:11434',
          userMessage: createUserMessage(),
        });
      });

      act(() => {
        emitEvent({
          type: 'reasoning',
          requestId: 'req-1',
          sessionId: 'session-1',
          blockId: 'replan-1',
          reasoningType: 'replan',
          content: 'Need to adjust approach due to dependency issue.',
          steps: [
            { id: 's1', title: 'Fix dependency', status: 'active' },
            { id: 's2', title: 'Retry build', status: 'pending' },
          ],
          removedSteps: ['s3'],
          newSteps: [
            { id: 's4', title: 'Install alternative package', status: 'pending' },
          ],
          timestamp: '2024-03-15T10:00:05.000Z',
        });
      });

      expect(result.current.reasoningBlocks).toHaveLength(1);
      expect(result.current.reasoningBlocks[0].type).toBe('replan');
      expect(result.current.reasoningBlocks[0].removedSteps).toEqual(['s3']);
      expect(result.current.reasoningBlocks[0].newSteps).toHaveLength(1);
    });
  });
});
