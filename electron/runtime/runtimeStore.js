import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeChatConfig,
  normalizeMemoryRecord,
  normalizeMessage,
  normalizeOllamaServer,
  normalizeRun,
  normalizeSession
} from './stateSchema.js';

function emptyState() {
  return {
    sessions: [],
    runs: [],
    messages: [],
    ollamaServers: [],
    memoryRecords: [],
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
    ollamaServers: (Array.isArray(state.ollamaServers) ? state.ollamaServers : [])
      .map((server) => normalizeOllamaServer(server, nowIso))
      .filter((server) => Boolean(server.id) && Boolean(server.endpoint)),
    memoryRecords: (Array.isArray(state.memoryRecords) ? state.memoryRecords : [])
      .map((record) => normalizeMemoryRecord(record, nowIso))
      .filter((record) => Boolean(record.id) && Boolean(record.sessionId) && Boolean(record.runId)),
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
      ollamaServers: Array.isArray(parsed?.ollamaServers) ? parsed.ollamaServers : [],
      memoryRecords: Array.isArray(parsed?.memoryRecords) ? parsed.memoryRecords : [],
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

export function listOllamaServers(statePath) {
  return sortByUpdatedAt(readRuntimeState(statePath).ollamaServers);
}

export function listMemoryRecords(statePath, sessionId) {
  const allRecords = readRuntimeState(statePath).memoryRecords;
  const filtered = typeof sessionId === 'string' && sessionId
    ? allRecords.filter((record) => record.sessionId === sessionId)
    : allRecords;
  return sortByUpdatedAt(filtered);
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

export function renameSession(statePath, sessionId, title, options = {}) {
  const state = readRuntimeState(statePath);
  const sessionIndex = state.sessions.findIndex((session) => session.id === sessionId);
  if (sessionIndex === -1) {
    throw new Error(`Cannot rename unknown session: ${sessionId}`);
  }

  const now = options.now ?? new Date().toISOString();
  state.sessions[sessionIndex] = normalizeSession({
    ...state.sessions[sessionIndex],
    title,
    updatedAt: now
  }, now);
  writeRuntimeState(statePath, state);
  return state.sessions[sessionIndex];
}

export function deleteSession(statePath, sessionId) {
  const state = readRuntimeState(statePath);
  const sessionExists = state.sessions.some((session) => session.id === sessionId);
  if (!sessionExists) {
    throw new Error(`Cannot delete unknown session: ${sessionId}`);
  }

  state.sessions = state.sessions.filter((session) => session.id !== sessionId);
  state.runs = state.runs.filter((run) => run.sessionId !== sessionId);
  state.messages = state.messages.filter((message) => message.sessionId !== sessionId);
  state.memoryRecords = state.memoryRecords.filter((record) => record.sessionId !== sessionId);
  writeRuntimeState(statePath, state);
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

export function getMessageById(statePath, messageId) {
  return readRuntimeState(statePath).messages.find((message) => message.id === messageId) ?? null;
}

export function updateMessage(statePath, messageId, input, options = {}) {
  const state = readRuntimeState(statePath);
  const messageIndex = state.messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) {
    throw new Error(`Cannot update unknown message: ${messageId}`);
  }
  const existing = state.messages[messageIndex];
  const content = typeof input?.content === 'string' ? input.content.trim() : '';
  if (!content) {
    throw new Error('Message content cannot be empty.');
  }

  const now = options.now ?? new Date().toISOString();
  state.messages[messageIndex] = normalizeMessage({
    ...existing,
    content,
    createdAt: now
  }, now);

  const sessionIndex = state.sessions.findIndex((session) => session.id === existing.sessionId);
  if (sessionIndex >= 0) {
    state.sessions[sessionIndex] = normalizeSession({
      ...state.sessions[sessionIndex],
      updatedAt: now
    }, now);
  }

  writeRuntimeState(statePath, state);
  return state.messages[messageIndex];
}

export function deleteMessage(statePath, messageId, options = {}) {
  const state = readRuntimeState(statePath);
  const target = state.messages.find((message) => message.id === messageId);
  if (!target) {
    throw new Error(`Cannot delete unknown message: ${messageId}`);
  }
  state.messages = state.messages.filter((message) => message.id !== messageId);

  const now = options.now ?? new Date().toISOString();
  const sessionIndex = state.sessions.findIndex((session) => session.id === target.sessionId);
  if (sessionIndex >= 0) {
    const remaining = state.messages
      .filter((message) => message.sessionId === target.sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const latest = remaining[remaining.length - 1];
    state.sessions[sessionIndex] = normalizeSession({
      ...state.sessions[sessionIndex],
      updatedAt: now,
      lastRunSummary: latest?.content?.trim()?.slice(0, 120) || 'No graph runs yet.',
      status: latest?.role === 'assistant'
        ? 'completed'
        : latest?.role === 'user'
          ? 'running'
          : 'draft'
    }, now);
  }

  writeRuntimeState(statePath, state);
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

export function appendMemoryRecord(statePath, input, options = {}) {
  const state = readRuntimeState(statePath);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? randomUUID;
  const record = normalizeMemoryRecord({
    id: idFactory(),
    sessionId: input.sessionId,
    runId: input.runId,
    fact: input.fact ?? '',
    importanceScore: input.importanceScore ?? 1,
    retention: input.retention ?? 'short-term',
    tags: input.tags ?? [],
    sourceMessageIds: input.sourceMessageIds ?? [],
    createdAt: now,
    updatedAt: now
  }, now);

  state.memoryRecords.unshift(record);
  writeRuntimeState(statePath, state);
  return record;
}

export function getOllamaServerById(statePath, serverId) {
  return readRuntimeState(statePath).ollamaServers.find((server) => server.id === serverId) ?? null;
}

export function saveOllamaServer(statePath, input, options = {}) {
  const state = readRuntimeState(statePath);
  const now = options.now ?? new Date().toISOString();
  const idFactory = options.idFactory ?? randomUUID;
  const serverId = typeof input?.id === 'string' && input.id.trim() ? input.id.trim() : idFactory();
  const index = state.ollamaServers.findIndex((server) => server.id === serverId);
  const existing = index >= 0 ? state.ollamaServers[index] : null;
  const next = normalizeOllamaServer({
    ...existing,
    id: serverId,
    label: input?.label ?? existing?.label,
    endpoint: input?.endpoint ?? existing?.endpoint,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }, now);

  if (index >= 0) {
    state.ollamaServers[index] = next;
  } else {
    state.ollamaServers.unshift(next);
  }
  writeRuntimeState(statePath, state);
  return next;
}

export function removeOllamaServer(statePath, serverId) {
  const state = readRuntimeState(statePath);
  const exists = state.ollamaServers.some((server) => server.id === serverId);
  if (!exists) {
    throw new Error(`Cannot remove unknown Ollama server: ${serverId}`);
  }
  state.ollamaServers = state.ollamaServers.filter((server) => server.id !== serverId);
  writeRuntimeState(statePath, state);
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