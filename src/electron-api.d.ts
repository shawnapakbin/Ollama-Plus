export {};

type RuntimeStatus = {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  mode: 'development' | 'production';
  workspaceRoot: string;
  runtimeStoragePath: string;
  langsmith: {
    configured: boolean;
    mode: 'optional-enabled' | 'optional-disabled';
  };
  capabilities: {
    offlineFirst: boolean;
    langGraphRuntime: string;
    langChainAdapters: string;
    langFlowSurface: string;
    approvalCheckpoints: string;
    durableRuns: string;
  };
  sessionCount: number;
  latestSessionAt: string | null;
  runCount: number;
};

type RuntimeBootstrapPlan = {
  pillars: Array<{
    id: string;
    title: string;
    detail: string;
  }>;
  milestones: string[];
};

type RuntimeSessionSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastRunSummary: string;
};

type RuntimeSessionRenameResult = {
  session: RuntimeSessionSummary;
  title: string;
  endpoint: string;
  model: string;
};

type RuntimeChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  endpoint: string | null;
  createdAt: string;
  metrics: RuntimeChatMetrics | null;
};

type RuntimeChatMetrics = {
  totalDuration: number | null;
  loadDuration: number | null;
  promptEvalCount: number | null;
  promptEvalDuration: number | null;
  evalCount: number | null;
  evalDuration: number | null;
};

type RuntimeChatStreamEvent =
  | {
      type: 'started';
      requestId: string;
      sessionId: string;
      model: string;
      endpoint: string;
      userMessage: RuntimeChatMessage;
    }
  | {
      type: 'token';
      requestId: string;
      sessionId: string;
      delta: string;
      model: string;
      endpoint: string;
    }
  | {
      type: 'completed';
      requestId: string;
      sessionId: string;
      model: string;
      endpoint: string;
      assistantMessage: RuntimeChatMessage;
      metrics?: RuntimeChatMetrics;
    }
  | {
      type: 'error';
      requestId: string;
      sessionId: string;
      message: string;
    };

type RuntimeChatConfig = {
  endpoint: string;
  model: string;
};

type RuntimeOllamaModel = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
};

type RuntimeOllamaCatalog = RuntimeChatConfig & {
  availableModels: RuntimeOllamaModel[];
};

type RuntimeOllamaServer = {
  id: string;
  label: string;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
};

type RuntimeOllamaServerHealth = RuntimeOllamaServer & {
  status: 'online' | 'offline';
  models: RuntimeOllamaModel[];
  checkedAt: string;
  error: string | null;
};

type RuntimeGraphSummary = {
  id: string;
  name: string;
  summary: string;
  stageCount: number;
  stages: string[];
};

type RuntimeRunSummary = {
  id: string;
  sessionId: string;
  graphId: string;
  graphName: string;
  status: string;
  summary: string;
  nextAction: string;
  checkpoints: Array<{
    id: string;
    order: number;
    title: string;
    status: string;
    requiresApproval: boolean;
    approvalPolicyId: string | null;
    approvalPolicy: {
      id: string;
      actionScope: string;
      minRiskScore: number;
      requiredApproverRole: string;
    } | null;
  }>;
  events: string[];
  output: string;
  error: string;
  pendingApproval: {
    checkpointId: string;
    checkpointOrder: number;
    checkpointTitle: string;
    approvalPolicyId: string | null;
    requestedAt: string | null;
    requiredApproverRole: string | null;
    actionScope: string | null;
    minRiskScore: number;
  } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type RuntimeMemoryRecord = {
  id: string;
  sessionId: string;
  runId: string;
  fact: string;
  importanceScore: number;
  retention: string;
  tags: string[];
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
};

type ApprovalDecision = {
  operator?: string;
  operatorRole?: string;
  reason?: string;
};

type ElectronAPI = {
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  getRuntimeBootstrapPlan: () => Promise<RuntimeBootstrapPlan>;
  getGraphCatalog: () => Promise<RuntimeGraphSummary[]>;
  listRuntimeSessions: () => Promise<RuntimeSessionSummary[]>;
  createRuntimeSession: (title?: string) => Promise<RuntimeSessionSummary>;
  renameRuntimeSession: (sessionId: string, title: string) => Promise<RuntimeSessionSummary>;
  renameRuntimeSessionWithAi: (sessionId: string, input?: { endpoint?: string; model?: string }) => Promise<RuntimeSessionRenameResult>;
  deleteRuntimeSession: (sessionId: string) => Promise<RuntimeSessionSummary>;
  getRuntimeChatConfig: () => Promise<RuntimeChatConfig>;
  saveRuntimeChatConfig: (input: Partial<RuntimeChatConfig>) => Promise<RuntimeChatConfig>;
  listRuntimeOllamaModels: (endpoint?: string) => Promise<RuntimeOllamaCatalog>;
  listRuntimeOllamaServers: () => Promise<RuntimeOllamaServer[]>;
  saveRuntimeOllamaServer: (input: { id?: string; label?: string; endpoint: string }) => Promise<RuntimeOllamaServer>;
  removeRuntimeOllamaServer: (serverId: string) => Promise<RuntimeOllamaServer>;
  checkRuntimeOllamaServer: (serverId: string) => Promise<RuntimeOllamaServerHealth>;
  listRuntimeMessages: (sessionId?: string) => Promise<RuntimeChatMessage[]>;
  updateRuntimeMessage: (messageId: string, input: { content?: string }) => Promise<RuntimeChatMessage>;
  deleteRuntimeMessage: (messageId: string) => Promise<RuntimeChatMessage>;
  sendRuntimeChatMessage: (input: { sessionId?: string; content: string; endpoint?: string; model?: string }) => Promise<{
    sessionId: string;
    endpoint: string;
    model: string;
    userMessage: RuntimeChatMessage;
    assistantMessage: RuntimeChatMessage;
    messages: RuntimeChatMessage[];
  }>;
  sendRuntimeChatMessageStream: (input: { sessionId?: string; content: string; endpoint?: string; model?: string; requestId?: string }) => Promise<{
    sessionId: string;
    requestId: string;
    endpoint: string;
    model: string;
    userMessage: RuntimeChatMessage;
    assistantMessage: RuntimeChatMessage;
    messages: RuntimeChatMessage[];
  }>;
  onRuntimeChatStream: (listener: (event: RuntimeChatStreamEvent) => void) => () => void;
  listRuntimeRuns: (sessionId?: string) => Promise<RuntimeRunSummary[]>;
  listRuntimeMemoryRecords: (sessionId?: string) => Promise<RuntimeMemoryRecord[]>;
  startRuntimeRun: (graphId: string, sessionId?: string) => Promise<RuntimeRunSummary>;
  executeRuntimeRun: (runId: string) => Promise<RuntimeRunSummary>;
  resumeRuntimeRun: (runId: string) => Promise<RuntimeRunSummary>;
  stepRuntimeRun: (runId: string) => Promise<RuntimeRunSummary>;
  cancelRuntimeRun: (runId: string) => Promise<RuntimeRunSummary>;
  approveRuntimeRun: (runId: string, decision?: ApprovalDecision) => Promise<RuntimeRunSummary>;
  denyRuntimeRun: (runId: string, decision?: ApprovalDecision) => Promise<RuntimeRunSummary>;
  mcpGatewayCall: (request: { server: string; action: string; payload?: unknown }) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  mcpGatewayStatus: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}