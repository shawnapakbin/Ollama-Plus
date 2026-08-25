/**
 * Agent Client Type Definitions
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Core data models for the autonomous agent client system.
 * Used across both the Electron main process and React renderer.
 */

// ─── Enums & Literal Types ───────────────────────────────────────────────────

export type TaskSessionStatus =
  | 'planned'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'canceled';

export type StepOutcome =
  | { type: 'proceed'; output: string }
  | { type: 'replan'; reason: string; output: string }
  | { type: 'complete'; output: string };

// ─── Supporting Types ────────────────────────────────────────────────────────

export interface ToolReference {
  name: string;
  server: string;
  category: 'terminal' | 'folder' | 'browser' | 'python' | 'http';
}

export interface ExecutionError {
  type: string;
  message: string;
  stepId: string;
  attemptCount: number;
  classification: 'transient' | 'permanent';
}

export interface TaskSummary {
  sessionId: string;
  instruction: string;
  status: TaskSessionStatus;
  stepsCompleted: number;
  stepsTotal: number;
  artifactCount: number;
  totalDuration: number;
  completedAt: string;
}

export interface TaskConfig {
  stepTimeout: number;
  taskTimeout: number;
  retryCount: number;
  autoApprovalLowRisk: boolean;
  customApprovalRules: ApprovalRule[];
  toolTimeouts: ToolTimeouts;
}

export interface ToolTimeouts {
  terminal: number;
  file: number;
  browser: number;
  python: number;
  http: number;
}

export interface TaskSubmission {
  instruction: string;
  workingDirectory: string;
  modelId: string;
  endpoint: string;
  attachments: Attachment[];
  config?: Partial<TaskConfig>;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Core Data Models ────────────────────────────────────────────────────────

export interface Step {
  id: string;
  title: string;                        // 1-120 characters
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiredTools: ToolReference[];
  parallelSafe: boolean;
  timeout: number;                      // milliseconds
  dependsOn: string[];                  // step IDs
}

export interface Plan {
  steps: Step[];
  estimatedDuration: number;
  reasoning: string;
}

export interface StepResult {
  stepId: string;
  title: string;
  status: 'completed' | 'failed' | 'skipped' | 'canceled';
  toolCalls: ToolCallRecord[];
  output: string;
  error: string | null;
  startedAt: string;
  completedAt: string;
  duration: number;
  retryCount: number;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  server: string;
  action: string;
  params: Record<string, unknown>;
  output: string;                       // Truncated to 10,000 chars
  status: 'success' | 'error' | 'timeout';
  error: string | null;
  duration: number;
  startedAt: string;
  completedAt: string;
}

export interface Artifact {
  id: string;
  sessionId: string;
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  beforeContent: string | null;         // For modifications < 1MB
  afterContent: string | null;
  size: number;
  timestamp: string;
}

export interface MemoryRecord {
  id: string;
  sessionId: string;
  fact: string;
  tags: string[];
  importanceScore: number;              // 0-100
  retention: 'session' | 'persistent';
  createdAt: string;
  updatedAt: string;
}

export interface AgentConfig {
  defaultWorkingDirectory: string;
  stepTimeout: number;                  // 30-600 seconds, default 120
  taskTimeout: number;                  // 60-3600 seconds, default 900
  retryCount: number;                   // 0-10, default 3
  autoApprovalLowRisk: boolean;         // default false
  customApprovalRules: ApprovalRule[];
  toolTimeouts: ToolTimeouts;
}

export interface ApprovalRule {
  id: string;
  pattern: string;                      // glob or regex, max 500 chars
  type: 'glob' | 'regex';
  description: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string;                      // Base64 encoded
}

export interface ApprovalGate {
  id: string;
  sessionId: string;
  stepId: string;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  riskLevel: 'high';
  riskExplanation: string;
  status: 'pending' | 'approved' | 'denied';
  decidedAt: string | null;
  denialReason: string | null;
  createdAt: string;
}

export interface FileModification {
  sessionId: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  timestamp: string;
}

export interface TaskSession {
  id: string;                           // UUID
  instruction: string;                  // User's original task (max 50,000 chars)
  status: TaskSessionStatus;
  workingDirectory: string;
  modelId: string;
  endpoint: string;
  plan: Plan | null;
  attachments: Attachment[];
  artifacts: Artifact[];
  stepResults: StepResult[];
  replanCount: number;
  createdAt: string;                    // ISO 8601
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  totalDuration: number | null;         // milliseconds
  config: TaskConfig;                   // Snapshot of config at submission time
}

// ─── Activity Stream Events ──────────────────────────────────────────────────

export type ActivityStreamEvent =
  | { type: 'plan-generated'; plan: Plan; timestamp: string }
  | { type: 'step-started'; stepId: string; title: string; timestamp: string }
  | { type: 'step-progress'; stepId: string; output: string; timestamp: string }
  | { type: 'step-completed'; stepId: string; outcome: StepOutcome; duration: number; timestamp: string }
  | { type: 'tool-call'; stepId: string; tool: string; params: Record<string, unknown>; timestamp: string }
  | { type: 'tool-result'; stepId: string; tool: string; output: string; duration: number; timestamp: string }
  | { type: 'reasoning'; stepId: string; content: string; timestamp: string }
  | { type: 'token'; stepId: string; delta: string; timestamp: string }
  | { type: 'error'; stepId: string; error: ExecutionError; recovery?: string; timestamp: string }
  | { type: 'approval-gate'; gateId: string; action: string; tool: string; params: Record<string, unknown>; riskExplanation: string; timestamp: string }
  | { type: 'replan'; oldSteps: string[]; newSteps: Step[]; reason: string; timestamp: string }
  | { type: 'context-summary'; summarized: number; retained: number; timestamp: string }
  | { type: 'task-complete'; summary: TaskSummary; timestamp: string }
  | { type: 'task-paused'; reason: string; timestamp: string }
  | { type: 'task-canceled'; timestamp: string }
  | { type: 'connection-lost'; lastEventAt: string; timestamp: string };

// ─── Runtime Interfaces (for agent runtime orchestration) ────────────────────

export interface ContextWindow {
  systemPrompt: string;
  taskInstruction: string;
  currentPlan: Plan;
  stepHistory: StepResult[];
  fileContents: FileReference[];
  memoryRecords: MemoryRecord[];
  totalTokens: number;
}

export interface FileReference {
  path: string;
  content: string;
  tokenCount: number;
}

export interface ReplanConstraints {
  excludedApproaches: string[];
  deniedActions: DeniedAction[];
  errorContext: ExecutionError | null;
  maxSteps: number;
}

export interface DeniedAction {
  tool: string;
  action: string;
  params: Record<string, unknown>;
  reason: string | null;
}

export interface TaskInstruction {
  instruction: string;
  workingDirectory: string;
  attachments: Attachment[];
  followUpInstructions: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export type RetryDecision =
  | { action: 'retry'; delay: number }
  | { action: 'skip'; reason: string }
  | { action: 'replan'; reason: string }
  | { action: 'halt'; reason: string };

export interface ToolError {
  tool: string;
  action: string;
  message: string;
  code: string | null;
  httpStatus: number | null;
}

export interface ProgressEvent {
  sessionId: string;
  stepId: string;
  stepsCompleted: number;
  stepsTotal: number;
  percentage: number;
  currentStepTitle: string;
  elapsedTime: number;
}
