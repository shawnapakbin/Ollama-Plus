/**
 * AgentChatStream Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Primary scrollable timeline displaying user messages, assistant responses,
 * inline tool-use blocks, reasoning indicators, approval gates, and
 * completion summaries in chronological order.
 *
 * Integrates useAutoScroll for scroll management, ConnectionLostBanner
 * for disconnect state, and ScrollToBottomButton for manual re-engagement.
 *
 * Requirements: 1.1, 2.1, 6.1, 6.5, 10.5, 12.2
 */
import { useMemo } from 'react';
import type {
  ChatMessage,
  StreamingMessage,
  ToolUseBlockState,
  ReasoningBlockState,
  ApprovalGateState,
  CompletionSummaryData,
} from '../../types/agentChat';
import { sortTimeline } from '../../utils/agent/timelineSorter';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { MessageCard } from './MessageCard';
import { ToolUseBlock } from './ToolUseBlock';
import { ToolUseGroup } from './ToolUseGroup';
import { ReasoningIndicator } from './ReasoningIndicator';
import { ApprovalGateBlock } from './ApprovalGateBlock';
import { CompletionSummary } from './CompletionSummary';
import { ConnectionLostBanner } from './ConnectionLostBanner';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import './AgentChatStream.css';

// ─── Timeline Item Types ─────────────────────────────────────────────────────

type TimelineItem =
  | { kind: 'message'; data: ChatMessage; timestamp: string }
  | { kind: 'tool-block'; data: ToolUseBlockState; timestamp: string }
  | { kind: 'tool-group'; data: ToolUseBlockState[]; timestamp: string }
  | { kind: 'reasoning'; data: ReasoningBlockState; timestamp: string }
  | { kind: 'approval-gate'; data: ApprovalGateState; timestamp: string };

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AgentChatStreamProps {
  messages: ChatMessage[];
  streamingMessage: StreamingMessage | null;
  toolBlocks: ToolUseBlockState[];
  reasoningBlocks: ReasoningBlockState[];
  approvalGates: ApprovalGateState[];
  completionSummary: CompletionSummaryData | null;
  isConnected: boolean;
  onScrollToBlock: (blockId: string) => void;
  onApprove: (gateId: string) => void;
  onDeny: (gateId: string) => void;
  onRetry: () => void;
  onStop: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Groups consecutive tool blocks that share the same afterMessageId
 * into ToolUseGroup entries (2+ blocks) or individual entries (1 block).
 */
function groupToolBlocks(
  blocks: ToolUseBlockState[]
): Array<{ kind: 'tool-block'; data: ToolUseBlockState; timestamp: string } | { kind: 'tool-group'; data: ToolUseBlockState[]; timestamp: string }> {
  if (blocks.length === 0) return [];

  const sorted = sortTimeline(blocks);
  const result: Array<{ kind: 'tool-block'; data: ToolUseBlockState; timestamp: string } | { kind: 'tool-group'; data: ToolUseBlockState[]; timestamp: string }> = [];
  let currentGroup: ToolUseBlockState[] = [];

  for (const block of sorted) {
    if (currentGroup.length === 0) {
      currentGroup.push(block);
    } else {
      const lastBlock = currentGroup[currentGroup.length - 1];
      // Group consecutive tool blocks that share the same afterMessageId
      if (block.afterMessageId === lastBlock.afterMessageId) {
        currentGroup.push(block);
      } else {
        flushGroup(currentGroup, result);
        currentGroup = [block];
      }
    }
  }

  flushGroup(currentGroup, result);
  return result;
}

function flushGroup(
  group: ToolUseBlockState[],
  result: Array<{ kind: 'tool-block'; data: ToolUseBlockState; timestamp: string } | { kind: 'tool-group'; data: ToolUseBlockState[]; timestamp: string }>
): void {
  if (group.length === 0) return;
  if (group.length === 1) {
    result.push({ kind: 'tool-block', data: group[0], timestamp: group[0].timestamp });
  } else {
    // Use the earliest timestamp in the group for ordering
    result.push({ kind: 'tool-group', data: [...group], timestamp: group[0].timestamp });
  }
}

/**
 * Builds a unified, chronologically sorted timeline from all event sources.
 */
function buildTimeline(
  messages: ChatMessage[],
  toolBlocks: ToolUseBlockState[],
  reasoningBlocks: ReasoningBlockState[],
  approvalGates: ApprovalGateState[]
): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Add messages
  for (const message of messages) {
    items.push({ kind: 'message', data: message, timestamp: message.timestamp });
  }

  // Group and add tool blocks
  const groupedTools = groupToolBlocks(toolBlocks);
  for (const entry of groupedTools) {
    items.push(entry);
  }

  // Add reasoning blocks
  for (const block of reasoningBlocks) {
    items.push({ kind: 'reasoning', data: block, timestamp: block.timestamp });
  }

  // Add approval gates
  for (const gate of approvalGates) {
    items.push({ kind: 'approval-gate', data: gate, timestamp: gate.timestamp });
  }

  // Sort everything by timestamp (ascending chronological order)
  return sortTimeline(items);
}

// ─── Streaming Message Adapter ───────────────────────────────────────────────

/**
 * Converts a StreamingMessage into a ChatMessage-shaped object
 * for rendering via MessageCard with isStreaming=true.
 */
function streamingToChatMessage(streaming: StreamingMessage): ChatMessage {
  return {
    id: streaming.id,
    sessionId: streaming.sessionId,
    role: 'assistant',
    content: streaming.content,
    displayLabel: streaming.model,
    timestamp: streaming.startedAt,
    attachments: [],
    thinkingContent: streaming.thinkingContent,
    isComplete: false,
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function AgentChatStream({
  messages,
  streamingMessage,
  toolBlocks,
  reasoningBlocks,
  approvalGates,
  completionSummary,
  isConnected,
  onApprove,
  onDeny,
  onRetry,
}: AgentChatStreamProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useAutoScroll();

  // Build chronologically sorted timeline
  const timeline = useMemo(
    () => buildTimeline(messages, toolBlocks, reasoningBlocks, approvalGates),
    [messages, toolBlocks, reasoningBlocks, approvalGates]
  );

  return (
    <div className="agent-chat-stream" ref={containerRef as React.RefObject<HTMLDivElement>}>
      <div className="agent-chat-stream__content">
        {/* Rendered timeline items */}
        {timeline.map((item) => {
          switch (item.kind) {
            case 'message':
              return (
                <div key={`msg-${item.data.id}`} className="agent-chat-stream__item">
                  <MessageCard message={item.data} />
                </div>
              );

            case 'tool-block':
              return (
                <div
                  key={`tool-${item.data.id}`}
                  className="agent-chat-stream__item"
                  data-block-id={item.data.id}
                >
                  <ToolUseBlock block={item.data} />
                </div>
              );

            case 'tool-group':
              return (
                <div
                  key={`toolgroup-${item.data[0].id}`}
                  className="agent-chat-stream__item"
                  data-block-id={item.data[0].id}
                >
                  <ToolUseGroup blocks={item.data} />
                </div>
              );

            case 'reasoning':
              return (
                <div
                  key={`reasoning-${item.data.id}`}
                  className="agent-chat-stream__item"
                  data-block-id={item.data.id}
                >
                  <ReasoningIndicator block={item.data} />
                </div>
              );

            case 'approval-gate':
              return (
                <div
                  key={`gate-${item.data.gateId}`}
                  className="agent-chat-stream__item"
                  data-block-id={item.data.gateId}
                >
                  <ApprovalGateBlock
                    gate={item.data}
                    onApprove={onApprove}
                    onDeny={onDeny}
                  />
                </div>
              );

            default:
              return null;
          }
        })}

        {/* Streaming message (rendered at the end, in-progress) */}
        {streamingMessage && (
          <div className="agent-chat-stream__item">
            <MessageCard
              message={streamingToChatMessage(streamingMessage)}
              isStreaming={true}
            />
          </div>
        )}

        {/* Completion summary */}
        {completionSummary && (
          <div className="agent-chat-stream__item">
            <CompletionSummary data={completionSummary} />
          </div>
        )}

        {/* Connection lost banner */}
        <ConnectionLostBanner isVisible={!isConnected} onRetry={onRetry} />
      </div>

      {/* Scroll to bottom floating button */}
      <ScrollToBottomButton isVisible={!isAtBottom} onClick={scrollToBottom} />
    </div>
  );
}
