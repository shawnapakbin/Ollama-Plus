export type RuntimeStatus = {
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

export type RuntimeBootstrapPlan = {
  pillars: Array<{
    id: string;
    title: string;
    detail: string;
  }>;
  milestones: string[];
};

export type RuntimeSessionSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastRunSummary: string;
};

export type RuntimeSessionRenameResult = {
  session: RuntimeSessionSummary;
  title: string;
  endpoint: string;
  model: string;
};

export type RuntimeChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  endpoint: string | null;
  createdAt: string;
  metrics: RuntimeChatMetrics | null;
};

export type RuntimeChatMetrics = {
  totalDuration: number | null;
  loadDuration: number | null;
  promptEvalCount: number | null;
  promptEvalDuration: number | null;
  evalCount: number | null;
  evalDuration: number | null;
};

export type RuntimeChatStreamEvent =
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

export type RuntimeChatConfig = {
  endpoint: string;
  model: string;
};

export type RuntimeOllamaModel = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
};

export type RuntimeOllamaCatalog = RuntimeChatConfig & {
  availableModels: RuntimeOllamaModel[];
};

export type RuntimeOllamaServer = {
  id: string;
  label: string;
  endpoint: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeOllamaServerHealth = RuntimeOllamaServer & {
  status: 'online' | 'offline';
  models: RuntimeOllamaModel[];
  checkedAt: string;
  error: string | null;
};

export type RuntimeGraphSummary = {
  id: string;
  name: string;
  summary: string;
  stageCount: number;
  stages: string[];
};

export type RuntimeRunSummary = {
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

export type RuntimeMemoryRecord = {
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

export type ApprovalDecision = {
  operator?: string;
  operatorRole?: string;
  reason?: string;
};

export type RuntimeBridgeHealth = {
  ok: boolean;
  missingMethods: string[];
  availableMethods: string[];
};

const REQUIRED_RUNTIME_BRIDGE_METHODS = [
  'getRuntimeStatus',
  'getRuntimeBootstrapPlan',

  'getGraphCatalog',

  'listRuntimeSessions',
  'createRuntimeSession',
  'renameRuntimeSession',
  'renameRuntimeSessionWithAi',
  'deleteRuntimeSession',
  'getRuntimeChatConfig',

  'saveRuntimeChatConfig',

  'listRuntimeOllamaModels',

  'listRuntimeOllamaServers',

  'saveRuntimeOllamaServer',

  'removeRuntimeOllamaServer',

  'checkRuntimeOllamaServer',

  'listRuntimeMessages',
  'updateRuntimeMessage',
  'deleteRuntimeMessage',
  'sendRuntimeChatMessage',

  'sendRuntimeChatMessageStream',

  'onRuntimeChatStream',

  'listRuntimeRuns',

  'listRuntimeMemoryRecords',

  'startRuntimeRun',

  'executeRuntimeRun',

  'resumeRuntimeRun',

  'stepRuntimeRun',

  'cancelRuntimeRun',

  'approveRuntimeRun',

  'denyRuntimeRun',

  'mcpGatewayCall',

  'mcpGatewayStatus'

] as const;

function getElectronApi() {
  const api = (globalThis as typeof globalThis & { window?: { electronAPI?: unknown } }).window?.electronAPI;
  if (!api) {
    throw new Error('Electron runtime bridge is unavailable. Launch the desktop shell to use the rebuild baseline.');
  }

  return api as NonNullable<typeof window.electronAPI>;
}

export const runtimeClient = {
  getBridgeHealth(): RuntimeBridgeHealth {
    const api = (globalThis as typeof globalThis & { window?: { electronAPI?: unknown } }).window?.electronAPI as Record<string, unknown> | undefined;
    if (!api) {
      return {
        ok: false,
        missingMethods: [...REQUIRED_RUNTIME_BRIDGE_METHODS],
        availableMethods: []
      };
    }

    const availableMethods = Object.keys(api).filter((key) => typeof api[key] === 'function').sort();
    const missingMethods = REQUIRED_RUNTIME_BRIDGE_METHODS.filter((methodName) => typeof api[methodName] !== 'function');

    return {
      ok: missingMethods.length === 0,
      missingMethods,
      availableMethods
    };
  },
  getStatus() {
    return getElectronApi().getRuntimeStatus();
  },
  getBootstrapPlan() {
    return getElectronApi().getRuntimeBootstrapPlan();
  },
  getGraphCatalog() {
    return getElectronApi().getGraphCatalog();
  },
  listSessions() {
    return getElectronApi().listRuntimeSessions();
  },
  createSession(title?: string) {
    return getElectronApi().createRuntimeSession(title);
  },
  renameSession(sessionId: string, title: string) {
    return getElectronApi().renameRuntimeSession(sessionId, title);
  },
  renameSessionWithAi(sessionId: string, input?: { endpoint?: string; model?: string }): Promise<RuntimeSessionRenameResult> {
    return getElectronApi().renameRuntimeSessionWithAi(sessionId, input);
  },
  deleteSession(sessionId: string) {
    const api = getElectronApi();
    if (typeof api.deleteRuntimeSession !== 'function') {
      throw new Error('Delete session is unavailable in the active Electron bridge. Fully restart the desktop app to load the latest preload API.');
    }

    return api.deleteRuntimeSession(sessionId);
  },
  getChatConfig() {
    return getElectronApi().getRuntimeChatConfig();
  },
  saveChatConfig(input: Partial<RuntimeChatConfig>) {
    return getElectronApi().saveRuntimeChatConfig(input);
  },
  listOllamaModels(endpoint?: string) {
    return getElectronApi().listRuntimeOllamaModels(endpoint);
  },
  listOllamaServers() {
    return getElectronApi().listRuntimeOllamaServers();
  },
  saveOllamaServer(input: { id?: string; label?: string; endpoint: string }) {
    return getElectronApi().saveRuntimeOllamaServer(input);
  },
  removeOllamaServer(serverId: string) {
    return getElectronApi().removeRuntimeOllamaServer(serverId);
  },
  checkOllamaServer(serverId: string) {
    return getElectronApi().checkRuntimeOllamaServer(serverId);
  },
  listMessages(sessionId?: string) {
    return getElectronApi().listRuntimeMessages(sessionId);
  },
  updateMessage(messageId: string, input: { content?: string }) {
    return getElectronApi().updateRuntimeMessage(messageId, input);
  },
  deleteMessage(messageId: string) {
    const api = getElectronApi();
    if (typeof api.deleteRuntimeMessage !== 'function') {
      throw new Error('Delete message is unavailable in the active Electron bridge. Fully restart the desktop app to load the latest preload API.');
    }

    return api.deleteRuntimeMessage(messageId);
  },
  sendChatMessage(input: { sessionId?: string; content: string; endpoint?: string; model?: string }) {
    return getElectronApi().sendRuntimeChatMessage(input);
  },
  sendChatMessageStream(input: { sessionId?: string; content: string; endpoint?: string; model?: string; requestId?: string }) {
    return getElectronApi().sendRuntimeChatMessageStream(input);
  },
  onChatStream(listener: (event: RuntimeChatStreamEvent) => void) {
    return getElectronApi().onRuntimeChatStream(listener);
  },
  listRuns(sessionId?: string) {
    return getElectronApi().listRuntimeRuns(sessionId);
  },
  listMemoryRecords(sessionId?: string) {
    return getElectronApi().listRuntimeMemoryRecords(sessionId);
  },
  startRun(graphId: string, sessionId?: string) {
    return getElectronApi().startRuntimeRun(graphId, sessionId);
  },
  executeRun(runId: string) {
    return getElectronApi().executeRuntimeRun(runId);
  },
  resumeRun(runId: string) {
    return getElectronApi().resumeRuntimeRun(runId);
  },
  stepRun(runId: string) {
    return getElectronApi().stepRuntimeRun(runId);
  },
  cancelRun(runId: string) {
    return getElectronApi().cancelRuntimeRun(runId);
  },
  approveRun(runId: string, decision?: ApprovalDecision) {
    return getElectronApi().approveRuntimeRun(runId, decision);
  },
  denyRun(runId: string, decision?: ApprovalDecision) {
    return getElectronApi().denyRuntimeRun(runId, decision);
  },
  mcpGatewayCall(request: { server: string; action: string; payload?: unknown }) {
    const api = getElectronApi();
    if (typeof api.mcpGatewayCall !== 'function') {
      throw new Error('MCP gateway bridge is unavailable in the active Electron preload API.');
    }

    return api.mcpGatewayCall(request);
  },
  mcpGatewayStatus() {
    const api = getElectronApi();
    if (typeof api.mcpGatewayStatus !== 'function') {
      throw new Error('MCP gateway status bridge is unavailable in the active Electron preload API.');
    }

    return api.mcpGatewayStatus();
  }
};