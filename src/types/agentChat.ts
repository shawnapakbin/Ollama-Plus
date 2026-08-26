/**
 * Agent Chat System Type Definitions
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Data models for the conversational agent chat interface.
 * Defines the chat-oriented IPC protocol, session persistence,
 * and all inline timeline element types.
 */

import type { Plan, Artifact, MemoryRecord } from './agent';

// ─── Attachment ──────────────────────────────────────────────────────────────

export interface AttachmentFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string; // Base64 encoded
}

// ─── Chat Messages ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string; // UUID
  sessionId: string;
  role: 'user' | 'assistant';
  content: string; // Markdown content
  displayLabel: string; // User name or model name
  timestamp: string; // ISO 8601
  attachments: AttachmentFile[];
  thinkingContent: string | null; // Content within <think> tags, rendered collapsibly
  isComplete: boolean; // false while streaming
}

export interface StreamingMessage {
  id: string;
  sessionId: string;
  content: string; // Accumulated tokens so far
  thinkingContent: string | null; // Accumulated thinking tokens
  startedAt: string;
  model: string;
}

// ─── Tool Use ────────────────────────────────────────────────────────────────

export type ToolCategory = 'file' | 'terminal' | 'browser' | 'http' | 'python';

export interface ToolUseError {
  message: string;
  classification: 'transient' | 'permanent' | 'timeout';
  retryInfo: string | null; // e.g., "Retrying (attempt 2/3)..."
}

export interface ToolUseBlockState {
  id: string;
  tool: string;
  category: ToolCategory;
  params: Record<string, unknown>;
  output: string | null;
  status: 'running' | 'success' | 'error';
  error: ToolUseError | null;
  duration: number | null;
  timestamp: string;
  /** Position in the chat timeline (after which message) */
  afterMessageId: string | null;
}

// ─── Reasoning & Planning ────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  title: string;
  status: 'completed' | 'active' | 'pending';
}

export interface ReasoningBlockState {
  id: string;
  type: 'plan' | 'thinking' | 'replan' | 'completion';
  content: string;
  steps?: PlanStep[];
  removedSteps?: string[];
  newSteps?: PlanStep[];
  isExpanded: boolean;
  timestamp: string;
  afterMessageId: string | null;
}

// ─── Approval Gate ───────────────────────────────────────────────────────────

export interface ApprovalGateState {
  gateId: string;
  action: string;
  tool: string;
  category: ToolCategory;
  params: Record<string, unknown>;
  riskExplanation: string;
  status: 'pending' | 'approved' | 'denied';
  timestamp: string;
  afterMessageId: string | null;
}

// ─── Completion Summary ──────────────────────────────────────────────────────

export interface CompletionSummaryData {
  stepsCompleted: number;
  totalSteps: number;
  duration: number;
  artifactCount: number;
  outcome: string; // Brief description
  timestamp: string;
}

// ─── Timeline Events (for persistence) ──────────────────────────────────────

export type TimelineEvent =
  | { type: 'tool-use'; block: ToolUseBlockState }
  | { type: 'tool-use-group'; blocks: ToolUseBlockState[] }
  | { type: 'reasoning'; block: ReasoningBlockState }
  | { type: 'approval-gate'; gate: ApprovalGateState }
  | { type: 'completion-summary'; data: CompletionSummaryData }
  | { type: 'connection-lost'; timestamp: string };

// ─── Session ─────────────────────────────────────────────────────────────────

export type AgentSessionStatus = 'active' | 'completed' | 'failed' | 'idle';

export interface AgentSession {
  id: string; // UUID
  title: string; // Derived from first user message (max 60 chars)
  status: AgentSessionStatus;
  messages: ChatMessage[];
  timelineEvents: TimelineEvent[];
  plan: Plan | null;
  artifacts: Artifact[];
  memoryRecords: MemoryRecord[];
  modelId: string;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  totalDuration: number | null;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  status: AgentSessionStatus;
  createdAt: string;
  messageCount: number;
  totalDuration: number | null;
}

// ─── Chat State Machine ─────────────────────────────────────────────────────

export type AgentChatState =
  | 'idle'
  | 'streaming'
  | 'tool-executing'
  | 'waiting-approval'
  | 'completed'
  | 'error'
  | 'disconnected';

// ─── IPC Stream Events ──────────────────────────────────────────────────────

export type AgentChatStreamEvent =
  // ─── Chat message lifecycle ────────────────────────────────────────────
  | {
      type: 'chat-started';
      requestId: string;
      sessionId: string;
      model: string;
      endpoint: string;
      userMessage: ChatMessage;
    }
  | {
      type: 'chat-token';
      requestId: string;
      sessionId: string;
      delta: string;
      isThinking: boolean; // true = append to thinking block
    }
  | {
      type: 'chat-completed';
      requestId: string;
      sessionId: string;
      assistantMessage: ChatMessage;
    }
  | {
      type: 'chat-error';
      requestId: string;
      sessionId: string;
      message: string;
      classification: 'transient' | 'permanent';
      canRetry: boolean;
    }
  // ─── Tool use ─────────────────────────────────────────────────────────
  | {
      type: 'tool-call-started';
      requestId: string;
      sessionId: string;
      blockId: string;
      tool: string;
      category: ToolCategory;
      params: Record<string, unknown>;
      timestamp: string;
    }
  | {
      type: 'tool-call-completed';
      requestId: string;
      sessionId: string;
      blockId: string;
      tool: string;
      output: string;
      status: 'success' | 'error';
      error: ToolUseError | null;
      duration: number;
      timestamp: string;
    }
  // ─── Reasoning / Planning ─────────────────────────────────────────────
  | {
      type: 'reasoning';
      requestId: string;
      sessionId: string;
      blockId: string;
      reasoningType: 'plan' | 'thinking' | 'replan' | 'completion';
      content: string;
      steps?: PlanStep[];
      removedSteps?: string[];
      newSteps?: PlanStep[];
      timestamp: string;
    }
  // ─── Approval Gate ────────────────────────────────────────────────────
  | {
      type: 'approval-gate';
      requestId: string;
      sessionId: string;
      gateId: string;
      action: string;
      tool: string;
      category: ToolCategory;
      params: Record<string, unknown>;
      riskExplanation: string;
      timestamp: string;
    }
  // ─── Task lifecycle ───────────────────────────────────────────────────
  | {
      type: 'task-complete';
      requestId: string;
      sessionId: string;
      summary: CompletionSummaryData;
      timestamp: string;
    }
  // ─── Connection ───────────────────────────────────────────────────────
  | {
      type: 'connection-lost';
      sessionId: string;
      lastEventAt: string;
      timestamp: string;
    };

// ─── IPC Bridge Methods (preload type safety) ────────────────────────────────

export interface AgentBridgeMethods {
  /** Send a chat message to the agent (triggers planning + execution if needed) */
  sendAgentChatMessage(input: {
    sessionId?: string;
    content: string;
    model: string;
    endpoint: string;
    attachments?: AttachmentFile[];
    requestId?: string;
  }): Promise<{ sessionId: string; requestId: string }>;

  /** Subscribe to agent chat stream events */
  onAgentChatStream(listener: (event: AgentChatStreamEvent) => void): () => void;

  /** Stop current generation/execution */
  stopAgentGeneration(sessionId: string): Promise<void>;

  /** Approve an approval gate */
  approveAgentGate(sessionId: string, gateId: string): Promise<void>;

  /** Deny an approval gate */
  denyAgentGate(sessionId: string, gateId: string, reason?: string): Promise<void>;

  /** List all agent sessions */
  listAgentSessions(): Promise<AgentSessionSummary[]>;

  /** Get a specific agent session by ID */
  getAgentSession(sessionId: string): Promise<AgentSession>;

  /** Get the last active agent session (for app restore) */
  getLastActiveAgentSession(): Promise<AgentSession | null>;

  /** Delete an agent session */
  deleteAgentSession(sessionId: string): Promise<void>;
}
