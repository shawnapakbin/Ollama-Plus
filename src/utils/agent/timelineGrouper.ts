/**
 * Timeline Grouper Utility
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Groups sequential tool-call events from the agent chat stream into
 * logical groups. When 2+ consecutive tool-call-started events appear
 * without an intervening chat-token or chat-completed event, they are
 * grouped into a single array for rendering as a collapsible
 * "Agent Actions" container.
 */

import type { AgentChatStreamEvent, ToolUseBlockState } from '../../types/agentChat';

/**
 * Converts a tool-call-started event into a ToolUseBlockState with
 * initial "running" status.
 */
function toolCallEventToBlockState(
  event: Extract<AgentChatStreamEvent, { type: 'tool-call-started' }>
): ToolUseBlockState {
  return {
    id: event.blockId,
    tool: event.tool,
    category: event.category,
    params: event.params,
    output: null,
    status: 'running',
    error: null,
    duration: null,
    timestamp: event.timestamp,
    afterMessageId: null,
  };
}

/**
 * Groups sequential tool-call-started events from the agent chat stream.
 *
 * - Iterates through events, collecting consecutive tool-call-started events.
 * - When a separator event (chat-token or chat-completed) or a non-tool-call
 *   event is encountered, the current group is flushed:
 *   - 1 item → emitted as a single ToolUseBlockState
 *   - 2+ items → emitted as a ToolUseBlockState[] (grouped)
 * - Non-tool-call-started events that are not separators also flush the group.
 *
 * @param events - Array of AgentChatStreamEvent from the IPC stream
 * @returns Array where each element is either a single ToolUseBlockState
 *          or an array of ToolUseBlockState[] (representing a grouped set)
 */
export function groupSequentialToolCalls(
  events: AgentChatStreamEvent[]
): (ToolUseBlockState | ToolUseBlockState[])[] {
  const result: (ToolUseBlockState | ToolUseBlockState[])[] = [];
  let currentGroup: ToolUseBlockState[] = [];

  function flushGroup(): void {
    if (currentGroup.length === 0) return;

    if (currentGroup.length === 1) {
      result.push(currentGroup[0]);
    } else {
      result.push([...currentGroup]);
    }
    currentGroup = [];
  }

  for (const event of events) {
    if (event.type === 'tool-call-started') {
      currentGroup.push(toolCallEventToBlockState(event));
    } else {
      // Any non-tool-call-started event flushes the current group
      flushGroup();
    }
  }

  // Flush any remaining group at the end
  flushGroup();

  return result;
}
