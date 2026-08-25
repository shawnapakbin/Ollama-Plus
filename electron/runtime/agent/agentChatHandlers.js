/**
 * Agent Chat IPC Handlers
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Bridge/adapter layer connecting the preload's agent-chat IPC channels
 * to the existing Agent Runtime backend. Translates execution events into
 * the AgentChatStreamEvent format for the redesigned conversational UI.
 *
 * Requirements: 11.1, 12.1, 12.6
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requestOllamaChatStream, normalizeOllamaBaseUrl } from '../ollamaClient.js';

// ─── IPC Channel Constants ───────────────────────────────────────────────────

export const AGENT_CHAT_CHANNELS = Object.freeze({
  SEND_MESSAGE: 'agent-chat:send-message',
  STREAM: 'agent-chat:stream',
  STOP: 'agent-chat:stop',
  LIST_SESSIONS: 'agent-chat:list-sessions',
  GET_SESSION: 'agent-chat:get-session',
  GET_LAST_ACTIVE_SESSION: 'agent-chat:get-last-active-session',
  DELETE_SESSION: 'agent-chat:delete-session'
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generates an ISO 8601 timestamp.
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Derives a session title from the first user message content.
 * Truncates to 60 characters at a word boundary with ellipsis.
 * @param {string} content
 * @returns {string}
 */
function deriveTitle(content) {
  const trimmed = content.trim();
  if (trimmed.length <= 60) return trimmed;
  const truncated = trimmed.slice(0, 60);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 20) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

/**
 * Classifies a tool name into a ToolCategory.
 * @param {string} toolName
 * @returns {'file' | 'terminal' | 'browser' | 'http' | 'python'}
 */
function classifyToolCategory(toolName) {
  const name = (toolName || '').toLowerCase();
  if (name.includes('file') || name.includes('folder') || name.includes('read') || name.includes('write')) return 'file';
  if (name.includes('terminal') || name.includes('shell') || name.includes('exec') || name.includes('command')) return 'terminal';
  if (name.includes('browser') || name.includes('page') || name.includes('playwright')) return 'browser';
  if (name.includes('http') || name.includes('fetch') || name.includes('request') || name.includes('api')) return 'http';
  if (name.includes('python') || name.includes('sandbox')) return 'python';
  return 'terminal'; // Default fallback
}

// ─── Agent Chat Session Store ────────────────────────────────────────────────

/**
 * Simple file-based store for agent chat sessions.
 * Separate from the task-oriented session store to support the chat model.
 */
class AgentChatSessionStore {
  /**
   * @param {string} storePath - Path to the chat sessions JSON file
   */
  constructor(storePath) {
    this.storePath = storePath;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
  }

  /**
   * Loads all sessions from disk.
   * @returns {object[]}
   */
  _load() {
    if (!fs.existsSync(this.storePath)) return [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /**
   * Writes sessions to disk.
   * @param {object[]} sessions
   */
  _save(sessions) {
    fs.writeFileSync(this.storePath, JSON.stringify(sessions, null, 2), 'utf8');
  }

  /**
   * Creates a new chat session.
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.title
   * @param {string} params.modelId
   * @param {string} params.endpoint
   * @returns {object} The created session
   */
  create({ id, title, modelId, endpoint }) {
    const now = timestamp();
    const session = {
      id,
      title,
      status: 'active',
      messages: [],
      timelineEvents: [],
      plan: null,
      artifacts: [],
      memoryRecords: [],
      modelId,
      endpoint,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      totalDuration: null
    };
    const sessions = this._load();
    sessions.unshift(session);
    this._save(sessions);
    return session;
  }

  /**
   * Gets a session by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  get(sessionId) {
    const sessions = this._load();
    return sessions.find(s => s.id === sessionId) || null;
  }

  /**
   * Updates a session (upserts).
   * @param {object} session
   */
  update(session) {
    const sessions = this._load();
    const idx = sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.unshift(session);
    }
    this._save(sessions);
  }

  /**
   * Lists all sessions as summaries in reverse chronological order.
   * @returns {object[]}
   */
  list() {
    const sessions = this._load();
    return sessions
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
      .map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt,
        messageCount: s.messageCount || 0,
        totalDuration: s.totalDuration
      }));
  }

  /**
   * Gets the last active session (most recently updated with status 'active').
   * @returns {object|null}
   */
  getLastActive() {
    const sessions = this._load();
    const active = sessions
      .filter(s => s.status === 'active')
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    return active.length > 0 ? active[0] : null;
  }

  /**
   * Deletes a session by ID.
   * @param {string} sessionId
   * @returns {boolean} true if deleted
   */
  delete(sessionId) {
    const sessions = this._load();
    const filtered = sessions.filter(s => s.id !== sessionId);
    if (filtered.length === sessions.length) return false;
    this._save(filtered);
    return true;
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Registers all agent-chat IPC handlers on the Electron main process.
 *
 * This adapts the existing Agent Runtime's execution/streaming infrastructure
 * into the conversational AgentChatStreamEvent format used by the redesigned UI.
 *
 * @param {Electron.IpcMain} ipcMain - Electron IPC main handle
 * @param {Electron.BrowserWindow} mainWindow - Main browser window for sending stream events
 * @param {object} options
 * @param {string} options.statePath - Path to runtime state storage directory
 * @param {Function} [options.fetchImpl] - Custom fetch implementation (defaults to globalThis.fetch)
 * @param {string} [options.defaultEndpoint] - Default Ollama endpoint
 * @returns {{ removeHandlers: () => void, getSessionStore: () => AgentChatSessionStore }}
 */
export function registerAgentChatHandlers(ipcMain, mainWindow, options = {}) {
  const {
    statePath,
    fetchImpl = globalThis.fetch,
    defaultEndpoint = 'http://localhost:11434'
  } = options;

  // Chat sessions stored separately from task sessions
  const chatSessionsDir = path.join(path.dirname(statePath), 'agent-chat');
  fs.mkdirSync(chatSessionsDir, { recursive: true });
  const sessionStore = new AgentChatSessionStore(path.join(chatSessionsDir, 'sessions.json'));

  // Track active streaming requests so we can cancel them
  // Maps sessionId -> AbortController
  const activeStreams = new Map();

  /**
   * Sends an AgentChatStreamEvent to the renderer via the stream channel.
   * @param {object} event
   */
  function emitStreamEvent(event) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(AGENT_CHAT_CHANNELS.STREAM, event);
      }
    } catch {
      // Window may be closed; swallow errors
    }
  }

  // ─── agent-chat:send-message ─────────────────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.SEND_MESSAGE, async (_event, input) => {
    const content = typeof input?.content === 'string' ? input.content.trim() : '';
    if (!content) {
      throw new Error('Message content must be non-empty.');
    }

    const model = typeof input?.model === 'string' && input.model.trim()
      ? input.model.trim()
      : null;
    const endpoint = normalizeOllamaBaseUrl(
      typeof input?.endpoint === 'string' && input.endpoint.trim()
        ? input.endpoint.trim()
        : defaultEndpoint
    );

    if (!model) {
      throw new Error('No model specified. Configure a model before sending messages.');
    }

    const requestId = (typeof input?.requestId === 'string' && input.requestId.trim())
      ? input.requestId.trim()
      : randomUUID();

    // Resolve or create session
    let session;
    if (input?.sessionId) {
      session = sessionStore.get(input.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${input.sessionId}`);
      }
    } else {
      // Create a new session from first message
      session = sessionStore.create({
        id: randomUUID(),
        title: deriveTitle(content),
        modelId: model,
        endpoint
      });
    }

    const sessionId = session.id;

    // Build the user message
    const userMessage = {
      id: randomUUID(),
      sessionId,
      role: 'user',
      content,
      displayLabel: 'You',
      timestamp: timestamp(),
      attachments: Array.isArray(input?.attachments) ? input.attachments : [],
      thinkingContent: null,
      isComplete: true
    };

    // Persist user message to session
    session.messages.push(userMessage);
    session.messageCount = session.messages.length;
    session.updatedAt = timestamp();
    sessionStore.update(session);

    // Emit chat-started event
    emitStreamEvent({
      type: 'chat-started',
      requestId,
      sessionId,
      model,
      endpoint,
      userMessage
    });

    // Begin streaming response asynchronously
    const abortController = new AbortController();
    activeStreams.set(sessionId, abortController);

    setImmediate(async () => {
      try {
        // Build message transcript for context
        const transcript = session.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content }));

        const response = await requestOllamaChatStream(fetchImpl, {
          endpoint,
          model,
          messages: transcript
        }, {
          onToken: (delta) => {
            if (abortController.signal.aborted) return;
            emitStreamEvent({
              type: 'chat-token',
              requestId,
              sessionId,
              delta,
              isThinking: false
            });
          }
        });

        // Check if aborted during streaming
        if (abortController.signal.aborted) {
          return;
        }

        // Extract thinking content if present
        let mainContent = response.content;
        let thinkingContent = null;
        const thinkMatch = response.content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          thinkingContent = thinkMatch[1].trim();
          mainContent = response.content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }

        // Build the assistant message
        const assistantMessage = {
          id: randomUUID(),
          sessionId,
          role: 'assistant',
          content: mainContent,
          displayLabel: model,
          timestamp: timestamp(),
          attachments: [],
          thinkingContent,
          isComplete: true
        };

        // Persist assistant message to session
        session = sessionStore.get(sessionId);
        if (session) {
          session.messages.push(assistantMessage);
          session.messageCount = session.messages.length;
          session.updatedAt = timestamp();
          sessionStore.update(session);
        }

        // Emit chat-completed event
        emitStreamEvent({
          type: 'chat-completed',
          requestId,
          sessionId,
          assistantMessage
        });
      } catch (err) {
        if (abortController.signal.aborted) return;

        // Determine error classification
        const message = err?.message || 'An unexpected error occurred';
        const isTransient = message.includes('ECONNREFUSED') ||
          message.includes('ETIMEDOUT') ||
          message.includes('ECONNRESET') ||
          message.includes('timeout') ||
          message.includes('network');

        emitStreamEvent({
          type: 'chat-error',
          requestId,
          sessionId,
          message,
          classification: isTransient ? 'transient' : 'permanent',
          canRetry: isTransient
        });
      } finally {
        activeStreams.delete(sessionId);
      }
    });

    return { sessionId, requestId };
  });

  // ─── agent-chat:stop ─────────────────────────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.STOP, async (_event, sessionId) => {
    const controller = activeStreams.get(sessionId);
    if (controller) {
      controller.abort();
      activeStreams.delete(sessionId);
      return { success: true };
    }
    return { success: false, error: 'No active stream for this session' };
  });

  // ─── agent-chat:list-sessions ────────────────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.LIST_SESSIONS, async () => {
    return sessionStore.list();
  });

  // ─── agent-chat:get-session ──────────────────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.GET_SESSION, async (_event, sessionId) => {
    return sessionStore.get(sessionId);
  });

  // ─── agent-chat:get-last-active-session ──────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.GET_LAST_ACTIVE_SESSION, async () => {
    return sessionStore.getLastActive();
  });

  // ─── agent-chat:delete-session ───────────────────────────────────────────

  ipcMain.handle(AGENT_CHAT_CHANNELS.DELETE_SESSION, async (_event, sessionId) => {
    const deleted = sessionStore.delete(sessionId);
    if (!deleted) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return { success: true };
  });

  // ─── Public Interface ──────────────────────────────────────────────────────

  return {
    /**
     * Removes all registered IPC handlers (for testing/cleanup).
     */
    removeHandlers() {
      Object.values(AGENT_CHAT_CHANNELS).forEach(channel => {
        if (channel !== AGENT_CHAT_CHANNELS.STREAM) {
          try {
            ipcMain.removeHandler(channel);
          } catch {
            // Handler may not exist
          }
        }
      });
    },

    /**
     * Returns the session store instance (for testing/inspection).
     * @returns {AgentChatSessionStore}
     */
    getSessionStore() {
      return sessionStore;
    }
  };
}
