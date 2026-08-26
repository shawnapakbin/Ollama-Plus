/**
 * Agent Chat Stream Listener Hook
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Subscribes to the agent chat IPC stream on mount and routes
 * events to the appropriate handler callback. Uses refs for handlers
 * to avoid stale closures without needing to re-subscribe.
 */
import { useEffect, useRef } from 'react';
import type { AgentChatStreamEvent } from '../types/agentChat';

// ─── Event type aliases for consumer convenience ─────────────────────────────

type AgentChatStartedEvent = Extract<AgentChatStreamEvent, { type: 'chat-started' }>;
type AgentChatTokenEvent = Extract<AgentChatStreamEvent, { type: 'chat-token' }>;
type AgentChatCompletedEvent = Extract<AgentChatStreamEvent, { type: 'chat-completed' }>;
type AgentChatErrorEvent = Extract<AgentChatStreamEvent, { type: 'chat-error' }>;
type AgentToolCallEvent = Extract<AgentChatStreamEvent, { type: 'tool-call-started' }>;
type AgentToolResultEvent = Extract<AgentChatStreamEvent, { type: 'tool-call-completed' }>;
type AgentReasoningEvent = Extract<AgentChatStreamEvent, { type: 'reasoning' }>;
type AgentApprovalGateEvent = Extract<AgentChatStreamEvent, { type: 'approval-gate' }>;
type AgentTaskCompleteEvent = Extract<AgentChatStreamEvent, { type: 'task-complete' }>;
type AgentConnectionLostEvent = Extract<AgentChatStreamEvent, { type: 'connection-lost' }>;

// Plan and replan are subtypes of reasoning, filtered by reasoningType
type AgentPlanGeneratedEvent = AgentReasoningEvent;
type AgentReplanEvent = AgentReasoningEvent;

// ─── Hook options ────────────────────────────────────────────────────────────

export type UseAgentChatStreamOptions = {
  onChatStarted: (event: AgentChatStartedEvent) => void;
  onChatToken: (event: AgentChatTokenEvent) => void;
  onChatCompleted: (event: AgentChatCompletedEvent) => void;
  onToolCall: (event: AgentToolCallEvent) => void;
  onToolResult: (event: AgentToolResultEvent) => void;
  onReasoning: (event: AgentReasoningEvent) => void;
  onApprovalGate: (event: AgentApprovalGateEvent) => void;
  onPlanGenerated: (event: AgentPlanGeneratedEvent) => void;
  onReplan: (event: AgentReplanEvent) => void;
  onTaskComplete: (event: AgentTaskCompleteEvent) => void;
  onError: (event: AgentChatErrorEvent) => void;
  onConnectionLost: () => void;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Subscribes to window.electronAPI.onAgentChatStream on mount and routes
 * events to the appropriate handler callback. Uses refs for handlers
 * to avoid stale closures without needing to re-subscribe.
 */
export function useAgentChatStream(options: UseAgentChatStreamOptions): void {
  const onChatStartedRef = useRef(options.onChatStarted);
  const onChatTokenRef = useRef(options.onChatToken);
  const onChatCompletedRef = useRef(options.onChatCompleted);
  const onToolCallRef = useRef(options.onToolCall);
  const onToolResultRef = useRef(options.onToolResult);
  const onReasoningRef = useRef(options.onReasoning);
  const onApprovalGateRef = useRef(options.onApprovalGate);
  const onPlanGeneratedRef = useRef(options.onPlanGenerated);
  const onReplanRef = useRef(options.onReplan);
  const onTaskCompleteRef = useRef(options.onTaskComplete);
  const onErrorRef = useRef(options.onError);
  const onConnectionLostRef = useRef(options.onConnectionLost);

  // Keep refs fresh on every render
  useEffect(() => {
    onChatStartedRef.current = options.onChatStarted;
    onChatTokenRef.current = options.onChatToken;
    onChatCompletedRef.current = options.onChatCompleted;
    onToolCallRef.current = options.onToolCall;
    onToolResultRef.current = options.onToolResult;
    onReasoningRef.current = options.onReasoning;
    onApprovalGateRef.current = options.onApprovalGate;
    onPlanGeneratedRef.current = options.onPlanGenerated;
    onReplanRef.current = options.onReplan;
    onTaskCompleteRef.current = options.onTaskComplete;
    onErrorRef.current = options.onError;
    onConnectionLostRef.current = options.onConnectionLost;
  });

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onAgentChatStream((event: AgentChatStreamEvent) => {
      switch (event.type) {
        case 'chat-started':
          onChatStartedRef.current(event);
          break;
        case 'chat-token':
          onChatTokenRef.current(event);
          break;
        case 'chat-completed':
          onChatCompletedRef.current(event);
          break;
        case 'chat-error':
          onErrorRef.current(event);
          break;
        case 'tool-call-started':
          onToolCallRef.current(event);
          break;
        case 'tool-call-completed':
          onToolResultRef.current(event);
          break;
        case 'reasoning':
          // Route reasoning events to specific callbacks based on reasoningType
          if (event.reasoningType === 'plan') {
            onPlanGeneratedRef.current(event);
          } else if (event.reasoningType === 'replan') {
            onReplanRef.current(event);
          } else {
            onReasoningRef.current(event);
          }
          break;
        case 'approval-gate':
          onApprovalGateRef.current(event);
          break;
        case 'task-complete':
          onTaskCompleteRef.current(event);
          break;
        case 'connection-lost':
          onConnectionLostRef.current();
          break;
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);
}

// ─── Re-export event types for consumer use ──────────────────────────────────

export type {
  AgentChatStartedEvent,
  AgentChatTokenEvent,
  AgentChatCompletedEvent,
  AgentChatErrorEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentReasoningEvent,
  AgentApprovalGateEvent,
  AgentPlanGeneratedEvent,
  AgentReplanEvent,
  AgentTaskCompleteEvent,
  AgentConnectionLostEvent,
};
