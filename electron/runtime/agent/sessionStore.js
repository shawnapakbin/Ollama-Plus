/**
 * Session Store — Agent Client
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Persists full task sessions (instruction, plan, step executions, tool outputs,
 * final summary) to a local JSON store. Supports paginated listing (20 per page,
 * reverse chronological), artifact tracking with before/after content for
 * modifications < 1 MB, and re-run of past tasks in new sessions.
 *
 * Requirements: 9.1, 9.2, 9.4, 9.5, 9.6, 9.7
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default page size for paginated listing (Requirement 9.2) */
const DEFAULT_PAGE_SIZE = 20;

/** Maximum artifact before/after content size: 1 MB (Requirement 9.4) */
const MAX_ARTIFACT_CONTENT_SIZE = 1_048_576;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensures the directory containing the store file exists.
 * @param {string} storePath - Absolute path to the store JSON file
 */
function ensureStoreDir(storePath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

/**
 * Loads all sessions from the store file.
 * Returns an empty array if the file does not exist or is corrupted.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @returns {{ sessions: Array<object>, artifacts: Array<object> }}
 */
function loadStore(storePath) {
  if (!fs.existsSync(storePath)) {
    return { sessions: [], artifacts: [] };
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      artifacts: Array.isArray(parsed?.artifacts) ? parsed.artifacts : []
    };
  } catch {
    return { sessions: [], artifacts: [] };
  }
}

/**
 * Writes the store state to disk (write-through persistence).
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {{ sessions: Array<object>, artifacts: Array<object> }} store
 */
function writeStore(storePath, store) {
  ensureStoreDir(storePath);
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Normalizes a TaskSession object, ensuring all required fields have defaults.
 *
 * @param {object} session - Raw session data
 * @param {string} [nowIso] - ISO timestamp for defaults
 * @returns {object} Normalized TaskSession
 */
function normalizeSession(session, nowIso) {
  const now = nowIso || new Date().toISOString();
  return {
    id: typeof session.id === 'string' ? session.id : randomUUID(),
    instruction: typeof session.instruction === 'string' ? session.instruction : '',
    status: isValidStatus(session.status) ? session.status : 'planned',
    workingDirectory: typeof session.workingDirectory === 'string' ? session.workingDirectory : '',
    modelId: typeof session.modelId === 'string' ? session.modelId : '',
    endpoint: typeof session.endpoint === 'string' ? session.endpoint : '',
    plan: session.plan && typeof session.plan === 'object' ? session.plan : null,
    attachments: Array.isArray(session.attachments) ? session.attachments : [],
    artifacts: Array.isArray(session.artifacts) ? session.artifacts : [],
    stepResults: Array.isArray(session.stepResults) ? session.stepResults : [],
    replanCount: typeof session.replanCount === 'number' ? session.replanCount : 0,
    createdAt: typeof session.createdAt === 'string' ? session.createdAt : now,
    updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : now,
    startedAt: typeof session.startedAt === 'string' ? session.startedAt : null,
    completedAt: typeof session.completedAt === 'string' ? session.completedAt : null,
    totalDuration: typeof session.totalDuration === 'number' ? session.totalDuration : null,
    config: session.config && typeof session.config === 'object' ? session.config : {
      stepTimeout: 120,
      taskTimeout: 900,
      retryCount: 3,
      autoApprovalLowRisk: false,
      customApprovalRules: [],
      toolTimeouts: { terminal: 60, file: 30, browser: 120, python: 60, http: 30 }
    }
  };
}

/**
 * Validates a TaskSessionStatus value.
 * @param {string} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return ['planned', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'canceled'].includes(status);
}

/**
 * Normalizes an Artifact object.
 *
 * @param {object} artifact - Raw artifact data
 * @param {string} [nowIso] - ISO timestamp for defaults
 * @returns {object} Normalized Artifact
 */
function normalizeArtifact(artifact, nowIso) {
  const now = nowIso || new Date().toISOString();
  return {
    id: typeof artifact.id === 'string' ? artifact.id : randomUUID(),
    sessionId: typeof artifact.sessionId === 'string' ? artifact.sessionId : '',
    filePath: typeof artifact.filePath === 'string' ? artifact.filePath : '',
    operation: isValidOperation(artifact.operation) ? artifact.operation : 'create',
    beforeContent: typeof artifact.beforeContent === 'string' ? artifact.beforeContent : null,
    afterContent: typeof artifact.afterContent === 'string' ? artifact.afterContent : null,
    size: typeof artifact.size === 'number' ? artifact.size : 0,
    timestamp: typeof artifact.timestamp === 'string' ? artifact.timestamp : now
  };
}

/**
 * Validates an artifact operation type.
 * @param {string} operation
 * @returns {boolean}
 */
function isValidOperation(operation) {
  return ['create', 'modify', 'delete'].includes(operation);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Saves (creates or updates) a TaskSession to the store.
 * This is a write-through operation — data is persisted to disk immediately.
 *
 * Requirement 9.1: Persist every TaskSession including instruction, plan,
 * step executions, tool outputs, and final summary.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {object} session - The TaskSession object to persist
 * @param {object} [options] - Optional overrides
 * @param {function} [options.idFactory] - UUID generator
 * @param {string} [options.now] - ISO timestamp override
 * @returns {object} The normalized, persisted session
 */
export function saveSession(storePath, session, options = {}) {
  const store = loadStore(storePath);
  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || randomUUID;

  const normalized = normalizeSession({
    ...session,
    id: session.id || idFactory(),
    updatedAt: now
  }, now);

  const existingIndex = store.sessions.findIndex((s) => s.id === normalized.id);
  if (existingIndex >= 0) {
    store.sessions[existingIndex] = normalized;
  } else {
    store.sessions.unshift(normalized);
  }

  writeStore(storePath, store);
  return normalized;
}

/**
 * Retrieves a single TaskSession by its ID.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {string} sessionId - The UUID of the session to retrieve
 * @returns {object|null} The session, or null if not found
 */
export function getSession(storePath, sessionId) {
  const store = loadStore(storePath);
  return store.sessions.find((s) => s.id === sessionId) || null;
}

/**
 * Lists TaskSessions with pagination in reverse chronological order.
 *
 * Requirement 9.2: Paginated list (20 per page, reverse chronological),
 * showing title, status, creation timestamp, and duration.
 *
 * Property 16: Items within each page are in strictly descending order
 * by createdAt, and pages are ordered such that the last item on page N
 * has a createdAt >= first item on page N+1.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {object} [options] - Pagination options
 * @param {number} [options.page=1] - The page number (1-indexed)
 * @param {number} [options.pageSize=20] - Items per page
 * @returns {{ items: Array<object>, total: number, page: number, pageSize: number, totalPages: number }}
 */
export function listSessions(storePath, options = {}) {
  const store = loadStore(storePath);
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.max(1, Math.floor(options.pageSize || DEFAULT_PAGE_SIZE));

  // Sort in strictly descending order by createdAt (reverse chronological)
  const sorted = store.sessions.slice().sort((a, b) => {
    const dateA = a.createdAt || '';
    const dateB = b.createdAt || '';
    return dateB.localeCompare(dateA);
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = (page - 1) * pageSize;
  const items = sorted.slice(startIndex, startIndex + pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages
  };
}

/**
 * Deletes a TaskSession and its associated artifacts from the store.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {string} sessionId - The UUID of the session to delete
 * @returns {object} The deleted session
 * @throws {Error} If the session is not found
 */
export function deleteSession(storePath, sessionId) {
  const store = loadStore(storePath);
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error(`Cannot delete unknown session: ${sessionId}`);
  }

  store.sessions = store.sessions.filter((s) => s.id !== sessionId);
  store.artifacts = store.artifacts.filter((a) => a.sessionId !== sessionId);
  writeStore(storePath, store);
  return session;
}

/**
 * Adds an Artifact to a session. For 'modify' operations, before/after content
 * is only stored if the content size is under 1 MB.
 *
 * Requirement 9.4: Track all artifacts with file path, operation type,
 * and before/after content for modifications under 1 MB.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {string} sessionId - The session to attach the artifact to
 * @param {object} artifact - The artifact data
 * @param {object} [options] - Optional overrides
 * @param {function} [options.idFactory] - UUID generator
 * @param {string} [options.now] - ISO timestamp override
 * @returns {object} The normalized, persisted artifact
 * @throws {Error} If the session is not found
 */
export function addArtifact(storePath, sessionId, artifact, options = {}) {
  const store = loadStore(storePath);
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    throw new Error(`Cannot add artifact to unknown session: ${sessionId}`);
  }

  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || randomUUID;

  // Enforce 1 MB limit on before/after content (Requirement 9.4)
  let beforeContent = artifact.beforeContent || null;
  let afterContent = artifact.afterContent || null;

  if (beforeContent && Buffer.byteLength(beforeContent, 'utf8') > MAX_ARTIFACT_CONTENT_SIZE) {
    beforeContent = null;
  }
  if (afterContent && Buffer.byteLength(afterContent, 'utf8') > MAX_ARTIFACT_CONTENT_SIZE) {
    afterContent = null;
  }

  const normalized = normalizeArtifact({
    ...artifact,
    id: artifact.id || idFactory(),
    sessionId,
    beforeContent,
    afterContent,
    timestamp: now
  }, now);

  store.artifacts.push(normalized);

  // Also track artifact reference in the session's artifacts array
  if (!session.artifacts) {
    session.artifacts = [];
  }
  session.artifacts.push(normalized);
  session.updatedAt = now;

  writeStore(storePath, store);
  return normalized;
}

/**
 * Retrieves all artifacts for a given session.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {string} sessionId - The session to get artifacts for
 * @returns {Array<object>} List of artifacts
 */
export function getArtifacts(storePath, sessionId) {
  const store = loadStore(storePath);
  return store.artifacts.filter((a) => a.sessionId === sessionId);
}

/**
 * Re-runs a past task in a new TaskSession.
 *
 * Requirement 9.6: Support re-running a past task with the same instruction.
 * Requirement 9.7: If referenced artifacts no longer exist, include notes
 * in the new session's context indicating which files are missing.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {string} sessionId - The session to re-run
 * @param {object} [options] - Optional overrides
 * @param {function} [options.idFactory] - UUID generator
 * @param {string} [options.now] - ISO timestamp override
 * @returns {{ session: object, missingArtifacts: Array<string> }}
 * @throws {Error} If the original session is not found
 */
export function rerunSession(storePath, sessionId, options = {}) {
  const store = loadStore(storePath);
  const original = store.sessions.find((s) => s.id === sessionId);
  if (!original) {
    throw new Error(`Cannot re-run unknown session: ${sessionId}`);
  }

  const now = options.now || new Date().toISOString();
  const idFactory = options.idFactory || randomUUID;

  // Check which artifacts still exist on disk (Requirement 9.7)
  const originalArtifacts = store.artifacts.filter((a) => a.sessionId === sessionId);
  const missingArtifacts = [];

  for (const artifact of originalArtifacts) {
    if (artifact.filePath && artifact.operation !== 'delete') {
      try {
        fs.accessSync(artifact.filePath, fs.constants.F_OK);
      } catch {
        missingArtifacts.push(artifact.filePath);
      }
    }
  }

  // Create a new session with same instruction and config
  const newSession = normalizeSession({
    id: idFactory(),
    instruction: original.instruction,
    status: 'planned',
    workingDirectory: original.workingDirectory,
    modelId: original.modelId,
    endpoint: original.endpoint,
    plan: null,
    attachments: original.attachments || [],
    artifacts: [],
    stepResults: [],
    replanCount: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    totalDuration: null,
    config: original.config
  }, now);

  store.sessions.unshift(newSession);
  writeStore(storePath, store);

  return {
    session: newSession,
    missingArtifacts
  };
}
