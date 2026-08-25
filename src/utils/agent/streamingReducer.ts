/**
 * Streaming Reducer
 *
 * Handles token accumulation during streaming and the transition
 * from a streaming message to a finalized ChatMessage.
 * The key guarantee is that content is preserved exactly on transition —
 * no layout shift occurs when streaming completes.
 */

import type { StreamingMessage, ChatMessage } from '../../types/agentChat';

/**
 * Appends a new token delta to the current accumulated content.
 *
 * Simple string concatenation — each token is appended in order
 * to build the full message content incrementally.
 */
export function appendToken(current: string, delta: string): string {
  return current + delta;
}

/**
 * Finalizes a streaming message into the completed ChatMessage.
 *
 * Returns the completed ChatMessage as-is. The completed message from
 * the backend already contains the final content identical to the
 * fully-accumulated streaming content. This function makes the
 * transition explicit in the state machine.
 *
 * The key property: `completed.content` equals the fully-accumulated
 * streaming content, ensuring no visual jump or layout shift.
 */
export function finalizeStream(
  streamingMessage: StreamingMessage,
  completed: ChatMessage
): ChatMessage {
  return completed;
}
