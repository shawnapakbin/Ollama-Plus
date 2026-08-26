/**
 * Agent Chat State Manager Hook
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Primary state manager for the Agent chat page. Coordinates between
 * the IPC stream listener (useAgentChatStream), session storage
 * (useSessionStorage), and UI state. Manages the AgentChatState
 * machine: idle → streaming → tool-executing → waiting-approval →
 * completed / error / disconnected.
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 11.1, 12.1
 */
import { useCallback, useState, useRef } from 'react';
import type {
  AgentChatState,
  AgentSession,
  AttachmentFile,
  ChatMessage,
  StreamingMessage,
  ToolUseBlockState,
  ReasoningBlockState,
  ApprovalGateState,
  CompletionSummaryData,
} from '../types/agentChat';
import { useAgentChatStream } from './useAgentChatStream';
import { useSessionStorage } from './useSessionStorage';
import { appendToken } from '../utils/agent/streamingReducer';

// ─── Hook config ─────────────────────────────────────────────────────────────

export interface UseAgentChatConfig {
  model: string;
  endpoint: string;
}

// ─── Return type ─────────────────────────────────────────────────────────────

export interface UseAgentChatReturn {
  // State
  messages: ChatMessage[];
  streamingMessage: StreamingMessage | null;
  toolBlocks: ToolUseBlockState[];
  reasoningBlocks: ReasoningBlockState[];
  approvalGates: ApprovalGateState[];
  completionSummary: CompletionSummaryData | null;
  session: AgentSession | null;
  isStreaming: boolean;
  isConnected: boolean;
  isPendingApproval: boolean;

  // Actions
  sendMessage: (content: string, attachments: AttachmentFile[]) => Promise<void>;
  stopGeneration: () => void;
  approveGate: (gateId: string) => void;
  denyGate: (gateId: string) => void;
  retryLastMessage: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  startNewSession: () => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Primary state manager for the Agent chat interface.
 *
 * Manages the full state machine for agent interactions:
 * - idle: Ready for user input
 * - streaming: Receiving tokens from the LLM
 * - tool-executing: Agent is running a tool
 * - waiting-approval: An approval gate is pending user decision
 * - completed: Task execution finished (transitions back to idle)
 * - error: An error occurred (retryable)
 * - disconnected: Connection lost to the backend
 */
export function useAgentChat(config: UseAgentChatConfig): UseAgentChatReturn {
  // ─── Core state ──────────────────────────────────────────────────────────────

  const [chatState, setChatState] = useState<AgentChatState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [toolBlocks, setToolBlocks] = useState<ToolUseBlockState[]>([]);
  const [reasoningBlocks, setReasoningBlocks] = useState<ReasoningBlockState[]>([]);
  const [approvalGates, setApprovalGates] = useState<ApprovalGateState[]>([]);
  const [completionSummary, setCompletionSummary] = useState<CompletionSummaryData | null>(null);
  const [isConnected, setIsConnected] = useState(true);

  // Track the current session ID for IPC calls
  const sessionIdRef = useRef<string | null>(null);
  // Track the last user message for retry
  const lastUserMessageRef = useRef<{ content: string; attachments: AttachmentFile[] } | null>(null);

  // ─── Session storage ─────────────────────────────────────────────────────────

  const {
    activeSession,
    loadSession: loadSessionFromStorage,
    persistMessage,
    persistEvent,
  } = useSessionStorage();

  // ─── Derived state ───────────────────────────────────────────────────────────

  const isStreaming = chatState === 'streaming';
  const isPendingApproval = chatState === 'waiting-approval';

  // ─── Stream event handlers ───────────────────────────────────────────────────

  useAgentChatStream({
    onChatStarted: (event) => {
      sessionIdRef.current = event.sessionId;
      setChatState('streaming');

      // Add the user message to messages
      setMessages((prev) => [...prev, event.userMessage]);

      // Persist user message to session
      persistMessage(event.sessionId, event.userMessage);

      // Create streaming message placeholder
      setStreamingMessage({
        id: `streaming-${event.requestId}`,
        sessionId: event.sessionId,
        content: '',
        thinkingContent: null,
        startedAt: new Date().toISOString(),
        model: event.model,
      });

      // Reset completion summary for new turn
      setCompletionSummary(null);
    },

    onChatToken: (event) => {
      setStreamingMessage((prev) => {
        if (!prev) return prev;
        if (event.isThinking) {
          return {
            ...prev,
            thinkingContent: appendToken(prev.thinkingContent ?? '', event.delta),
          };
        }
        return {
          ...prev,
          content: appendToken(prev.content, event.delta),
        };
      });
    },

    onChatCompleted: (event) => {
      // Finalize: add the completed assistant message
      setMessages((prev) => [...prev, event.assistantMessage]);
      setStreamingMessage(null);
      setChatState('idle');

      // Persist assistant message to session
      persistMessage(event.sessionId, event.assistantMessage);
    },

    onToolCall: (event) => {
      setChatState('tool-executing');

      const newBlock: ToolUseBlockState = {
        id: event.blockId,
        tool: event.tool,
        category: event.category,
        params: event.params,
        output: null,
        status: 'running',
        error: null,
        duration: null,
        timestamp: event.timestamp,
        afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };

      setToolBlocks((prev) => [...prev, newBlock]);

      // Persist tool-use event
      persistEvent(event.sessionId, { type: 'tool-use', block: newBlock });
    },

    onToolResult: (event) => {
      setChatState('streaming');

      setToolBlocks((prev) =>
        prev.map((block) =>
          block.id === event.blockId
            ? {
                ...block,
                output: event.output,
                status: event.status,
                error: event.error,
                duration: event.duration,
              }
            : block
        )
      );
    },

    onReasoning: (event) => {
      const newBlock: ReasoningBlockState = {
        id: event.blockId,
        type: event.reasoningType,
        content: event.content,
        steps: event.steps,
        removedSteps: event.removedSteps,
        newSteps: event.newSteps,
        isExpanded: true,
        timestamp: event.timestamp,
        afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };

      setReasoningBlocks((prev) => [...prev, newBlock]);

      // Persist reasoning event
      persistEvent(event.sessionId, { type: 'reasoning', block: newBlock });
    },

    onPlanGenerated: (event) => {
      const newBlock: ReasoningBlockState = {
        id: event.blockId,
        type: 'plan',
        content: event.content,
        steps: event.steps,
        removedSteps: event.removedSteps,
        newSteps: event.newSteps,
        isExpanded: true,
        timestamp: event.timestamp,
        afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };

      setReasoningBlocks((prev) => [...prev, newBlock]);
      persistEvent(event.sessionId, { type: 'reasoning', block: newBlock });
    },

    onReplan: (event) => {
      const newBlock: ReasoningBlockState = {
        id: event.blockId,
        type: 'replan',
        content: event.content,
        steps: event.steps,
        removedSteps: event.removedSteps,
        newSteps: event.newSteps,
        isExpanded: true,
        timestamp: event.timestamp,
        afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };

      setReasoningBlocks((prev) => [...prev, newBlock]);
      persistEvent(event.sessionId, { type: 'reasoning', block: newBlock });
    },

    onApprovalGate: (event) => {
      setChatState('waiting-approval');

      const newGate: ApprovalGateState = {
        gateId: event.gateId,
        action: event.action,
        tool: event.tool,
        category: event.category,
        params: event.params,
        riskExplanation: event.riskExplanation,
        status: 'pending',
        timestamp: event.timestamp,
        afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
      };

      setApprovalGates((prev) => [...prev, newGate]);
      persistEvent(event.sessionId, { type: 'approval-gate', gate: newGate });
    },

    onTaskComplete: (event) => {
      setCompletionSummary(event.summary);
      setChatState('idle');

      persistEvent(event.sessionId, {
        type: 'completion-summary',
        data: event.summary,
      });
    },

    onError: () => {
      setChatState('error');

      // Finalize any in-progress streaming with partial content
      if (streamingMessage) {
        const partialMessage: ChatMessage = {
          id: streamingMessage.id,
          sessionId: streamingMessage.sessionId,
          role: 'assistant',
          content: streamingMessage.content,
          displayLabel: streamingMessage.model,
          timestamp: streamingMessage.startedAt,
          attachments: [],
          thinkingContent: streamingMessage.thinkingContent,
          isComplete: false,
        };
        setMessages((prev) => [...prev, partialMessage]);
        setStreamingMessage(null);
      }
    },

    onConnectionLost: () => {
      setIsConnected(false);
      setChatState('disconnected');

      if (sessionIdRef.current) {
        persistEvent(sessionIdRef.current, {
          type: 'connection-lost',
          timestamp: new Date().toISOString(),
        });
      }
    },
  });

  // ─── Actions ─────────────────────────────────────────────────────────────────

  /**
   * Send a message to the agent. Triggers planning + execution if needed.
   * Creates a new session if none is active.
   */
  const sendMessage = useCallback(
    async (content: string, attachments: AttachmentFile[]): Promise<void> => {
      const api = window.electronAPI;
      if (!api?.sendAgentChatMessage) return;

      // Track for retry
      lastUserMessageRef.current = { content, attachments };

      // Reset connection state on new message
      setIsConnected(true);

      const result = await api.sendAgentChatMessage({
        sessionId: sessionIdRef.current ?? undefined,
        content,
        model: config.model,
        endpoint: config.endpoint,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      // Update session ID from response (handles first message creating session)
      sessionIdRef.current = result.sessionId;
    },
    [config.model, config.endpoint]
  );

  /**
   * Stop the current generation/execution.
   */
  const stopGeneration = useCallback((): void => {
    const api = window.electronAPI;
    if (!api?.stopAgentGeneration || !sessionIdRef.current) return;

    api.stopAgentGeneration(sessionIdRef.current);

    // Finalize streaming message with partial content
    if (streamingMessage) {
      const partialMessage: ChatMessage = {
        id: streamingMessage.id,
        sessionId: streamingMessage.sessionId,
        role: 'assistant',
        content: streamingMessage.content,
        displayLabel: streamingMessage.model,
        timestamp: streamingMessage.startedAt,
        attachments: [],
        thinkingContent: streamingMessage.thinkingContent,
        isComplete: false,
      };
      setMessages((prev) => [...prev, partialMessage]);
      setStreamingMessage(null);
    }

    setChatState('idle');
  }, [streamingMessage]);

  /**
   * Approve an approval gate, allowing the agent to proceed.
   */
  const approveGate = useCallback((gateId: string): void => {
    const api = window.electronAPI;
    if (!api?.approveAgentGate || !sessionIdRef.current) return;

    api.approveAgentGate(sessionIdRef.current, gateId);

    // Update local gate state to approved
    setApprovalGates((prev) =>
      prev.map((gate) =>
        gate.gateId === gateId ? { ...gate, status: 'approved' as const } : gate
      )
    );

    // Resume to tool-executing state
    setChatState('tool-executing');
  }, []);

  /**
   * Deny an approval gate, causing the agent to skip or replan.
   */
  const denyGate = useCallback((gateId: string): void => {
    const api = window.electronAPI;
    if (!api?.denyAgentGate || !sessionIdRef.current) return;

    api.denyAgentGate(sessionIdRef.current, gateId);

    // Update local gate state to denied
    setApprovalGates((prev) =>
      prev.map((gate) =>
        gate.gateId === gateId ? { ...gate, status: 'denied' as const } : gate
      )
    );

    // Agent will replan, so move back to streaming
    setChatState('streaming');
  }, []);

  /**
   * Re-send the last user message (for error recovery).
   */
  const retryLastMessage = useCallback((): void => {
    if (!lastUserMessageRef.current) return;
    const { content, attachments } = lastUserMessageRef.current;
    sendMessage(content, attachments);
  }, [sendMessage]);

  /**
   * Load a previous session and populate all state from stored data.
   */
  const loadSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const session = await loadSessionFromStorage(sessionId);
      sessionIdRef.current = session.id;

      // Populate state from the loaded session
      setMessages(session.messages);
      setStreamingMessage(null);
      setChatState('idle');
      setCompletionSummary(null);

      // Reconstruct tool blocks, reasoning blocks, and gates from timeline events
      const loadedToolBlocks: ToolUseBlockState[] = [];
      const loadedReasoningBlocks: ReasoningBlockState[] = [];
      const loadedApprovalGates: ApprovalGateState[] = [];

      for (const event of session.timelineEvents) {
        switch (event.type) {
          case 'tool-use':
            loadedToolBlocks.push(event.block);
            break;
          case 'tool-use-group':
            loadedToolBlocks.push(...event.blocks);
            break;
          case 'reasoning':
            loadedReasoningBlocks.push(event.block);
            break;
          case 'approval-gate':
            loadedApprovalGates.push(event.gate);
            break;
          case 'completion-summary':
            setCompletionSummary(event.data);
            break;
        }
      }

      setToolBlocks(loadedToolBlocks);
      setReasoningBlocks(loadedReasoningBlocks);
      setApprovalGates(loadedApprovalGates);
      setIsConnected(true);
    },
    [loadSessionFromStorage]
  );

  /**
   * Start a new empty session, clearing all current state.
   */
  const startNewSession = useCallback((): void => {
    sessionIdRef.current = null;
    setMessages([]);
    setStreamingMessage(null);
    setToolBlocks([]);
    setReasoningBlocks([]);
    setApprovalGates([]);
    setCompletionSummary(null);
    setChatState('idle');
    setIsConnected(true);
    lastUserMessageRef.current = null;
  }, []);

  // ─── Return ──────────────────────────────────────────────────────────────────

  return {
    messages,
    streamingMessage,
    toolBlocks,
    reasoningBlocks,
    approvalGates,
    completionSummary,
    session: activeSession,
    isStreaming,
    isConnected,
    isPendingApproval,
    sendMessage,
    stopGeneration,
    approveGate,
    denyGate,
    retryLastMessage,
    loadSession,
    startNewSession,
  };
}
