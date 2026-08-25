/**
 * Unit tests for AgentChatStream component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests:
 * - Chronological rendering order of messages and timeline items
 * - Tool block insertion at correct chronological positions
 * - Scroll-to-bottom button visibility based on scroll state
 *
 * Requirements: 2.1, 6.2, 12.2
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AgentChatStream } from '../../../src/components/Agent/AgentChatStream';
import type {
  ChatMessage,
  StreamingMessage,
  ToolUseBlockState,
  ReasoningBlockState,
  ApprovalGateState,
  CompletionSummaryData,
} from '../../../src/types/agentChat';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock useAutoScroll hook to control isAtBottom state
const mockScrollToBottom = vi.fn();
const mockContainerRef = { current: document.createElement('div') };
let mockIsAtBottom = true;

vi.mock('../../../src/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({
    containerRef: mockContainerRef,
    isAtBottom: mockIsAtBottom,
    scrollToBottom: mockScrollToBottom,
  }),
}));

// Mock child components to simplify rendering and make assertions easier
vi.mock('../../../src/components/Agent/MessageCard', () => ({
  MessageCard: ({ message, isStreaming }: { message: ChatMessage; isStreaming?: boolean }) => (
    <div data-testid={`message-${message.id}`} data-role={message.role} data-streaming={isStreaming || false}>
      {message.content}
    </div>
  ),
}));

vi.mock('../../../src/components/Agent/ToolUseBlock', () => ({
  ToolUseBlock: ({ block }: { block: ToolUseBlockState }) => (
    <div data-testid={`toolblock-${block.id}`} data-tool={block.tool}>
      {block.tool}
    </div>
  ),
}));

vi.mock('../../../src/components/Agent/ToolUseGroup', () => ({
  ToolUseGroup: ({ blocks }: { blocks: ToolUseBlockState[] }) => (
    <div data-testid={`toolgroup-${blocks[0].id}`} data-count={blocks.length}>
      {blocks.map((b) => b.tool).join(', ')}
    </div>
  ),
}));

vi.mock('../../../src/components/Agent/ReasoningIndicator', () => ({
  ReasoningIndicator: ({ block }: { block: ReasoningBlockState }) => (
    <div data-testid={`reasoning-${block.id}`} data-type={block.type}>
      {block.content}
    </div>
  ),
}));

vi.mock('../../../src/components/Agent/ApprovalGateBlock', () => ({
  ApprovalGateBlock: ({ gate }: { gate: ApprovalGateState }) => (
    <div data-testid={`gate-${gate.gateId}`} data-status={gate.status}>
      {gate.action}
    </div>
  ),
}));

vi.mock('../../../src/components/Agent/CompletionSummary', () => ({
  CompletionSummary: ({ data }: { data: CompletionSummaryData }) => (
    <div data-testid="completion-summary">{data.outcome}</div>
  ),
}));

vi.mock('../../../src/components/Agent/ConnectionLostBanner', () => ({
  ConnectionLostBanner: ({ isVisible }: { isVisible: boolean }) => (
    isVisible ? <div data-testid="connection-lost-banner">Connection lost</div> : null
  ),
}));

vi.mock('../../../src/components/Agent/ScrollToBottomButton', () => ({
  ScrollToBottomButton: ({ isVisible, onClick }: { isVisible: boolean; onClick: () => void }) => (
    <button
      data-testid="scroll-to-bottom"
      data-visible={isVisible}
      onClick={onClick}
      style={{ display: isVisible ? 'block' : 'none' }}
    >
      Scroll to bottom
    </button>
  ),
}));

// Mock CSS imports
vi.mock('../../../src/components/Agent/AgentChatStream.css', () => ({}));

// ─── Test Data Factories ─────────────────────────────────────────────────────

function createMessage(overrides: Partial<ChatMessage> & { id: string; timestamp: string }): ChatMessage {
  return {
    sessionId: 'session-1',
    role: 'user',
    content: `Message ${overrides.id}`,
    displayLabel: 'User',
    attachments: [],
    thinkingContent: null,
    isComplete: true,
    ...overrides,
  };
}

function createToolBlock(overrides: Partial<ToolUseBlockState> & { id: string; timestamp: string }): ToolUseBlockState {
  return {
    tool: 'read_file',
    category: 'file',
    params: {},
    output: null,
    status: 'success',
    error: null,
    duration: 100,
    afterMessageId: null,
    ...overrides,
  };
}

function createReasoningBlock(overrides: Partial<ReasoningBlockState> & { id: string; timestamp: string }): ReasoningBlockState {
  return {
    type: 'thinking',
    content: 'Thinking...',
    isExpanded: false,
    afterMessageId: null,
    ...overrides,
  };
}

function createApprovalGate(overrides: Partial<ApprovalGateState> & { gateId: string; timestamp: string }): ApprovalGateState {
  return {
    action: 'delete_file',
    tool: 'terminal',
    category: 'terminal',
    params: {},
    riskExplanation: 'This is risky',
    status: 'pending',
    afterMessageId: null,
    ...overrides,
  };
}

// ─── Default Props ───────────────────────────────────────────────────────────

function defaultProps(overrides?: Partial<React.ComponentProps<typeof AgentChatStream>>) {
  return {
    messages: [] as ChatMessage[],
    streamingMessage: null,
    toolBlocks: [] as ToolUseBlockState[],
    reasoningBlocks: [] as ReasoningBlockState[],
    approvalGates: [] as ApprovalGateState[],
    completionSummary: null,
    isConnected: true,
    onScrollToBlock: vi.fn(),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onRetry: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AgentChatStream', () => {
  beforeEach(() => {
    mockIsAtBottom = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Chronological rendering order', () => {
    it('renders messages in ascending timestamp order', () => {
      const messages = [
        createMessage({ id: 'msg-3', timestamp: '2024-01-01T03:00:00.000Z', content: 'Third' }),
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z', content: 'First' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T02:00:00.000Z', content: 'Second' }),
      ];

      const { container } = render(<AgentChatStream {...defaultProps({ messages })} />);

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(3);

      // Verify chronological order: msg-1, msg-2, msg-3
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="message-msg-3"]')).not.toBeNull();
    });

    it('renders mixed timeline items (messages, tools, reasoning) in chronological order', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z', role: 'user' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T04:00:00.000Z', role: 'assistant' }),
      ];
      const toolBlocks = [
        createToolBlock({ id: 'tool-1', timestamp: '2024-01-01T02:00:00.000Z' }),
      ];
      const reasoningBlocks = [
        createReasoningBlock({ id: 'reason-1', timestamp: '2024-01-01T03:00:00.000Z' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks, reasoningBlocks })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(4);

      // Order: msg-1 (01:00) → tool-1 (02:00) → reason-1 (03:00) → msg-2 (04:00)
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolblock-tool-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="reasoning-reason-1"]')).not.toBeNull();
      expect(items[3].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();
    });

    it('renders approval gates in their chronological position', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T03:00:00.000Z' }),
      ];
      const approvalGates = [
        createApprovalGate({ gateId: 'gate-1', timestamp: '2024-01-01T02:00:00.000Z' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, approvalGates })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(3);

      // Order: msg-1 (01:00) → gate-1 (02:00) → msg-2 (03:00)
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="gate-gate-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();
    });

    it('renders all timeline item types together in correct order', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z' }),
        createMessage({ id: 'msg-5', timestamp: '2024-01-01T05:00:00.000Z' }),
      ];
      const toolBlocks = [
        createToolBlock({ id: 'tool-1', timestamp: '2024-01-01T02:00:00.000Z' }),
      ];
      const reasoningBlocks = [
        createReasoningBlock({ id: 'reason-1', timestamp: '2024-01-01T03:00:00.000Z' }),
      ];
      const approvalGates = [
        createApprovalGate({ gateId: 'gate-1', timestamp: '2024-01-01T04:00:00.000Z' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks, reasoningBlocks, approvalGates })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(5);

      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolblock-tool-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="reasoning-reason-1"]')).not.toBeNull();
      expect(items[3].querySelector('[data-testid="gate-gate-1"]')).not.toBeNull();
      expect(items[4].querySelector('[data-testid="message-msg-5"]')).not.toBeNull();
    });
  });

  describe('Tool block insertion at correct positions', () => {
    it('inserts a single tool block between messages based on timestamp', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T10:00:00.000Z', content: 'Do something' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T10:05:00.000Z', content: 'Done' }),
      ];
      const toolBlocks = [
        createToolBlock({ id: 'tool-1', timestamp: '2024-01-01T10:02:00.000Z', tool: 'write_file' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(3);

      // Tool block appears between the two messages
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolblock-tool-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();
    });

    it('groups consecutive tool blocks with the same afterMessageId into a ToolUseGroup', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T10:00:00.000Z' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T10:10:00.000Z' }),
      ];
      const toolBlocks = [
        createToolBlock({
          id: 'tool-1',
          timestamp: '2024-01-01T10:02:00.000Z',
          tool: 'read_file',
          afterMessageId: 'msg-1',
        }),
        createToolBlock({
          id: 'tool-2',
          timestamp: '2024-01-01T10:03:00.000Z',
          tool: 'write_file',
          afterMessageId: 'msg-1',
        }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(3);

      // Should be grouped as ToolUseGroup
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolgroup-tool-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();

      // Verify the group has the correct count
      const group = items[1].querySelector('[data-testid="toolgroup-tool-1"]');
      expect(group?.getAttribute('data-count')).toBe('2');
    });

    it('renders individual tool blocks when they have different afterMessageIds', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T10:00:00.000Z' }),
        createMessage({ id: 'msg-2', timestamp: '2024-01-01T10:05:00.000Z' }),
        createMessage({ id: 'msg-3', timestamp: '2024-01-01T10:10:00.000Z' }),
      ];
      const toolBlocks = [
        createToolBlock({
          id: 'tool-1',
          timestamp: '2024-01-01T10:02:00.000Z',
          tool: 'read_file',
          afterMessageId: 'msg-1',
        }),
        createToolBlock({
          id: 'tool-2',
          timestamp: '2024-01-01T10:07:00.000Z',
          tool: 'execute_command',
          afterMessageId: 'msg-2',
        }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(5);

      // Each tool block rendered individually (not grouped)
      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolblock-tool-1"]')).not.toBeNull();
      expect(items[2].querySelector('[data-testid="message-msg-2"]')).not.toBeNull();
      expect(items[3].querySelector('[data-testid="toolblock-tool-2"]')).not.toBeNull();
      expect(items[4].querySelector('[data-testid="message-msg-3"]')).not.toBeNull();
    });

    it('places tool blocks at the end when their timestamps are after all messages', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T10:00:00.000Z' }),
      ];
      const toolBlocks = [
        createToolBlock({ id: 'tool-1', timestamp: '2024-01-01T10:05:00.000Z', tool: 'terminal' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, toolBlocks })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(2);

      expect(items[0].querySelector('[data-testid="message-msg-1"]')).not.toBeNull();
      expect(items[1].querySelector('[data-testid="toolblock-tool-1"]')).not.toBeNull();
    });
  });

  describe('Scroll-to-bottom button visibility', () => {
    it('hides scroll-to-bottom button when user is at the bottom', () => {
      mockIsAtBottom = true;

      render(<AgentChatStream {...defaultProps()} />);

      const button = screen.getByTestId('scroll-to-bottom');
      expect(button.getAttribute('data-visible')).toBe('false');
    });

    it('shows scroll-to-bottom button when user is scrolled up', () => {
      mockIsAtBottom = false;

      render(<AgentChatStream {...defaultProps()} />);

      const button = screen.getByTestId('scroll-to-bottom');
      expect(button.getAttribute('data-visible')).toBe('true');
    });

    it('hides scroll-to-bottom button by default (initially at bottom)', () => {
      mockIsAtBottom = true;

      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z', content: 'Hello' }),
      ];

      render(<AgentChatStream {...defaultProps({ messages })} />);

      const button = screen.getByTestId('scroll-to-bottom');
      expect(button.getAttribute('data-visible')).toBe('false');
    });
  });

  describe('Streaming message rendering', () => {
    it('renders a streaming message at the end of the timeline', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z' }),
      ];
      const streamingMessage: StreamingMessage = {
        id: 'streaming-1',
        sessionId: 'session-1',
        content: 'Generating response...',
        thinkingContent: null,
        startedAt: '2024-01-01T02:00:00.000Z',
        model: 'llama3',
      };

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, streamingMessage })} />
      );

      // The streaming message should appear after the timeline items
      const streamingEl = container.querySelector('[data-testid="message-streaming-1"]');
      expect(streamingEl).not.toBeNull();
      expect(streamingEl?.getAttribute('data-streaming')).toBe('true');
    });

    it('does not render streaming message when null', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z' }),
      ];

      const { container } = render(
        <AgentChatStream {...defaultProps({ messages, streamingMessage: null })} />
      );

      const items = container.querySelectorAll('.agent-chat-stream__item');
      expect(items.length).toBe(1);
    });
  });

  describe('Completion summary rendering', () => {
    it('renders completion summary after timeline items', () => {
      const messages = [
        createMessage({ id: 'msg-1', timestamp: '2024-01-01T01:00:00.000Z' }),
      ];
      const completionSummary: CompletionSummaryData = {
        stepsCompleted: 5,
        totalSteps: 5,
        duration: 12000,
        artifactCount: 3,
        outcome: 'All steps completed successfully',
        timestamp: '2024-01-01T02:00:00.000Z',
      };

      render(
        <AgentChatStream {...defaultProps({ messages, completionSummary })} />
      );

      const summary = screen.getByTestId('completion-summary');
      expect(summary).not.toBeNull();
      expect(summary.textContent).toContain('All steps completed successfully');
    });
  });

  describe('Connection lost banner', () => {
    it('shows connection lost banner when disconnected', () => {
      render(<AgentChatStream {...defaultProps({ isConnected: false })} />);

      const banner = screen.getByTestId('connection-lost-banner');
      expect(banner).not.toBeNull();
    });

    it('hides connection lost banner when connected', () => {
      render(<AgentChatStream {...defaultProps({ isConnected: true })} />);

      expect(screen.queryByTestId('connection-lost-banner')).toBeNull();
    });
  });
});
