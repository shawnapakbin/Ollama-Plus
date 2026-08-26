/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
export const SESSION_STATUSES = new Set(['draft', 'queued', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'canceled']);
export const RUN_STATUSES = new Set(['planned', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'canceled']);
export const CHECKPOINT_STATUSES = new Set(['pending', 'ready', 'running', 'waiting_approval', 'completed', 'failed', 'canceled']);
export const MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);

function toIsoString(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

export function normalizeSession(session, nowIso) {
  const fallbackTitle = 'Untitled runtime session';
  const title = typeof session?.title === 'string' && session.title.trim()
    ? session.title.trim().slice(0, 80)
    : fallbackTitle;

  const status = typeof session?.status === 'string' && SESSION_STATUSES.has(session.status)
    ? session.status
    : 'draft';

  return {
    id: String(session?.id ?? ''),
    title,
    status,
    createdAt: toIsoString(session?.createdAt, nowIso),
    updatedAt: toIsoString(session?.updatedAt, nowIso),
    lastRunSummary: typeof session?.lastRunSummary === 'string' && session.lastRunSummary.trim()
      ? session.lastRunSummary.trim()
      : 'No graph runs yet.'
  };
}

export function normalizeCheckpoint(checkpoint, index) {
  const order = Number.isFinite(Number(checkpoint?.order))
    ? Math.max(1, Math.floor(Number(checkpoint.order)))
    : index + 1;

  const status = typeof checkpoint?.status === 'string' && CHECKPOINT_STATUSES.has(checkpoint.status)
    ? checkpoint.status
    : index === 0 ? 'ready' : 'pending';

  return {
    id: typeof checkpoint?.id === 'string' && checkpoint.id.trim()
      ? checkpoint.id
      : `checkpoint:${order}`,
    order,
    title: typeof checkpoint?.title === 'string' && checkpoint.title.trim()
      ? checkpoint.title
      : `Checkpoint ${order}`,
    status,
    requiresApproval: Boolean(checkpoint?.requiresApproval),
    approvalPolicyId: typeof checkpoint?.approvalPolicyId === 'string' && checkpoint.approvalPolicyId.trim()
      ? checkpoint.approvalPolicyId
      : null,
    approvalPolicy: checkpoint?.approvalPolicy && typeof checkpoint.approvalPolicy === 'object'
      ? {
          id: typeof checkpoint.approvalPolicy.id === 'string' ? checkpoint.approvalPolicy.id : 'manual-approval',
          actionScope: typeof checkpoint.approvalPolicy.actionScope === 'string'
            ? checkpoint.approvalPolicy.actionScope
            : 'unspecified',
          minRiskScore: Number.isFinite(Number(checkpoint.approvalPolicy.minRiskScore))
            ? Math.max(0, Math.floor(Number(checkpoint.approvalPolicy.minRiskScore)))
            : 0,
          requiredApproverRole: typeof checkpoint.approvalPolicy.requiredApproverRole === 'string'
            ? checkpoint.approvalPolicy.requiredApproverRole
            : 'runtime-reviewer'
        }
      : null
  };
}

export function normalizeRun(run, nowIso) {
  const status = typeof run?.status === 'string' && RUN_STATUSES.has(run.status)
    ? run.status
    : 'planned';

  const checkpoints = Array.isArray(run?.checkpoints)
    ? run.checkpoints.map((checkpoint, index) => normalizeCheckpoint(checkpoint, index))
    : [];

  return {
    id: String(run?.id ?? ''),
    sessionId: String(run?.sessionId ?? ''),
    graphId: typeof run?.graphId === 'string' ? run.graphId : '',
    graphName: typeof run?.graphName === 'string' && run.graphName.trim() ? run.graphName : 'Unknown graph',
    status,
    summary: typeof run?.summary === 'string' && run.summary.trim()
      ? run.summary
      : 'No run summary recorded.',
    nextAction: typeof run?.nextAction === 'string' && run.nextAction.trim()
      ? run.nextAction
      : 'No follow-up action recorded.',
    checkpoints,
    events: Array.isArray(run?.events)
      ? run.events.filter((entry) => typeof entry === 'string')
      : [],
    output: typeof run?.output === 'string' ? run.output : '',
    error: typeof run?.error === 'string' ? run.error : '',
    pendingApproval: run?.pendingApproval && typeof run.pendingApproval === 'object'
      ? {
          checkpointId: typeof run.pendingApproval.checkpointId === 'string' ? run.pendingApproval.checkpointId : '',
          checkpointOrder: Number.isFinite(Number(run.pendingApproval.checkpointOrder))
            ? Math.max(1, Math.floor(Number(run.pendingApproval.checkpointOrder)))
            : 0,
          checkpointTitle: typeof run.pendingApproval.checkpointTitle === 'string' ? run.pendingApproval.checkpointTitle : '',
          approvalPolicyId: typeof run.pendingApproval.approvalPolicyId === 'string'
            ? run.pendingApproval.approvalPolicyId
            : null,
          requestedAt: typeof run.pendingApproval.requestedAt === 'string' ? run.pendingApproval.requestedAt : null,
          requiredApproverRole: typeof run.pendingApproval.requiredApproverRole === 'string'
            ? run.pendingApproval.requiredApproverRole
            : null,
          actionScope: typeof run.pendingApproval.actionScope === 'string' ? run.pendingApproval.actionScope : null,
          minRiskScore: Number.isFinite(Number(run.pendingApproval.minRiskScore))
            ? Math.max(0, Math.floor(Number(run.pendingApproval.minRiskScore)))
            : 0
        }
      : null,
    createdAt: toIsoString(run?.createdAt, nowIso),
    updatedAt: toIsoString(run?.updatedAt, nowIso),
    startedAt: typeof run?.startedAt === 'string' ? run.startedAt : null,
    completedAt: typeof run?.completedAt === 'string' ? run.completedAt : null
  };
}

export function normalizeMessage(message, nowIso) {
  const role = typeof message?.role === 'string' && MESSAGE_ROLES.has(message.role)
    ? message.role
    : 'assistant';

  const metrics = message?.metrics && typeof message.metrics === 'object'
    ? {
        totalDuration: Number.isFinite(Number(message.metrics.totalDuration)) ? Number(message.metrics.totalDuration) : null,
        loadDuration: Number.isFinite(Number(message.metrics.loadDuration)) ? Number(message.metrics.loadDuration) : null,
        promptEvalCount: Number.isFinite(Number(message.metrics.promptEvalCount)) ? Number(message.metrics.promptEvalCount) : null,
        promptEvalDuration: Number.isFinite(Number(message.metrics.promptEvalDuration)) ? Number(message.metrics.promptEvalDuration) : null,
        evalCount: Number.isFinite(Number(message.metrics.evalCount)) ? Number(message.metrics.evalCount) : null,
        evalDuration: Number.isFinite(Number(message.metrics.evalDuration)) ? Number(message.metrics.evalDuration) : null
      }
    : null;

  return {
    id: String(message?.id ?? ''),
    sessionId: String(message?.sessionId ?? ''),
    role,
    content: typeof message?.content === 'string' ? message.content : '',
    model: typeof message?.model === 'string' && message.model.trim() ? message.model : null,
    endpoint: typeof message?.endpoint === 'string' && message.endpoint.trim() ? message.endpoint : null,
    createdAt: toIsoString(message?.createdAt, nowIso),
    metrics
  };
}

export const MAX_SYSTEM_PROMPT_LENGTH = 8000;

export function normalizeChatConfig(config) {
  const rawSystemPrompt = typeof config?.systemPrompt === 'string' ? config.systemPrompt : '';
  const systemPrompt = rawSystemPrompt.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH);
  return {
    endpoint: typeof config?.endpoint === 'string' && config.endpoint.trim()
      ? config.endpoint.trim()
      : 'http://127.0.0.1:11434',
    model: typeof config?.model === 'string' ? config.model.trim() : '',
    autoRenameEnabled: typeof config?.autoRenameEnabled === 'boolean'
      ? config.autoRenameEnabled
      : true,
    systemPrompt
  };
}

export function normalizeOllamaServer(server, nowIso) {
  return {
    id: String(server?.id ?? ''),
    label: typeof server?.label === 'string' && server.label.trim()
      ? server.label.trim().slice(0, 80)
      : 'Ollama server',
    endpoint: typeof server?.endpoint === 'string' ? server.endpoint.trim() : '',
    createdAt: toIsoString(server?.createdAt, nowIso),
    updatedAt: toIsoString(server?.updatedAt, nowIso)
  };
}

export function normalizeMemoryRecord(record, nowIso) {
  const fact = typeof record?.fact === 'string' ? record.fact.trim() : '';
  const retention = typeof record?.retention === 'string' && record.retention.trim()
    ? record.retention.trim()
    : 'short-term';
  const tags = Array.isArray(record?.tags)
    ? record.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim().toLowerCase()).slice(0, 16)
    : [];
  const sourceMessageIds = Array.isArray(record?.sourceMessageIds)
    ? record.sourceMessageIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, 16)
    : [];

  return {
    id: String(record?.id ?? ''),
    sessionId: String(record?.sessionId ?? ''),
    runId: String(record?.runId ?? ''),
    fact,
    importanceScore: Number.isFinite(Number(record?.importanceScore))
      ? Math.max(1, Math.min(100, Math.floor(Number(record.importanceScore))))
      : 1,
    retention,
    tags,
    sourceMessageIds,
    createdAt: toIsoString(record?.createdAt, nowIso),
    updatedAt: toIsoString(record?.updatedAt, nowIso)
  };
}