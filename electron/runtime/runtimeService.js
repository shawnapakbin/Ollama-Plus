import { randomUUID } from 'node:crypto';
import { buildRunBlueprint, getGraphCatalog } from './graphCatalog.js';
import { executeRunLifecycle } from './graphExecutor.js';
import { DEFAULT_OLLAMA_BASE_URL, listOllamaModels, normalizeOllamaBaseUrl, requestOllamaChat, requestOllamaChatStream } from './ollamaClient.js';
import {
  appendMessage,
  createRun,
  createSession,
  getChatConfig,
  getRunById,
  getSessionById,
  listMessages,
  listRuns,
  listSessions,
  readRuntimeState,
  updateChatConfig,
  updateRun
} from './runtimeStore.js';

function getBootstrapPlan() {
  return {
    pillars: [
      {
        id: 'langgraph',
        title: 'LangGraph runtime in Node',
        detail: 'Graph orchestration, checkpoints, and durable runs live behind Electron IPC instead of React hooks.'
      },
      {
        id: 'langchain',
        title: 'LangChain adapter boundary',
        detail: 'Models, tools, retrieval, and memory are exposed through a single adapter layer for local-first execution.'
      },
      {
        id: 'langflow',
        title: 'LangFlow inside the product',
        detail: 'Flow editing becomes an in-app surface bound to local graph definitions rather than a separate dev-only artifact.'
      },
      {
        id: 'langsmith',
        title: 'Optional LangSmith observability',
        detail: 'Tracing, prompts, and dataset evaluations attach when configured, without changing offline execution.'
      }
    ],
    milestones: [
      'Replace renderer-owned chat orchestration with a Node-side runtime service.',
      'Add local checkpoint persistence for resumable sessions and approvals.',
      'Introduce the first chat graph with model, tool, and memory nodes.',
      'Embed flow authoring and optional LangSmith tracing.'
    ]
  };
}

function normalizeApprovalDecision(decision) {
  const operator = typeof decision?.operator === 'string' && decision.operator.trim()
    ? decision.operator.trim().slice(0, 80)
    : 'unknown-operator';
  const operatorRole = typeof decision?.operatorRole === 'string' && decision.operatorRole.trim()
    ? decision.operatorRole.trim().slice(0, 80)
    : 'runtime-reviewer';
  const reason = typeof decision?.reason === 'string' && decision.reason.trim()
    ? decision.reason.trim().slice(0, 300)
    : 'No reason provided.';

  return {
    operator,
    operatorRole,
    reason
  };
}

export function createRuntimeService(config) {
  const {
    statePath,
    appVersion,
    mode,
    workspaceRoot,
    versions,
    langsmithConfigured,
    fetchImpl = globalThis.fetch,
    defaultOllamaEndpoint = DEFAULT_OLLAMA_BASE_URL
  } = config;

  return {
    getStatus() {
      const state = readRuntimeState(statePath);
      const latestSession = listSessions(statePath)[0] ?? null;
      return {
        appVersion,
        electronVersion: versions.electron,
        chromeVersion: versions.chrome,
        nodeVersion: versions.node,
        mode,
        workspaceRoot,
        runtimeStoragePath: statePath,
        langsmith: {
          configured: langsmithConfigured,
          mode: langsmithConfigured ? 'optional-enabled' : 'optional-disabled'
        },
        capabilities: {
          offlineFirst: true,
          langGraphRuntime: 'bootstrap',
          langChainAdapters: 'bootstrap',
          langFlowSurface: 'planned',
          approvalCheckpoints: 'bootstrap',
          durableRuns: 'bootstrap'
        },
        sessionCount: state.sessions.length,
        latestSessionAt: latestSession?.updatedAt ?? null,
        runCount: state.runs.length
      };
    },

    getBootstrapPlan,

    getGraphCatalog() {
      return getGraphCatalog();
    },

    listSessions() {
      return listSessions(statePath);
    },

    createSession(title) {
      return createSession(statePath, title);
    },

    listRuns(sessionId) {
      return listRuns(statePath, sessionId);
    },

    listMessages(sessionId) {
      return listMessages(statePath, sessionId);
    },

    getChatConfig() {
      return getChatConfig(statePath);
    },

    saveChatConfig(input = {}) {
      return updateChatConfig(statePath, (current) => ({
        ...current,
        endpoint: input.endpoint ?? current.endpoint ?? defaultOllamaEndpoint,
        model: input.model ?? current.model ?? ''
      }));
    },

    async listOllamaModels(endpoint) {
      const currentConfig = getChatConfig(statePath);
      const requestedEndpoint = endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint;
      const result = await listOllamaModels(fetchImpl, requestedEndpoint);
      const selectedModel = currentConfig.model && result.models.some((model) => model.name === currentConfig.model)
        ? currentConfig.model
        : result.models[0]?.name ?? '';

      const nextConfig = updateChatConfig(statePath, {
        endpoint: result.endpoint,
        model: selectedModel
      });

      return {
        ...nextConfig,
        availableModels: result.models
      };
    },

    ensureSession() {
      const existing = listSessions(statePath)[0];
      if (existing) return existing;
      return createSession(statePath, 'Primary rebuild session');
    },

    async sendChatMessage(input) {
      const content = typeof input?.content === 'string' ? input.content.trim() : '';
      if (!content) {
        throw new Error('Enter a message before sending it to Ollama.');
      }

      const session = input?.sessionId
        ? getSessionById(statePath, input.sessionId) ?? this.ensureSession()
        : this.ensureSession();

      const currentConfig = getChatConfig(statePath);
      const endpoint = normalizeOllamaBaseUrl(input?.endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint);
      const model = typeof input?.model === 'string' && input.model.trim()
        ? input.model.trim()
        : currentConfig.model;

      if (!model) {
        throw new Error('No Ollama model selected. Refresh models and choose one before sending a message.');
      }

      const userMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'user',
        content,
        model,
        endpoint
      });

      const transcript = listMessages(statePath, session.id)
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        .map((message) => ({
          role: message.role,
          content: message.content
        }));

      const response = await requestOllamaChat(fetchImpl, {
        endpoint,
        model,
        messages: transcript
      });

      const assistantMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'assistant',
        content: response.content,
        model: response.model,
        endpoint: response.endpoint
      });

      updateChatConfig(statePath, {
        endpoint: response.endpoint,
        model: response.model
      });

      return {
        sessionId: session.id,
        endpoint: response.endpoint,
        model: response.model,
        userMessage,
        assistantMessage,
        messages: listMessages(statePath, session.id)
      };
    },

    async sendChatMessageStream(input, emit) {
      const content = typeof input?.content === 'string' ? input.content.trim() : '';
      if (!content) {
        throw new Error('Enter a message before sending it to Ollama.');
      }

      const session = input?.sessionId
        ? getSessionById(statePath, input.sessionId) ?? this.ensureSession()
        : this.ensureSession();

      const currentConfig = getChatConfig(statePath);
      const endpoint = normalizeOllamaBaseUrl(input?.endpoint ?? currentConfig.endpoint ?? defaultOllamaEndpoint);
      const model = typeof input?.model === 'string' && input.model.trim()
        ? input.model.trim()
        : currentConfig.model;
      const requestId = typeof input?.requestId === 'string' && input.requestId.trim()
        ? input.requestId.trim()
        : randomUUID();

      if (!model) {
        throw new Error('No Ollama model selected. Refresh models and choose one before sending a message.');
      }

      const userMessage = appendMessage(statePath, {
        sessionId: session.id,
        role: 'user',
        content,
        model,
        endpoint
      });

      emit?.({
        type: 'started',
        requestId,
        sessionId: session.id,
        model,
        endpoint,
        userMessage
      });

      const transcript = listMessages(statePath, session.id)
        .filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        .map((message) => ({
          role: message.role,
          content: message.content
        }));

      try {
        const response = await requestOllamaChatStream(fetchImpl, {
          endpoint,
          model,
          messages: transcript
        }, {
          onToken: (delta) => {
            emit?.({
              type: 'token',
              requestId,
              sessionId: session.id,
              delta,
              model,
              endpoint
            });
          }
        });

        const assistantMessage = appendMessage(statePath, {
          sessionId: session.id,
          role: 'assistant',
          content: response.content,
          model: response.model,
          endpoint: response.endpoint
        });

        updateChatConfig(statePath, {
          endpoint: response.endpoint,
          model: response.model
        });

        const result = {
          sessionId: session.id,
          requestId,
          endpoint: response.endpoint,
          model: response.model,
          userMessage,
          assistantMessage,
          messages: listMessages(statePath, session.id)
        };

        emit?.({
          type: 'completed',
          requestId,
          sessionId: session.id,
          assistantMessage,
          model: response.model,
          endpoint: response.endpoint
        });

        return result;
      } catch (error) {
        emit?.({
          type: 'error',
          requestId,
          sessionId: session.id,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    },

    resumeRun(runId) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot resume unknown run: ${runId}`);
      }

      if (targetRun.status === 'completed' || targetRun.status === 'failed' || targetRun.status === 'canceled') {
        throw new Error(`Cannot resume run in terminal state: ${targetRun.status}`);
      }

      if (targetRun.status === 'waiting_approval') {
        throw new Error('Cannot resume run while waiting for approval. Approve or deny first.');
      }

      return updateRun(statePath, runId, (run) => {
        const startedAt = run.startedAt ?? new Date().toISOString();
        const runningIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'running');
        if (runningIndex >= 0) {
          return {
            status: 'running',
            nextAction: `Advance checkpoint ${run.checkpoints[runningIndex].order} to continue execution.`,
            startedAt
          };
        }

        const readyIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready');
        const pendingIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'pending');
        const activateIndex = readyIndex >= 0 ? readyIndex : pendingIndex;

        if (activateIndex === -1) {
          return {
            status: 'completed',
            summary: `${run.graphName} completed with all checkpoints finalized.`,
            nextAction: 'Run finished. Plan a new run to execute again.',
            completedAt: new Date().toISOString(),
            startedAt
          };
        }

        const checkpoints = run.checkpoints.map((checkpoint, index) => {
          if (index === activateIndex) {
            return {
              ...checkpoint,
              status: 'running'
            };
          }
          return checkpoint;
        });

        return {
          status: 'running',
          checkpoints,
          pendingApproval: null,
          nextAction: `Checkpoint ${checkpoints[activateIndex].order} is running. Advance when ready.`,
          startedAt
        };
      });
    },

    stepRun(runId) {
      const currentRun = getRunById(statePath, runId);
      if (!currentRun) {
        throw new Error(`Cannot step unknown run: ${runId}`);
      }

      if (currentRun.status === 'completed' || currentRun.status === 'failed' || currentRun.status === 'canceled') {
        throw new Error(`Cannot step run in terminal state: ${currentRun.status}`);
      }

      if (currentRun.status === 'waiting_approval') {
        throw new Error('Cannot step while waiting approval. Approve or deny the checkpoint first.');
      }

      if (currentRun.status === 'planned' || currentRun.status === 'paused') {
        this.resumeRun(runId);
      }

      return updateRun(statePath, runId, (run) => {
        const runningIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'running');
        if (runningIndex === -1) {
          throw new Error('Run has no active checkpoint to advance. Resume the run first.');
        }

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));

        const activeCheckpoint = checkpoints[runningIndex];

        if (activeCheckpoint.requiresApproval) {
          checkpoints[runningIndex] = {
            ...activeCheckpoint,
            status: 'waiting_approval'
          };
          const requestedAt = new Date().toISOString();
          events.push(`Approval requested at checkpoint ${activeCheckpoint.order}: ${activeCheckpoint.title}`);
          return {
            status: 'waiting_approval',
            checkpoints,
            events,
            summary: `${run.graphName} is paused for operator approval at checkpoint ${activeCheckpoint.order}.`,
            nextAction: 'Approve or deny this checkpoint to continue execution.',
            pendingApproval: {
              checkpointId: activeCheckpoint.id,
              checkpointOrder: activeCheckpoint.order,
              checkpointTitle: activeCheckpoint.title,
              approvalPolicyId: activeCheckpoint.approvalPolicyId,
              requestedAt,
              requiredApproverRole: activeCheckpoint.approvalPolicy?.requiredApproverRole ?? null,
              actionScope: activeCheckpoint.approvalPolicy?.actionScope ?? null,
              minRiskScore: activeCheckpoint.approvalPolicy?.minRiskScore ?? 0
            }
          };
        }

        checkpoints[runningIndex] = {
          ...activeCheckpoint,
          status: 'completed'
        };
        events.push(`Completed checkpoint ${activeCheckpoint.order}: ${activeCheckpoint.title}`);

        const nextIndex = checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready' || checkpoint.status === 'pending');
        if (nextIndex >= 0) {
          checkpoints[nextIndex] = {
            ...checkpoints[nextIndex],
            status: 'ready'
          };
          return {
            status: 'paused',
            checkpoints,
            events,
            pendingApproval: null,
            summary: `${run.graphName} progressed to checkpoint ${checkpoints[nextIndex].order}/${checkpoints.length}.`,
            nextAction: `Resume to run checkpoint ${checkpoints[nextIndex].order}.`
          };
        }

        const completedAt = new Date().toISOString();
        const result = executeRunLifecycle({
          ...run,
          checkpoints
        }, { now: completedAt });

        return {
          status: 'completed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: result.summary,
          nextAction: result.nextAction,
          output: result.output,
          error: '',
          completedAt
        };
      });
    },

    approveRun(runId, decision) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot approve unknown run: ${runId}`);
      }

      if (targetRun.status !== 'waiting_approval') {
        throw new Error(`Run is not awaiting approval: ${targetRun.status}`);
      }

      const approvalDecision = normalizeApprovalDecision(decision);

      return updateRun(statePath, runId, (run) => {
        const approvalIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'waiting_approval');
        if (approvalIndex === -1) {
          throw new Error('No checkpoint is currently waiting approval.');
        }

        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));
        const approvedCheckpoint = checkpoints[approvalIndex];
        const requiredRole = approvedCheckpoint.approvalPolicy?.requiredApproverRole;
        if (requiredRole && approvalDecision.operatorRole !== requiredRole) {
          throw new Error(`Approval role mismatch: required ${requiredRole}, received ${approvalDecision.operatorRole}`);
        }
        checkpoints[approvalIndex] = {
          ...approvedCheckpoint,
          status: 'completed'
        };

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push(
          `Approved checkpoint ${approvedCheckpoint.order}: ${approvedCheckpoint.title} | operator=${approvalDecision.operator} | role=${approvalDecision.operatorRole} | reason=${approvalDecision.reason}`
        );

        const nextIndex = checkpoints.findIndex((checkpoint) => checkpoint.status === 'ready' || checkpoint.status === 'pending');
        if (nextIndex >= 0) {
          checkpoints[nextIndex] = {
            ...checkpoints[nextIndex],
            status: 'ready'
          };
          return {
            status: 'paused',
            checkpoints,
            events,
            pendingApproval: null,
            summary: `${run.graphName} approval accepted. Ready for checkpoint ${checkpoints[nextIndex].order}.`,
            nextAction: `Resume to continue from checkpoint ${checkpoints[nextIndex].order}.`
          };
        }

        const completedAt = new Date().toISOString();
        const result = executeRunLifecycle({
          ...run,
          checkpoints
        }, { now: completedAt });

        return {
          status: 'completed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: result.summary,
          nextAction: result.nextAction,
          output: result.output,
          error: '',
          completedAt
        };
      });
    },

    denyRun(runId, decision) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot deny unknown run: ${runId}`);
      }

      if (targetRun.status !== 'waiting_approval') {
        throw new Error(`Run is not awaiting approval: ${targetRun.status}`);
      }

      const approvalDecision = normalizeApprovalDecision(decision);

      return updateRun(statePath, runId, (run) => {
        const approvalIndex = run.checkpoints.findIndex((checkpoint) => checkpoint.status === 'waiting_approval');
        if (approvalIndex === -1) {
          throw new Error('No checkpoint is currently waiting approval.');
        }

        const checkpoints = run.checkpoints.map((checkpoint) => ({ ...checkpoint }));
        const deniedCheckpoint = checkpoints[approvalIndex];
        const requiredRole = deniedCheckpoint.approvalPolicy?.requiredApproverRole;
        if (requiredRole && approvalDecision.operatorRole !== requiredRole) {
          throw new Error(`Approval role mismatch: required ${requiredRole}, received ${approvalDecision.operatorRole}`);
        }
        checkpoints[approvalIndex] = {
          ...deniedCheckpoint,
          status: 'failed'
        };

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push(
          `Denied checkpoint ${deniedCheckpoint.order}: ${deniedCheckpoint.title} | operator=${approvalDecision.operator} | role=${approvalDecision.operatorRole} | reason=${approvalDecision.reason}`
        );

        const completedAt = new Date().toISOString();
        return {
          status: 'failed',
          checkpoints,
          events,
          pendingApproval: null,
          summary: `${run.graphName} failed after approval denial at checkpoint ${deniedCheckpoint.order}.`,
          nextAction: 'Plan a new run or revise policies before retrying.',
          error: `Approval denied at checkpoint ${deniedCheckpoint.order}.`,
          completedAt
        };
      });
    },

    cancelRun(runId) {
      const targetRun = getRunById(statePath, runId);
      if (!targetRun) {
        throw new Error(`Cannot cancel unknown run: ${runId}`);
      }

      if (targetRun.status === 'completed' || targetRun.status === 'failed' || targetRun.status === 'canceled') {
        throw new Error(`Cannot cancel run in terminal state: ${targetRun.status}`);
      }

      return updateRun(statePath, runId, (run) => {
        const checkpoints = run.checkpoints.map((checkpoint) => {
          if (checkpoint.status === 'running' || checkpoint.status === 'ready' || checkpoint.status === 'pending') {
            return {
              ...checkpoint,
              status: 'canceled'
            };
          }
          return checkpoint;
        });

        const events = Array.isArray(run.events) ? run.events.slice() : [];
        events.push('Run canceled by operator.');

        const completedAt = new Date().toISOString();
        return {
          status: 'canceled',
          checkpoints,
          events,
          summary: `${run.graphName} was canceled before completion.`,
          nextAction: 'Plan a fresh run to continue development execution.',
          error: 'Canceled by operator.',
          completedAt
        };
      });
    },

    executeRun(runId) {
      let latest = this.resumeRun(runId);
      while (latest.status !== 'completed' && latest.status !== 'failed' && latest.status !== 'canceled' && latest.status !== 'waiting_approval') {
        latest = this.stepRun(runId);
        if (latest.status === 'paused') {
          latest = this.resumeRun(runId);
        }
      }
      return latest;
    },

    startRun(graphId, sessionId) {
      const targetSessionId = sessionId || this.ensureSession().id;
      const blueprint = buildRunBlueprint(graphId);
      return createRun(statePath, {
        sessionId: targetSessionId,
        graphId: blueprint.graphId,
        graphName: blueprint.graphName,
        summary: blueprint.summary,
        nextAction: blueprint.nextAction,
        checkpoints: blueprint.checkpoints
      });
    }
  };
}