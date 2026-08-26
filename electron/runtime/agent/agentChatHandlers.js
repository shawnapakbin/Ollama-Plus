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
import { readRuntimeState } from '../runtimeStore.js';
import { createToolDispatcher } from './toolDispatcher.js';
import { resolveMasterPrompt } from './masterPrompt.js';

// ─── Tool-loop Constants ─────────────────────────────────────────────────────

/**
 * Maximum number of tool-execution rounds per user message. Prevents an
 * infinite loop when the model keeps requesting tools without ever producing
 * a final text answer.
 */
const MAX_TOOL_ROUNDS = 8;

/** Maximum characters of a tool result appended to the transcript. */
const MAX_TOOL_RESULT_LENGTH = 10_000;

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

// ─── Combined System Message Composition ─────────────────────────────────────

/**
 * Joins the Master_Prompt and System_Prompt into a single system-message body.
 *
 * Both inputs are trimmed. When both are non-empty they are joined master-first
 * with a blank line between them. When only one is non-empty that value is
 * returned alone. When both are empty the result is `''`.
 *
 * @param {string} masterPrompt - Developer-defined Master_Prompt (may be empty)
 * @param {string} systemPrompt - User-editable System_Prompt (may be empty)
 * @returns {string} The combined content, or `''` when both layers are empty.
 */
export function composeCombinedContent(masterPrompt, systemPrompt) {
  const master = typeof masterPrompt === 'string' ? masterPrompt.trim() : '';
  const system = typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  if (master && system) return `${master}\n\n${system}`;
  return master || system; // '' when both empty
}

/**
 * Returns a new transcript with a single leading `role: 'system'` message when
 * the combined content is non-empty; otherwise returns a copy of the base
 * transcript unchanged. Never mutates the input array.
 *
 * @param {Array<{ role: string, content: string }>} baseTranscript - User/assistant transcript.
 * @param {string} masterPrompt - Developer-defined Master_Prompt (may be empty).
 * @param {string} systemPrompt - User-editable System_Prompt (may be empty).
 * @returns {Array<{ role: string, content: string }>} A fresh transcript array.
 */
export function composeSystemMessage(baseTranscript, masterPrompt, systemPrompt) {
  const content = composeCombinedContent(masterPrompt, systemPrompt);
  const rest = Array.isArray(baseTranscript) ? baseTranscript : [];
  if (!content) return [...rest]; // omit when both empty
  return [{ role: 'system', content }, ...rest];
}

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

/**
 * Builds the OpenAI/Ollama-style `tools` function-definition array from the
 * available MCP tools. Each entry is `{ type: 'function', function: { name,
 * description, parameters } }`.
 *
 * Returns an empty array when no gateway is wired, when the gateway does not
 * expose a `listTools` method, or when the catalog is empty. Callers must omit
 * the `tools` field entirely on an empty array so the outgoing /api/chat body
 * stays byte-for-byte identical to a tool-less request.
 *
 * @param {object|null|undefined} mcpGateway - The MCP gateway (may expose async `listTools`)
 * @returns {Promise<object[]>}
 */
async function buildToolCatalog(mcpGateway) {
  if (!mcpGateway || typeof mcpGateway.listTools !== 'function') {
    return [];
  }

  let tools;
  try {
    tools = await mcpGateway.listTools();
  } catch {
    // A gateway that cannot list its tools behaves exactly as today (no tools).
    return [];
  }

  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  return tools
    .filter((tool) => tool && typeof tool === 'object' && typeof tool.name === 'string' && tool.name.trim())
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: tool.parameters && typeof tool.parameters === 'object'
          ? tool.parameters
          : { type: 'object', properties: {} }
      }
    }));
}

/**
 * Extracts the function name and arguments from a normalized Ollama tool call.
 * Ollama emits `{ function: { name, arguments } }`; `arguments` may be an
 * object or a JSON string.
 *
 * @param {object} toolCall
 * @returns {{ name: string, args: Record<string, unknown> }}
 */
function parseToolCall(toolCall) {
  const fn = toolCall && typeof toolCall === 'object' ? toolCall.function : null;
  const name = fn && typeof fn.name === 'string' ? fn.name : '';

  let args = {};
  const rawArgs = fn ? fn.arguments : undefined;
  if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs;
  } else if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === 'object') {
        args = parsed;
      }
    } catch {
      args = {};
    }
  }

  return { name, args };
}

/**
 * Maps an MCP tool name to a toolDispatcher intent. Tool names follow the
 * `<server>_<action>` convention (e.g. `folder_read_file` → server `folder`,
 * action `read_file`). The server segment is the substring before the first
 * underscore; the action is everything after it.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
 * @returns {{ tool: string, server: string, action: string, params: Record<string, unknown> } | null}
 */
function mapToolCallToIntent(toolName, args) {
  if (typeof toolName !== 'string' || !toolName.trim()) {
    return null;
  }
  const underscore = toolName.indexOf('_');
  if (underscore <= 0 || underscore >= toolName.length - 1) {
    return null;
  }
  const server = toolName.slice(0, underscore);
  const action = toolName.slice(underscore + 1);
  return {
    tool: classifyToolCategory(toolName),
    server,
    action,
    params: args && typeof args === 'object' ? args : {}
  };
}

/**
 * Truncates a tool result string to the transcript limit.
 * @param {string} text
 * @returns {string}
 */
function truncateToolResult(text) {
  const str = typeof text === 'string' ? text : String(text ?? '');
  if (str.length <= MAX_TOOL_RESULT_LENGTH) return str;
  return str.slice(0, MAX_TOOL_RESULT_LENGTH) + '\n…[truncated]';
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
 * @param {object} [options.mcpGateway] - MCP gateway exposing `dispatch({ server, action, payload })` and optionally `listTools()`
 * @param {object} [options.sandboxEnforcer] - Sandbox enforcer instance (defaults to a fresh one)
 * @param {Function} [options.getChatConfig] - Reads the persisted chat config (for `systemPrompt`). Defaults to the store.
 * @param {Function} [options.resolveMaster] - Resolves the Master_Prompt. Defaults to the env-aware resolver.
 * @returns {{ removeHandlers: () => void, getSessionStore: () => AgentChatSessionStore }}
 */
export function registerAgentChatHandlers(ipcMain, mainWindow, options = {}) {
  const {
    statePath,
    fetchImpl = globalThis.fetch,
    defaultEndpoint = 'http://localhost:11434',
    mcpGateway = null,
    sandboxEnforcer = null,
    // Reads the persisted chat config (systemPrompt). Defaults to the store.
    getChatConfig = () => readRuntimeState(statePath).chatConfig,
    // Resolves the Master_Prompt. Defaults to the env-aware resolver.
    resolveMaster = resolveMasterPrompt
  } = options;

  // Wrap mcpGateway.dispatch into the toolDispatcher's expected signature:
  // (server, action, payload) => Promise<result>, mirroring agentRuntime.js.
  const gatewayFn = mcpGateway && typeof mcpGateway.dispatch === 'function'
    ? async (server, action, payload) => {
        const result = await mcpGateway.dispatch({ server, action, payload });
        return result;
      }
    : null;

  // A tool dispatcher is only usable when a gateway is wired. When absent, the
  // conversational path behaves exactly as today (no tools advertised or run).
  // The conversational surface has no bound working directory, so the sandbox
  // enforcer is only applied when one is explicitly supplied by the caller —
  // otherwise path-based validation would reject every tool call for lack of a
  // working directory.
  const toolDispatcher = gatewayFn
    ? createToolDispatcher({
        mcpGateway: gatewayFn,
        sandboxEnforcer: sandboxEnforcer || undefined
      })
    : null;

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
        // Build the base message transcript for context (user/assistant only,
        // exactly as before). This never includes any system-level guidance.
        const baseTranscript = session.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content }));

        // Resolve both system-prompt layers at send time so the env-var override
        // stays live and the persisted System_Prompt reflects the latest save.
        const masterPrompt = resolveMaster();
        const systemPrompt = getChatConfig()?.systemPrompt ?? '';

        // Prepend the single Combined_System_Message. When both layers are empty
        // the transcript is unchanged (no system entry), preserving today's shape.
        const transcript = composeSystemMessage(baseTranscript, masterPrompt, systemPrompt);

        // Assemble the tool catalog. Empty when no gateway is wired / no tools
        // are available, in which case we advertise nothing (unchanged behavior).
        const toolCatalog = toolDispatcher ? await buildToolCatalog(mcpGateway) : [];
        const tools = toolCatalog.length > 0 ? toolCatalog : undefined;

        if (abortController.signal.aborted) return;

        // Run a bounded model/tool loop. Each iteration streams one model turn;
        // if the turn requests tools we dispatch them, append role:'tool'
        // messages to the transcript, and re-invoke. The loop terminates on the
        // first tool-less turn (today's exact path) or when the round cap is hit.
        let response = null;
        let round = 0;
        while (true) {
          response = await requestOllamaChatStream(fetchImpl, {
            endpoint,
            model,
            messages: transcript,
            tools
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

          const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

          // No tool calls → the model produced its final turn. Fall through to
          // the existing completion path unchanged (tool-less messages skip the
          // loop entirely).
          if (toolCalls.length === 0 || !toolDispatcher) {
            break;
          }

          // Round cap: stop looping and let the model's latest text stand as the
          // final answer to avoid an unbounded tool loop.
          if (round >= MAX_TOOL_ROUNDS) {
            emitStreamEvent({
              type: 'chat-token',
              requestId,
              sessionId,
              delta: '\n\n[Tool round limit reached; returning current response.]',
              isThinking: false
            });
            break;
          }
          round += 1;

          // Record the assistant tool-call turn in the transcript so the model
          // sees its own request alongside the tool results.
          transcript.push({
            role: 'assistant',
            content: response.content || '',
            tool_calls: toolCalls
          });

          // Dispatch each requested tool and append its result to the transcript.
          for (const toolCall of toolCalls) {
            if (abortController.signal.aborted) return;

            const { name: toolName, args } = parseToolCall(toolCall);
            const intent = mapToolCallToIntent(toolName, args);

            let resultText;
            let isError = false;

            if (!intent) {
              // Unknown / unparseable tool name.
              isError = true;
              resultText = `Error: unknown tool "${toolName || '(unnamed)'}".`;
            } else {
              emitStreamEvent({
                type: 'tool-call',
                requestId,
                sessionId,
                tool: toolName,
                server: intent.server,
                action: intent.action,
                params: intent.params
              });

              try {
                const record = await toolDispatcher.dispatch(intent);
                if (record && record.status === 'success') {
                  resultText = truncateToolResult(record.output);
                } else {
                  isError = true;
                  resultText = `Error: ${record?.error || 'tool dispatch failed'}`;
                }
              } catch (dispatchErr) {
                isError = true;
                resultText = `Error: ${dispatchErr?.message || 'tool dispatch failed'}`;
              }
            }

            if (abortController.signal.aborted) return;

            // Append the tool result to the transcript as a role:'tool' message.
            transcript.push({
              role: 'tool',
              name: toolName,
              content: resultText
            });

            // Reflect the tool call and its result in the Agent window (Req 2.4).
            emitStreamEvent({
              type: 'tool-result',
              requestId,
              sessionId,
              tool: toolName,
              status: isError ? 'error' : 'success',
              output: resultText
            });
          }

          // Re-invoke the model with the augmented transcript.
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
