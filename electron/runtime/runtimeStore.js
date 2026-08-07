import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeChatConfig, normalizeMessage, normalizeRun, normalizeSession } from './stateSchema.js';

function emptyState() {
  return {
    sessions: [],
    runs: [],
    messages: [],
    chatConfig: normalizeChatConfig()
  };
}

function normalizeState(state) {
  const nowIso = new Date().toISOString();
  return {
    sessions: (Array.isArray(state.sessions) ? state.sessions : [])
      .map((session) => normalizeSession(session, nowIso))
      .filter((session) => Boolean(session.id)),
    runs: (Array.isArray(state.runs) ? state.runs : [])
      .map((run) => normalizeRun(run, nowIso))
      .filter((run) => Boolean(run.id) && Boolean(run.sessionId)),
    messages: (Array.isArray(state.messages) ? state.messages : [])
      .map((message) => normalizeMessage(message, nowIso))
      .filter((message) => Boolean(message.id) && Boolean(message.sessionId)),
    chatConfig: normalizeChatConfig(state.chatConfig)
  };
}

function sortByUpdatedAt(items) {
  return items.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function ensureStateDir(statePath) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
}

export function readRuntimeState(statePath) {
  ensureStateDir(statePath);
  if (!fs.existsSync(statePath)) {
    return emptyState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return normalizeState({
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      runs: Array.isArray(parsed?.runs) ? parsed.runs : [],
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
      chatConfig: parsed?.chatConfig
    });
  } catch {
    return emptyState();
  }
}

export function writeRuntimeState(statePath, state) {
  ensureStateDir(statePath);
  fs.writeFileSync(statePath, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

export function listSessions(statePath) {
  return sortByUpdatedAt(readRuntimeState(statePath).sessions);
}

export function listRuns(statePath, sessionId) {
  const allRuns = readRuntimeState(statePath).runs;
  const filtered = typeof sessionId === 'string' && sessionId
    ? allRuns.filter((run) => run.sessionId === sessionId)
    : allRuns;
  return sortByUpdatedAt(filtered);
}

export function listMessages(statePath, sessionId) {
  const allMessages = readRuntimeState(statePath).messages;
  const filtered = typeof sessionId === 'string' && sessionId
    ? allMessages.filter((message) => message.sessionId === sessionId)
    : allMessages;

  return filtered.slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getChatConfig(statePath) {
  return readRuntimeState(statePath).chatConfig;
}

export function updateChatConfig(statePath, updater) {
  const state = readRuntimeState(statePath);
  const nextCandidate = typeof updater === 'function' ? updater(state.chatConfig) : updater;
  state.chatConfig = normalizeChatConfig(nextCandidate);
  writeRuntimeState(statePath, state);
  return state.chatConfig;
}

export function createSession(statePath, title, options = {}) {
  const state = readRuntimeState(statePath);
  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? new Date().toISOString();
  const session = normalizeSession({
    id: idFactory(),
    title,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    lastRunSummary: 'No graph runs yet.'
  }, now);

  state.sessions.unshift(session);
  writeRuntimeState(statePath, state);
  return session;
}

export function appendMessage(statePath, input, options = {}) {
  const state = readRuntimeState(statePath);
  const targetSession = state.sessions.find((session) => session.id === input.sessionId);
  if (!targetSession) {
    throw new Error(`Cannot append message for unknown session: ${input.sessionId}`);
  }

  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? new Date().toISOString();
  const message = normalizeMessage({
    id: idFactory(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    model: input.model,
    endpoint: input.endpoint,
    createdAt: now
  }, now);

  state.messages.push(message);
  targetSession.updatedAt = now;
  targetSession.status = message.role === 'assistant' ? 'completed' : 'running';
  targetSession.lastRunSummary = message.role === 'user'
    ? message.content.trim().slice(0, 120) || 'User message sent.'
    : 'Assistant replied.';
  writeRuntimeState(statePath, state);
  return message;
}

export function createRun(statePath, input, options = {}) {
  const state = readRuntimeState(statePath);
  const targetSession = state.sessions.find((session) => session.id === input.sessionId);
  if (!targetSession) {
    throw new Error(`Cannot create run for unknown session: ${input.sessionId}`);
  }

  const idFactory = options.idFactory ?? randomUUID;
  const now = options.now ?? new Date().toISOString();
  const run = normalizeRun({
    id: idFactory(),
    sessionId: input.sessionId,
    graphId: input.graphId,
    graphName: input.graphName,
    status: 'planned',
    summary: input.summary,
    nextAction: input.nextAction,
    checkpoints: input.checkpoints,
    events: [],
    output: '',
    error: '',
    createdAt: now,
    updatedAt: now
  }, now);

  state.runs.unshift(run);
  targetSession.status = 'queued';
  targetSession.updatedAt = now;
  targetSession.lastRunSummary = `Prepared ${input.graphName}.`;
  writeRuntimeState(statePath, state);
  return run;
}

export function updateRun(statePath, runId, updater, options = {}) {
  const state = readRuntimeState(statePath);
  const runIndex = state.runs.findIndex((run) => run.id === runId);
  if (runIndex === -1) {
    throw new Error(`Cannot update unknown run: ${runId}`);
  }

  const now = options.now ?? new Date().toISOString();
  const existingRun = state.runs[runIndex];
  const nextRunCandidate = updater(existingRun);
  const nextRun = normalizeRun({
    ...existingRun,
    ...nextRunCandidate,
    updatedAt: now
  }, now);

  state.runs[runIndex] = nextRun;

  const sessionIndex = state.sessions.findIndex((session) => session.id === nextRun.sessionId);
  if (sessionIndex >= 0) {
    const currentSession = state.sessions[sessionIndex];
    const mappedSessionStatus = nextRun.status === 'running'
      ? 'running'
      : nextRun.status === 'paused'
        ? 'paused'
        : nextRun.status === 'waiting_approval'
          ? 'waiting_approval'
        : nextRun.status === 'completed'
          ? 'completed'
          : nextRun.status === 'failed'
            ? 'failed'
            : nextRun.status === 'canceled'
              ? 'canceled'
              : currentSession.status;
    state.sessions[sessionIndex] = normalizeSession({
      ...currentSession,
      updatedAt: now,
      status: mappedSessionStatus,
      lastRunSummary: nextRun.summary
    }, now);
  }

  writeRuntimeState(statePath, state);
  return nextRun;
}

export function getRunById(statePath, runId) {
  return readRuntimeState(statePath).runs.find((run) => run.id === runId) ?? null;
}

export function getSessionById(statePath, sessionId) {
  return readRuntimeState(statePath).sessions.find((session) => session.id === sessionId) ?? null;
}