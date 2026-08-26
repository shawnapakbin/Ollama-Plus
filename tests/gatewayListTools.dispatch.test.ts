import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';
import { createGateway } from '../mcp/lib/gateway.mjs';

/**
 * Integration test — Gateway List Tools (Task 5.2)
 *
 * Verifies the Conversational_Agent_Path dispatches a model tool call through
 * a REAL gateway (built via `createGateway()`) to the correct registered route,
 * appends the tool result as a role:'tool' message, and re-invokes the model.
 *
 * Validates: Requirements 4.2, 4.3, 7.3
 */

// ─── Test Infrastructure (mirrors agentChatHandlersTools.test.ts) ─────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gw-dispatch-'));
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
// Dispatch to correct route + tool-loop re-invocation (Req 4.2, 4.3, 7.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Gateway dispatch to correct route and tool-loop re-invocation (Req 4.2, 4.3, 7.3)', () => {
  it('dispatches a model tool call through the real gateway to the registered route, appends role:tool, and re-invokes the model', async () => {
    // Build a REAL gateway and register a route whose handler is a spy that
    // records the params it received and returns a result.
    const gateway = createGateway();
    const handlerCalls: Array<{ payload: any; context: any }> = [];
    gateway.register(
      'folder',
      'read_file',
      (payload: any, context: any) => {
        handlerCalls.push({ payload, context });
        return { output: 'FILE CONTENTS: version 5.0.3' };
      },
      {
        description: 'Read a file from the workspace folder',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    );

    // FIRST model turn: a tool call for the registered route (name
    // `<server>_<action>` => folder_read_file) with arguments/params.
    // SECOND model turn: a plain terminating text response.
    const { window, sendHandler, scripted } = setup(
      [
        toolCallTurn('folder_read_file', { path: 'package.json' }),
        finalTextTurn('The version is 5.0.3.')
      ],
      gateway
    );

    await send(sendHandler);
    const terminal = await waitForCompletion(window);

    // (1) The gateway route handler was invoked with the parsed params.
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0].payload).toMatchObject({ path: 'package.json' });
    expect(handlerCalls[0].context).toMatchObject({ server: 'folder', action: 'read_file' });

    // (2) A message with role 'tool' was appended to the conversation, carrying
    //     the handler's result back to the model.
    const bodies = scripted.getRequestBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    const secondTurnMessages = bodies[1].messages;
    const toolMessages = secondTurnMessages.filter((m: any) => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toContain('FILE CONTENTS: version 5.0.3');

    // (3) The model (fetch) was re-invoked (called at least twice).
    expect(scripted.getTurnCount()).toBeGreaterThanOrEqual(2);

    // The loop terminated cleanly at the tool-less turn.
    expect(terminal.type).toBe('chat-completed');
    expect(terminal.assistantMessage.content).toBe('The version is 5.0.3.');
  });
});
