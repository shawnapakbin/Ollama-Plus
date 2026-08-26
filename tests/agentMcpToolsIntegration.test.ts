import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Integration tests — Agent MCP Tools Not Accessible (Task 4)
 *
 *  - Full Agent flow: user message -> model requests a tool via the fake
 *    gateway -> tool result appended -> model produces a final answer
 *    reflecting the result -> assistant message persisted with correct title
 *    and thinking separation.
 *  - Context switching: alternating tool-using and tool-less messages in one
 *    session; only tool-using turns enter the loop and session state stays
 *    consistent.
 *  - Visual/event feedback: a stream event describing the tool call and its
 *    result is emitted to the Agent window, and stop/abort during a tool round
 *    halts cleanly without persisting a partial assistant message.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.3, 3.4
 */

// ─── Local test types ────────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type StreamEvent = Record<string, unknown>;
interface FetchOptions { body: string }
type ChatChunk = Record<string, unknown>;
interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
interface DispatchRequest {
  server: string;
  action: string;
  payload?: Record<string, unknown>;
}
interface SendResult { sessionId: string; [key: string]: unknown }
interface ChatMessage { role: string; content?: string; [key: string]: unknown }

// ─── Infrastructure ──────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-mcp-integ-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

function createMockIpcMain() {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle(channel: string, handler: IpcHandler) { handlers.set(channel, handler); },
    removeHandler(channel: string) { handlers.delete(channel); },
    getHandler(channel: string) { return handlers.get(channel); }
  };
}

function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: StreamEvent }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: StreamEvent) { sentEvents.push({ channel, payload }); }
    },
    getStreamEvents() {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM)
        .map((e) => e.payload);
    }
  };
}

/** Fake gateway with a scripted per-tool output map. */
function createMockMcpGateway(opts: {
  tools?: McpTool[];
  outputs?: Record<string, string>;
  slowMs?: number;
} = {}) {
  const calls: Array<{ server: string; action: string; payload?: Record<string, unknown> }> = [];
  const tools = opts.tools ?? [
    {
      name: 'folder_read_file',
      description: 'Read a file from the workspace folder',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    }
  ];
  return {
    dispatch: async (request: DispatchRequest) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      const key = `${request.server}_${request.action}`;
      return { output: opts.outputs?.[key] ?? 'DEFAULT OUTPUT' };
    },
    getCalls: () => calls,
    listTools: async () => tools
  };
}

/**
 * Scripted fetch that dispenses turns in order. Once past the scripted turns
 * it keeps returning the last turn (used only when tests script enough turns).
 */
function createScriptedFetch(turns: ChatChunk[][]) {
  const requestBodies: Array<Record<string, unknown> | null> = [];
  let turnIndex = 0;
  const fetchImpl = async (_url: string, options: FetchOptions) => {
    try { requestBodies.push(JSON.parse(options.body)); } catch { requestBodies.push(null); }
    const chunks = turns[Math.min(turnIndex, turns.length - 1)] || [];
    turnIndex += 1;
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
          }
          controller.close();
        }
      })
    };
  };
  return { fetchImpl, getRequestBodies: () => requestBodies, getTurnCount: () => turnIndex };
}

/**
 * Waits until at least `count` terminal (completed/error) events have been
 * observed and returns the `count`-th one. Because the mock window accumulates
 * every event across successive messages, callers pass an increasing count so
 * each message's terminal event is read distinctly.
 */
async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  count = 1,
  timeoutMs = 4000
): Promise<StreamEvent | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const terminals = window
      .getStreamEvents()
      .filter((e) => e.type === 'chat-completed' || e.type === 'chat-error');
    if (terminals.length >= count) return terminals[count - 1];
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

const ENDPOINT = 'http://localhost:11434';
const MODEL = 'qwen3.5:9b';

function toolCallTurn(toolName: string, args: Record<string, unknown>): ChatChunk[] {
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: toolName, arguments: args } }]
      },
      done: false
    },
    { message: { role: 'assistant', content: '' }, done: true }
  ];
}

function finalTextTurn(text: string): ChatChunk[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Agent flow (Req 2.1, 2.2, 2.3, 2.4, 3.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration: full tool-using Agent flow (Req 2.1-2.4, 3.4)', () => {
  it('user message -> tool call -> tool result -> final answer persisted with title + thinking', async () => {
    const gateway = createMockMcpGateway({
      outputs: { folder_read_file: 'the version field is 5.0.3' }
    });
    const statePath = createTempStatePath();
    const ipcMain = createMockIpcMain();
    const window = createMockMainWindow();
    const scripted = createScriptedFetch([
      toolCallTurn('folder_read_file', { path: 'package.json' }),
      finalTextTurn('<think>the tool returned 5.0.3</think>The version is 5.0.3.')
    ]);
    const api = registerAgentChatHandlers(ipcMain, window, {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    });
    const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

    const content = 'read package.json and tell me the version';
    const result = await sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT }) as SendResult;
    const terminal = await waitForCompletion(window) as StreamEvent;

    // Tool advertised on the first turn.
    expect(Array.isArray(scripted.getRequestBodies()[0].tools)).toBe(true);

    // Tool dispatched with mapped server/action/params.
    expect(gateway.getCalls()[0]).toMatchObject({ server: 'folder', action: 'read_file' });
    expect(gateway.getCalls()[0].payload).toMatchObject({ path: 'package.json' });

    // Tool result fed back on the second turn.
    const secondTurn = scripted.getRequestBodies()[1].messages;
    const toolMsg = secondTurn.find((m: ChatMessage) => m.role === 'tool');
    expect(toolMsg.content).toContain('the version field is 5.0.3');

    // Final answer reflects the tool result; thinking separated.
    expect(terminal.type).toBe('chat-completed');
    expect(terminal.assistantMessage.content).toBe('The version is 5.0.3.');
    expect(terminal.assistantMessage.thinkingContent).toBe('the tool returned 5.0.3');

    // Persisted: user + assistant, and title derived from first user message.
    const session = api.getSessionStore().get(result.sessionId);
    expect(session.messageCount).toBe(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('The version is 5.0.3.');
    expect(session.title).toBe(content);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Context switching within one session (Req 2.2, 3.1, 3.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration: context switching within one session (Req 2.2, 3.1, 3.4)', () => {
  it('alternating tool-using and tool-less messages; only tool turns enter the loop', async () => {
    const gateway = createMockMcpGateway({
      outputs: { folder_read_file: 'file body' }
    });
    const statePath = createTempStatePath();
    const ipcMain = createMockIpcMain();
    const window = createMockMainWindow();

    // Message 1 (tool-using): tool-call turn then final text.
    // Message 2 (tool-less): a single text turn.
    // Message 3 (tool-using): tool-call turn then final text.
    const scripted = createScriptedFetch([
      toolCallTurn('folder_read_file', { path: 'a.txt' }),
      finalTextTurn('answer one uses the file'),
      finalTextTurn('answer two no tools'),
      toolCallTurn('folder_read_file', { path: 'b.txt' }),
      finalTextTurn('answer three uses the file')
    ]);
    const api = registerAgentChatHandlers(ipcMain, window, {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    });
    const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

    // Message 1
    const r1 = await sendHandler({}, { surface: 'agent', content: 'read a.txt', model: MODEL, endpoint: ENDPOINT }) as SendResult;
    const t1 = await waitForCompletion(window, 1);
    expect(t1.assistantMessage.content).toBe('answer one uses the file');
    const sessionId = r1.sessionId;

    // Message 2 (same session, tool-less)
    await sendHandler({}, { surface: 'agent', content: 'just chat', model: MODEL, endpoint: ENDPOINT, sessionId });
    const t2 = await waitForCompletion(window, 2);
    expect(t2.assistantMessage.content).toBe('answer two no tools');

    // Message 3 (same session, tool-using)
    await sendHandler({}, { surface: 'agent', content: 'read b.txt', model: MODEL, endpoint: ENDPOINT, sessionId });
    const t3 = await waitForCompletion(window, 3);
    expect(t3.assistantMessage.content).toBe('answer three uses the file');

    // Only the two tool-using messages entered the loop and dispatched.
    expect(gateway.getCalls()).toHaveLength(2);
    expect(gateway.getCalls()[0].payload).toMatchObject({ path: 'a.txt' });
    expect(gateway.getCalls()[1].payload).toMatchObject({ path: 'b.txt' });

    // Session state consistent: 3 user + 3 assistant messages.
    const session = api.getSessionStore().get(sessionId);
    expect(session.messageCount).toBe(6);
    const roles = session.messages.map((m: ChatMessage) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Visual/event feedback and abort (Req 2.4, 3.1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Integration: event feedback and abort (Req 2.4)', () => {
  it('emits tool-call and tool-result events describing the call and its result', async () => {
    const gateway = createMockMcpGateway({
      outputs: { folder_read_file: 'CONTENTS OF FILE' }
    });
    const statePath = createTempStatePath();
    const ipcMain = createMockIpcMain();
    const window = createMockMainWindow();
    const scripted = createScriptedFetch([
      toolCallTurn('folder_read_file', { path: 'notes.md' }),
      finalTextTurn('here is the summary')
    ]);
    registerAgentChatHandlers(ipcMain, window, {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    });
    const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

    await sendHandler({}, { surface: 'agent', content: 'summarize notes.md', model: MODEL, endpoint: ENDPOINT });
    await waitForCompletion(window);

    const events = window.getStreamEvents();
    const callEvent = events.find((e) => e.type === 'tool-call');
    const resultEvent = events.find((e) => e.type === 'tool-result');

    expect(callEvent).toMatchObject({
      tool: 'folder_read_file',
      server: 'folder',
      action: 'read_file'
    });
    expect(callEvent.params).toMatchObject({ path: 'notes.md' });

    expect(resultEvent).toMatchObject({ tool: 'folder_read_file', status: 'success' });
    expect(resultEvent.output).toContain('CONTENTS OF FILE');

    // Ordering: tool-call is emitted before tool-result.
    const callIdx = events.findIndex((e) => e.type === 'tool-call');
    const resultIdx = events.findIndex((e) => e.type === 'tool-result');
    expect(callIdx).toBeLessThan(resultIdx);
  });

  it('stop/abort during a tool round halts cleanly without persisting a partial assistant message', async () => {
    // Slow dispatch keeps the loop busy so we can abort mid-round.
    const gateway = createMockMcpGateway({ slowMs: 60 });
    const statePath = createTempStatePath();
    const ipcMain = createMockIpcMain();
    const window = createMockMainWindow();
    // Every turn requests a tool so the loop is guaranteed to be running.
    const scripted = createScriptedFetch([
      toolCallTurn('folder_read_file', { path: 'x' })
    ]);
    const api = registerAgentChatHandlers(ipcMain, window, {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    });
    const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
    const stopHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.STOP)!;

    const result = await sendHandler({}, { surface: 'agent', content: 'loop please', model: MODEL, endpoint: ENDPOINT }) as SendResult;

    // Abort while the (slow) tool round is in flight.
    await new Promise((r) => setTimeout(r, 30));
    await stopHandler({}, result.sessionId);

    // Let any in-flight work settle.
    await new Promise((r) => setTimeout(r, 200));

    // No completion event after abort.
    const completed = window.getStreamEvents().find((e) => e.type === 'chat-completed');
    expect(completed).toBeFalsy();

    // Only the user message persisted; no assistant message committed.
    const session = api.getSessionStore().get(result.sessionId);
    const assistant = session.messages.find((m: ChatMessage) => m.role === 'assistant');
    expect(assistant).toBeUndefined();
    expect(session.messages.filter((m: ChatMessage) => m.role === 'user')).toHaveLength(1);
  });
});
