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

export type RuntimeChatMessage = {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  endpoint: string | null;
  createdAt: string;
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

export type ApprovalDecision = {
  operator?: string;
  operatorRole?: string;
  reason?: string;
};

function getElectronApi() {
  if (!window.electronAPI) {
    throw new Error('Electron runtime bridge is unavailable. Launch the desktop shell to use the rebuild baseline.');
  }

  return window.electronAPI;
}

export const runtimeClient = {
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
  getChatConfig() {
    return getElectronApi().getRuntimeChatConfig();
  },
  saveChatConfig(input: Partial<RuntimeChatConfig>) {
    return getElectronApi().saveRuntimeChatConfig(input);
  },
  listOllamaModels(endpoint?: string) {
    return getElectronApi().listRuntimeOllamaModels(endpoint);
  },
  listMessages(sessionId?: string) {
    return getElectronApi().listRuntimeMessages(sessionId);
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
  }
};