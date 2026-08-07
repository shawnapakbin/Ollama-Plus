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

  return {
    id: String(message?.id ?? ''),
    sessionId: String(message?.sessionId ?? ''),
    role,
    content: typeof message?.content === 'string' ? message.content : '',
    model: typeof message?.model === 'string' && message.model.trim() ? message.model : null,
    endpoint: typeof message?.endpoint === 'string' && message.endpoint.trim() ? message.endpoint : null,
    createdAt: toIsoString(message?.createdAt, nowIso)
  };
}

export function normalizeChatConfig(config) {
  return {
    endpoint: typeof config?.endpoint === 'string' && config.endpoint.trim()
      ? config.endpoint.trim()
      : 'http://127.0.0.1:11434',
    model: typeof config?.model === 'string' ? config.model.trim() : ''
  };
}