import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Supporting unit tests — Agent MCP Tools Not Accessible (Task 4)
 *
 * Focused on the `agentChatHandlers.js` fix surface:
 *  - tool catalog construction from the available MCP tools (buildToolCatalog
 *    behavior, observed via the outgoing /api/chat body).
 *  - empty catalog yields no `tools` field.
 *  - tool-call dispatch mapping (tool -> server/action/params) and a
 *    role:'tool' transcript append.
 *  - edge cases: unknown tool name, gateway dispatch error, tool round cap
 *    reached, abort/stop mid-loop.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.2
 */

// ─── Test Infrastructure (mirrors existing exploration/preservation tests) ────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-mcp-handlers-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle(channel: string, handler: Function) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    getHandler(channel: string) {
      return handlers.get(channel);
    }
  };
}

function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: any }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: any) {
        sentEvents.push({ channel, payload });
      }
    },
    getStreamEvents() {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM)
        .map((e) => e.payload);
    }
  };
}

/**
 * Mock MCP gateway. `dispatchResult` controls the dispatch outcome:
 *  - a value => resolved gateway result
 *  - a function => called (may throw) per dispatch
 * `tools` is the catalog returned by listTools.
 */
function createMockMcpGateway(opts: {
  tools?: any[];
  dispatchResult?: any;
  onDispatch?: (req: any) => any;
} = {}) {
  const calls: Array<{ server: string; action: string; payload: any }> = [];
  const tools = opts.tools ?? [
    {
      name: 'folder_read_file',
      description: 'Read a file from the workspace folder',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  ];
  return {
    dispatch: async (request: { server: string; action: string; payload?: any }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      if (opts.onDispatch) return opts.onDispatch(request);
      return opts.dispatchResult ?? { output: 'TOOL OUTPUT' };
    },
    getCalls: () => calls,
    listTools: async () => tools
  };
}

function createScriptedFetch(turns: any[][]) {
  const requestBodies: any[] = [];
  let turnIndex = 0;
  const fetchImpl = async (_url: string, options: any) => {
    try {
      requestBodies.push(JSON.parse(options.body));
    } catch {
      requestBodies.push(null);
    }
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

async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  timeoutMs = 3000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = window.getStreamEvents();
    const terminal = events.find(
      (e) => e.type === 'chat-completed' || e.type === 'chat-error'
    );
    if (terminal) return terminal;
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

const MODEL = 'qwen3.5:9b';
const ENDPOINT = 'http://localhost:11434';

/** A model turn requesting one tool call for `toolName` with `args`. */
function toolCallTurn(toolName: string, args: any): any[] {
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

/** A final text turn (no tool calls). */
function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

function setup(turns: any[][], gateway: any) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const scripted = createScriptedFetch(turns);
  const api = registerAgentChatHandlers(ipcMain as any, window as any, {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT,
    mcpGateway: gateway
  });
  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
  return { statePath, ipcMain, window, scripted, api, sendHandler };
}

async function send(sendHandler: Function, content = 'do the thing', extra: any = {}) {
  return sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT, ...extra });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool catalog construction (Req 2.1, 3.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tool catalog construction (Req 2.1, 3.2)', () => {
  it('builds an OpenAI/Ollama-style tools array from available MCP tools', async () => {
    const gateway = createMockMcpGateway({
      tools: [
        { name: 'folder_read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
        { name: 'terminal_run', description: 'Run a command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } }
      ]
    });
    const { window, sendHandler, scripted } = setup([finalTextTurn('done')], gateway);

    await send(sendHandler);
    await waitForCompletion(window);

    const body = scripted.getRequestBodies()[0];
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'folder_read_file', description: 'Read a file' }
    });
    expect(body.tools[0].function.parameters).toMatchObject({ type: 'object' });
    expect(body.tools[1].function.name).toBe('terminal_run');
  });

  it('empty catalog (gateway lists no tools) yields no tools field', async () => {
    const gateway = createMockMcpGateway({ tools: [] });
    const { window, sendHandler, scripted } = setup([finalTextTurn('done')], gateway);

    await send(sendHandler);
    await waitForCompletion(window);

    const body = scripted.getRequestBodies()[0];
    expect('tools' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream'].sort());
  });

  it('skips catalog entries without a valid name', async () => {
    const gateway = createMockMcpGateway({
      tools: [
        { name: 'folder_read_file', description: 'ok' },
        { description: 'nameless' },
        { name: '   ' }
      ]
    });
    const { window, sendHandler, scripted } = setup([finalTextTurn('done')], gateway);

    await send(sendHandler);
    await waitForCompletion(window);

    const body = scripted.getRequestBodies()[0];
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('folder_read_file');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool-call dispatch mapping + role:'tool' append (Req 2.2, 2.3, 2.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tool-call dispatch mapping and transcript append (Req 2.2, 2.3, 2.4)', () => {
  it('maps a <server>_<action> tool name to server/action/params', async () => {
    const gateway = createMockMcpGateway();
    const { window, sendHandler } = setup(
      [toolCallTurn('folder_read_file', { path: 'package.json' }), finalTextTurn('version 5.0.3')],
      gateway
    );

    await send(sendHandler);
    await waitForCompletion(window);

    const calls = gateway.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ server: 'folder', action: 'read_file' });
    expect(calls[0].payload).toMatchObject({ path: 'package.json' });
  });

  it('maps a multi-underscore action correctly (server is first segment)', async () => {
    const gateway = createMockMcpGateway({
      tools: [{ name: 'browser_navigate_to', description: 'nav' }]
    });
    const { window, sendHandler } = setup(
      [toolCallTurn('browser_navigate_to', { url: 'example.com' }), finalTextTurn('ok')],
      gateway
    );

    await send(sendHandler);
    await waitForCompletion(window);

    const calls = gateway.getCalls();
    expect(calls[0]).toMatchObject({ server: 'browser', action: 'navigate_to' });
  });

  it('appends a role:tool message to the transcript and re-invokes the model', async () => {
    const gateway = createMockMcpGateway({ dispatchResult: { output: 'FILE: version 5.0.3' } });
    const { window, sendHandler, scripted } = setup(
      [toolCallTurn('folder_read_file', { path: 'package.json' }), finalTextTurn('The version is 5.0.3.')],
      gateway
    );

    await send(sendHandler);
    const terminal = await waitForCompletion(window);

    const bodies = scripted.getRequestBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);

    const secondTurn = bodies[1].messages;
    const toolMessages = secondTurn.filter((m: any) => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    // The transcript carries the tool output back to the model as role:'tool'.
    expect(toolMessages[0].content).toContain('FILE: version 5.0.3');

    // Final answer reflects the tool loop terminating at the tool-less turn.
    expect(terminal.type).toBe('chat-completed');
    expect(terminal.assistantMessage.content).toBe('The version is 5.0.3.');
  });

  it('emits tool-call and tool-result stream events to the Agent window (Req 2.4)', async () => {
    const gateway = createMockMcpGateway({ dispatchResult: { output: 'RESULT DATA' } });
    const { window, sendHandler } = setup(
      [toolCallTurn('folder_read_file', { path: 'x' }), finalTextTurn('done')],
      gateway
    );

    await send(sendHandler);
    await waitForCompletion(window);

    const events = window.getStreamEvents();
    const call = events.find((e) => e.type === 'tool-call');
    const result = events.find((e) => e.type === 'tool-result');

    expect(call).toMatchObject({ tool: 'folder_read_file', server: 'folder', action: 'read_file' });
    expect(result).toMatchObject({ tool: 'folder_read_file', status: 'success' });
    expect(result.output).toContain('RESULT DATA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases (Req 2.2, 2.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tool-loop edge cases (Req 2.2, 2.3)', () => {
  it('unknown / unmappable tool name yields an error tool message without dispatch', async () => {
    // A name with no underscore cannot be mapped to server/action.
    const gateway = createMockMcpGateway();
    const { window, sendHandler, scripted } = setup(
      [toolCallTurn('bogus', {}), finalTextTurn('recovered')],
      gateway
    );

    await send(sendHandler);
    const terminal = await waitForCompletion(window);

    // No gateway dispatch for an unmappable name.
    expect(gateway.getCalls()).toHaveLength(0);

    const bodies = scripted.getRequestBodies();
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/unknown tool/i);

    const events = window.getStreamEvents();
    const result = events.find((e) => e.type === 'tool-result');
    expect(result.status).toBe('error');
    expect(terminal.type).toBe('chat-completed');
  });

  it('gateway dispatch error is captured as an error tool message and the loop continues', async () => {
    const gateway = createMockMcpGateway({
      onDispatch: () => {
        throw new Error('gateway exploded');
      }
    });
    const { window, sendHandler, scripted } = setup(
      [toolCallTurn('folder_read_file', { path: 'x' }), finalTextTurn('handled the error')],
      gateway
    );

    await send(sendHandler);
    const terminal = await waitForCompletion(window);

    const bodies = scripted.getRequestBodies();
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/error/i);

    const events = window.getStreamEvents();
    const result = events.find((e) => e.type === 'tool-result');
    expect(result.status).toBe('error');

    // Loop continues to a final text answer rather than crashing.
    expect(terminal.type).toBe('chat-completed');
    expect(terminal.assistantMessage.content).toBe('handled the error');
  });

  it('tool round cap is enforced when the model keeps requesting tools', async () => {
    // Every turn requests a tool; the loop must terminate at the cap.
    const gateway = createMockMcpGateway();
    // Supply many tool-call turns; the scripted fetch repeats the last turn,
    // so every invocation returns a tool call.
    const { window, sendHandler, scripted } = setup(
      [toolCallTurn('folder_read_file', { path: 'loop' })],
      gateway
    );

    await send(sendHandler);
    const terminal = await waitForCompletion(window, 5000);

    expect(terminal.type).toBe('chat-completed');
    // The number of model invocations is bounded (cap + final), not infinite.
    // MAX_TOOL_ROUNDS is 8 => at most ~9 invocations.
    expect(scripted.getTurnCount()).toBeLessThanOrEqual(10);

    const events = window.getStreamEvents();
    const capNotice = events.find(
      (e) => e.type === 'chat-token' && typeof e.delta === 'string' && /round limit reached/i.test(e.delta)
    );
    expect(capNotice).toBeTruthy();
  });

  it('abort/stop mid-loop halts cleanly without persisting a partial assistant message', async () => {
    // The model always requests a tool; we abort while the loop is running.
    const gateway = createMockMcpGateway({
      onDispatch: async () => {
        // Slow dispatch gives the test time to abort mid-loop.
        await new Promise((r) => setTimeout(r, 40));
        return { output: 'slow' };
      }
    });
    const { window, ipcMain, sendHandler, api } = setup(
      [toolCallTurn('folder_read_file', { path: 'x' })],
      gateway
    );

    const result: any = await send(sendHandler);
    const stopHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.STOP)!;

    // Give the loop a moment to enter dispatch, then abort.
    await new Promise((r) => setTimeout(r, 20));
    await stopHandler({}, result.sessionId);

    // Allow any in-flight work to settle.
    await new Promise((r) => setTimeout(r, 150));

    // No terminal completion event should be emitted after abort.
    const events = window.getStreamEvents();
    const completed = events.find((e) => e.type === 'chat-completed');
    expect(completed).toBeFalsy();

    // Only the user message is persisted; no assistant message committed.
    const session = api.getSessionStore().get(result.sessionId);
    const assistant = session.messages.find((m: any) => m.role === 'assistant');
    expect(assistant).toBeUndefined();
    expect(session.messages.filter((m: any) => m.role === 'user')).toHaveLength(1);
  });
});
